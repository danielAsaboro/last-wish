import "server-only";

import { createPublicClient, getAddress, http, parseEventLogs, type Address } from "viem";

import { baseSepolia, sepolia } from "@/lib/chains";
import { readEventHistoryInWindows } from "@/lib/audit/event-indexer";
import { factoryAbi, vaultAbi } from "@/lib/contracts/abi";
import { classifyWorkflowEvidence, inspectWorkflowExecutionLogs, verifyKeeperHubWriteLog } from "@/lib/keeperhub/client";
import { readVaultStatusAtBlock } from "@/lib/keeperhub/reconcile";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { buildVaultWorkflows, isLiveWorkflow, parseWorkflowRegistrationKey, workflowGraphMatchesDefinition } from "@/lib/keeperhub/workflow";

import { assembleVaultIntegrityReport, type IntegrityRequest, type IntegrityReportDependencies } from "./server";

const statusNames = ["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED"] as const;

export async function assembleVaultIntegrityReportFromEnv(request: IntegrityRequest) {
  return assembleVaultIntegrityReport(request, runtimeDependencies());
}

function runtimeDependencies(): IntegrityReportDependencies {
  return {
    async readVault(chainId, address) {
      const rpc = rpcFor(chainId);
      const factoryValue = process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
      if (!factoryValue) throw new Error("The trusted LastWish factory is not configured.");
      const factory = getAddress(factoryValue);
      const block = await rpc.getBlock({ blockTag: "latest" });
      const [bytecode, owner, guardian, policyVersion, statusCode, balanceWei, heartbeatInterval, gracePeriod, lastHeartbeat, pendingAt, beneficiaryCount] = await Promise.all([
        rpc.getBytecode({ address, blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "owner", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "guardian", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "policyVersion", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "status", blockNumber: block.number }),
        rpc.getBalance({ address, blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "heartbeatInterval", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "gracePeriod", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "lastHeartbeat", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "pendingAt", blockNumber: block.number }),
        rpc.readContract({ address, abi: vaultAbi, functionName: "beneficiaryCount", blockNumber: block.number }),
      ]);
      if (!bytecode || bytecode === "0x") throw new Error("The requested address has no contract bytecode at the observation block.");
      const registered = await rpc.readContract({ address: factory, abi: factoryAbi, functionName: "vaultOf", args: [owner], blockNumber: block.number });
      if (registered.toLowerCase() !== address.toLowerCase()) throw new Error("Factory provenance verification failed.");
      const beneficiaryAddresses = await Promise.all(Array.from({ length: Number(beneficiaryCount) }, (_, index) =>
        rpc.readContract({ address, abi: vaultAbi, functionName: "beneficiaryAt", args: [BigInt(index)], blockNumber: block.number })));
      const beneficiaries = await Promise.all(beneficiaryAddresses.map(async (beneficiary) => {
        const [shareBps, claimableWei] = await Promise.all([
          rpc.readContract({ address, abi: vaultAbi, functionName: "shareBps", args: [beneficiary], blockNumber: block.number }),
          rpc.readContract({ address, abi: vaultAbi, functionName: "claimable", args: [beneficiary], blockNumber: block.number }),
        ]);
        return { address: beneficiary, shareBps: Number(shareBps), claimableWei };
      }));
      return { address, owner, guardian, factory, policyVersion, status: statusNames[Number(statusCode)] ?? "RECOVERY_REQUIRED", balanceWei, heartbeatInterval, gracePeriod, lastHeartbeat, pendingAt, observedAt: block.timestamp, observedBlockNumber: block.number, beneficiaries };
    },
    async readKeeperHubEvidence(chainId, vault, policyVersion) {
      if (!process.env.KEEPERHUB_API_KEY) return { configured: false, coverageLimited: false, workflows: [], executions: [] };
      const client = keeperHubClientFromEnv();
      const rpc = rpcFor(chainId);
      const definitions = buildVaultWorkflows({ chainId, vault, policyVersion, scheduleCron: "*/5 * * * *" });
      const expected = new Map(definitions.map((definition) => [parseWorkflowRegistrationKey(definition.description)!.action, definition]));
      const listed = (await client.listWorkflows()).flatMap((workflow) => {
        const key = parseWorkflowRegistrationKey(workflow.description);
        if (!key || !isLiveWorkflow(workflow) || key.chainId !== chainId || key.vault.toLowerCase() !== vault.toLowerCase()) return [];
        return [{ workflow, key }];
      });
      const workflows = listed.map(({ workflow, key }) => ({ workflowId: workflow.id, action: key.action, policyVersion: key.policyVersion, enabled: workflow.enabled, definitionMatches: key.policyVersion === policyVersion && workflowGraphMatchesDefinition(workflow, expected.get(key.action)!) }));
      const currentStatusCode = await rpc.readContract({ address: vault, abi: vaultAbi, functionName: "status" });
      const observedVaultStatus = statusNames[Number(currentStatusCode)] ?? "RECOVERY_REQUIRED";
      const executionGroups = await Promise.all(listed.map(async ({ workflow, key }) => {
        const definitionMatches = key.policyVersion === policyVersion && workflowGraphMatchesDefinition(workflow, expected.get(key.action)!);
        const expectedStatus = key.action === "open" ? "PENDING" as const : "SETTLED" as const;
        const providerExecutions = await client.listWorkflowExecutions(workflow.id);
        const summaries = await Promise.all(providerExecutions.map(async (execution) => {
          const base = { workflowId: workflow.id, executionId: execution.id };
          if (execution.workflowId !== workflow.id || execution.transactionHashes.length > 1) return { ...base, status: "unknown", verified: false };
          let transactionHash = execution.transactionHashes[0]?.hash as Address | undefined;
          let logs: unknown;
          try {
            logs = await client.getWorkflowExecutionLogs(execution.id);
            if (!transactionHash) {
              const inspection = inspectWorkflowExecutionLogs(logs, execution.id, workflow.id);
              if (inspection.kind === "write") transactionHash = inspection.transactionHash;
              else {
                const evidence = classifyWorkflowEvidence(execution, expectedStatus, { observedVaultStatus, noWriteVerified: definitionMatches && inspection.kind === "no_write" });
                return { ...base, status: evidence.status, verified: evidence.verified };
              }
            }
            const receipt = await rpc.getTransactionReceipt({ hash: transactionHash });
            const statusAtReceipt = await readVaultStatusAtBlock(rpc, vault, receipt.blockNumber);
            const expectedEvent = expectedStatus === "PENDING" ? "SettlementOpened" : "SettlementFinalized";
            const eventVerified = parseEventLogs({ abi: vaultAbi, logs: receipt.logs }).some((log) => log.address.toLowerCase() === vault.toLowerCase() && log.eventName === expectedEvent && log.args.policyVersion === key.policyVersion);
            const evidence = classifyWorkflowEvidence(execution, expectedStatus, {
              keeperWriteVerified: verifyKeeperHubWriteLog(logs, transactionHash, execution.id, workflow.id),
              receiptStatus: receipt.status,
              eventVerified,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed,
              observedVaultStatus: statusAtReceipt,
              transactionHash,
            });
            return { ...base, status: evidence.status, verified: evidence.verified, transactionHash, blockNumber: receipt.blockNumber };
          } catch {
            return { ...base, status: transactionHash ? "unknown" : execution.status, verified: false, transactionHash };
          }
        }));
        return { summaries, coverageLimited: providerExecutions.length === 50 };
      }));
      const executions = executionGroups.flatMap((group) => group.summaries);
      return { configured: true, coverageLimited: executionGroups.some((group) => group.coverageLimited), workflows, executions };
    },
    async readAuditCoverage(chainId, vault, snapshot) {
      const rpc = rpcFor(chainId);
      const deployedAtBlock = await rpc.readContract({ address: vault, abi: vaultAbi, functionName: "deployedAtBlock", blockNumber: BigInt(snapshot.observedBlockNumber) });
      await readEventHistoryInWindows({
        fromBlock: deployedAtBlock,
        toBlock: BigInt(snapshot.observedBlockNumber),
        readRange: (fromBlock, toBlock) => rpc.getLogs({ address: vault, fromBlock, toBlock }),
      });
      return { state: "fresh", indexedThroughBlock: BigInt(snapshot.observedBlockNumber) };
    },
    now: () => new Date(),
  };
}

function rpcFor(chainId: 84532 | 11155111) {
  const chain = chainId === 84532 ? baseSepolia : sepolia;
  const url = chainId === 84532 ? process.env.BASE_SEPOLIA_RPC_URL : process.env.SEPOLIA_RPC_URL;
  return createPublicClient({ chain, transport: http(url) });
}
