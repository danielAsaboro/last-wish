import { createPublicClient, getAddress, http, parseEventLogs, type Address } from "viem";
import { z } from "zod";

import { baseSepolia, sepolia } from "@/lib/chains";
import { vaultAbi } from "@/lib/contracts/abi";
import { classifyWorkflowEvidence, inspectWorkflowExecutionLogs, verifyKeeperHubWriteLog } from "@/lib/keeperhub/client";
import { readVaultStatusAtBlock } from "@/lib/keeperhub/reconcile";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { buildVaultWorkflows, isLiveWorkflow, parseWorkflowRegistrationKey, workflowGraphMatchesDefinition, type WorkflowRegistrationKey } from "@/lib/keeperhub/workflow";
import type { KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";

const requestSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registrations: z.array(z.object({
    workflowId: z.string().min(1).max(200),
    expectedStatus: z.enum(["PENDING", "SETTLED"]).optional(),
  })).max(4).default([]),
});

const statusNames: VaultStatus[] = ["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED"];

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid KeeperHub evidence request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!process.env.KEEPERHUB_API_KEY) {
    return Response.json({ configured: false, error: "KeeperHub evidence is unavailable because KEEPERHUB_API_KEY is not configured." }, { status: 503 });
  }

  const chain = parsed.data.chainId === baseSepolia.id ? baseSepolia : sepolia;
  const rpcUrl = parsed.data.chainId === baseSepolia.id
    ? process.env.BASE_SEPOLIA_RPC_URL
    : process.env.SEPOLIA_RPC_URL;
  const rpc = createPublicClient({ chain, transport: http(rpcUrl) });
  const vault = getAddress(parsed.data.vault);
  const keeperHub = keeperHubClientFromEnv();

  try {
    const [statusCode, policyVersion] = await Promise.all([
      rpc.readContract({ address: vault, abi: vaultAbi, functionName: "status" }),
      rpc.readContract({ address: vault, abi: vaultAbi, functionName: "policyVersion" }),
    ]);
    const observedVaultStatus = statusNames[Number(statusCode)] ?? "RECOVERY_REQUIRED";
    const evidence: KeeperHubEvidence[] = [];
    const workflows = await keeperHub.listWorkflows();
    const definitions = buildVaultWorkflows({ chainId: parsed.data.chainId, vault, scheduleCron: "*/5 * * * *", policyVersion });
    const definitionByAction = new Map(definitions.map((definition) => [parseWorkflowRegistrationKey(definition.description)!.action, definition]));
    const discovered = workflows.flatMap((workflow) => {
      const registration = parseWorkflowRegistrationKey(workflow.description);
      if (!isLiveWorkflow(workflow) || !registration || registration.chainId !== parsed.data.chainId || registration.vault.toLowerCase() !== vault.toLowerCase()) return [];
      return [{ workflow, registration }];
    });
    const workflowMetadata: Array<{
      workflowId: string;
      name: string;
      policyVersion: string;
      action: WorkflowRegistrationKey["action"];
      registrationState: "current" | "stale";
      enabled?: boolean;
      definitionMatches: boolean;
      coverage: {
        runsReturned: number;
        providerWindow: "latest_50_non_purged";
        olderRunsMayExist: boolean;
        providerPagination: "unavailable";
      };
    }> = [];

    for (const { workflow, registration } of discovered) {
      const expectedStatus: VaultStatus = registration.action === "open" ? "PENDING" : "SETTLED";
      const expectedDefinition = definitionByAction.get(registration.action)!;
      const definitionMatches = registration.policyVersion === policyVersion && workflowGraphMatchesDefinition(workflow, expectedDefinition);
      const executions = await keeperHub.listWorkflowExecutions(workflow.id);
      workflowMetadata.push({
        workflowId: workflow.id,
        name: workflow.name,
        policyVersion: registration.policyVersion.toString(),
        action: registration.action,
        registrationState: registration.policyVersion === policyVersion ? "current" : "stale",
        ...(workflow.enabled === undefined ? {} : { enabled: workflow.enabled }),
        definitionMatches,
        coverage: {
          runsReturned: executions.length,
          providerWindow: "latest_50_non_purged",
          olderRunsMayExist: executions.length === 50,
          providerPagination: "unavailable",
        },
      });
      for (const execution of executions) {
        if (execution.transactionHashes.length > 1) {
          evidence.push(classifyWorkflowEvidence(execution, expectedStatus, { observedVaultStatus }));
          continue;
        }
        let inspectedLogs: unknown;
        let transactionHash = execution.transactionHashes[0]?.hash as Address | undefined;
        if (!transactionHash) {
          inspectedLogs = await keeperHub.getWorkflowExecutionLogs(execution.id).catch(() => undefined);
          const inspection = inspectWorkflowExecutionLogs(inspectedLogs, execution.id, workflow.id);
          if (inspection.kind === "write") transactionHash = inspection.transactionHash;
          else {
            evidence.push(classifyWorkflowEvidence(execution, expectedStatus, {
              observedVaultStatus,
              noWriteVerified: definitionMatches && inspection.kind === "no_write",
            }));
            continue;
          }
        }

        try {
          const keeperHubLogs = inspectedLogs ?? await keeperHub.getWorkflowExecutionLogs(execution.id);
          const receipt = await rpc.getTransactionReceipt({ hash: transactionHash });
          const statusAtReceipt = await readVaultStatusAtBlock(rpc, vault, receipt.blockNumber);
          const expectedEvent = expectedStatus === "PENDING" ? "SettlementOpened" : "SettlementFinalized";
          const eventVerified = parseEventLogs({ abi: vaultAbi, logs: receipt.logs }).some(
            (log) =>
              log.address.toLowerCase() === vault.toLowerCase() &&
              log.eventName === expectedEvent &&
              log.args.policyVersion === registration.policyVersion,
          );
          evidence.push(classifyWorkflowEvidence(execution, expectedStatus, {
            keeperWriteVerified: verifyKeeperHubWriteLog(
              keeperHubLogs,
              transactionHash,
              execution.id,
              workflow.id,
            ),
            receiptStatus: receipt.status,
            eventVerified,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            observedVaultStatus: statusAtReceipt,
            transactionHash,
          }));
        } catch {
          evidence.push(classifyWorkflowEvidence(execution, expectedStatus, { observedVaultStatus, transactionHash }));
        }
      }
    }

    return Response.json({
      configured: true,
      chainId: parsed.data.chainId,
      vault,
      policyVersion: policyVersion.toString(),
      workflows: workflowMetadata,
      executionEvidenceScope: "recent_keeperhub_window_only",
      evidence: evidence.map((item) => ({
        ...item,
        blockNumber: item.blockNumber?.toString(),
        gasUsed: item.gasUsed?.toString(),
        timestamp: item.timestamp?.toString(),
      })),
    });
  } catch (error) {
    return Response.json({ configured: true, error: error instanceof Error ? error.message : "Evidence reconciliation failed" }, { status: 502 });
  }
}
