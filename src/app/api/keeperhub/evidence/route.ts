import { createPublicClient, getAddress, http, parseEventLogs, type Address } from "viem";
import { z } from "zod";

import { baseSepolia, sepolia } from "@/lib/chains";
import { vaultAbi } from "@/lib/contracts/abi";
import { classifyWorkflowEvidence, verifyKeeperHubWriteLog } from "@/lib/keeperhub/client";
import { readVaultStatusAtBlock } from "@/lib/keeperhub/reconcile";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { isWorkflowForVault } from "@/lib/keeperhub/workflow";
import type { KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";

const requestSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registrations: z.array(z.object({
    workflowId: z.string().min(1).max(200),
    expectedStatus: z.enum(["PENDING", "SETTLED"]),
  })).min(1).max(4),
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
    const statusCode = await rpc.readContract({ address: vault, abi: vaultAbi, functionName: "status" });
    const observedVaultStatus = statusNames[Number(statusCode)] ?? "RECOVERY_REQUIRED";
    const evidence: KeeperHubEvidence[] = [];
    const workflows = await keeperHub.listWorkflows();
    const authorizedWorkflowIds = new Set(workflows
      .filter((workflow) => isWorkflowForVault(workflow, parsed.data.chainId, vault))
      .map((workflow) => workflow.id));
    if (parsed.data.registrations.some((registration) => !authorizedWorkflowIds.has(registration.workflowId))) {
      return Response.json({ configured: true, error: "A requested workflow is not registered for this vault." }, { status: 403 });
    }

    for (const registration of parsed.data.registrations) {
      const executions = (await keeperHub.listWorkflowExecutions(registration.workflowId)).slice(0, 20);
      for (const execution of executions) {
        const transactionHash = execution.transactionHashes.at(-1)?.hash as Address | undefined;
        if (!transactionHash) {
          evidence.push(classifyWorkflowEvidence(execution, registration.expectedStatus, { observedVaultStatus }));
          continue;
        }

        try {
          const keeperHubLogs = await keeperHub.getWorkflowExecutionLogs(execution.id);
          const receipt = await rpc.getTransactionReceipt({ hash: transactionHash });
          const statusAtReceipt = await readVaultStatusAtBlock(rpc, vault, receipt.blockNumber);
          const expectedEvent = registration.expectedStatus === "PENDING" ? "SettlementOpened" : "SettlementFinalized";
          const eventVerified = parseEventLogs({ abi: vaultAbi, logs: receipt.logs }).some(
            (log) => log.address.toLowerCase() === vault.toLowerCase() && log.eventName === expectedEvent,
          );
          evidence.push(classifyWorkflowEvidence(execution, registration.expectedStatus, {
            keeperWriteVerified: verifyKeeperHubWriteLog(
              keeperHubLogs,
              transactionHash,
              execution.id,
              registration.workflowId,
            ),
            receiptStatus: receipt.status,
            eventVerified,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            observedVaultStatus: statusAtReceipt,
          }));
        } catch {
          evidence.push(classifyWorkflowEvidence(execution, registration.expectedStatus, { observedVaultStatus }));
        }
      }
    }

    return Response.json({
      configured: true,
      chainId: parsed.data.chainId,
      vault,
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
