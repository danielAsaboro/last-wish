import { keccak256, stringToHex } from "viem";
import { z } from "zod";

import type { Address, KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

const chainSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  name: z.string(),
  isEnabled: z.boolean(),
  isTestnet: z.boolean(),
});

const receiptSchema = z.object({
  transactionHash: hashSchema,
  verified: z.boolean(),
  receiptStatus: z.string(),
  blockNumber: z.union([z.string(), z.number()]).optional(),
  gasUsed: z.union([z.string(), z.number()]).optional(),
});

const executionSchema = z.object({
  workflowId: z.string().optional(),
  executionId: z.string(),
  status: z.string(),
  transactionHash: hashSchema.optional(),
  transactionLink: z.string().url().optional(),
  receipts: z.array(receiptSchema).default([]),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const workflowExecutionSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: z.enum(["pending", "running", "success", "error", "cancelled"]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  transactionHashes: z.array(z.object({
    hash: hashSchema,
    nodeId: z.string(),
    nodeName: z.string(),
    chainId: z.number().optional(),
    network: z.string().optional(),
  })).default([]),
});

const workflowLogResponseSchema = z.object({
  execution: z.object({ id: z.string(), workflowId: z.string(), status: z.string() }).passthrough(),
  logs: z.array(z.object({
    id: z.string(),
    executionId: z.string(),
    nodeId: z.string(),
    nodeName: z.string(),
    nodeType: z.string(),
    status: z.string(),
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    duration: z.string(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  }).passthrough()),
});

export type KeeperHubChain = z.infer<typeof chainSchema>;
export type KeeperHubExecutionResponse = z.input<typeof executionSchema>;
export type KeeperHubWorkflowExecution = z.infer<typeof workflowExecutionSchema>;
export type SettlementAction = "openSettlement" | "finalizeSettlement";

export function parseEnabledChains(input: unknown): KeeperHubChain[] {
  const candidate = Array.isArray(input)
    ? input
    : typeof input === "object" && input !== null && "chains" in input
      ? (input as { chains: unknown }).chains
      : input;
  return z.array(chainSchema).parse(candidate);
}

export function selectExecutionChain(chains: KeeperHubChain[]): KeeperHubChain {
  const enabled = chains.filter((chain) => chain.isEnabled && chain.isTestnet);
  const selected = enabled.find((chain) => chain.chainId === 84532) ?? enabled.find((chain) => chain.chainId === 11155111);
  if (!selected) throw new Error("No supported KeeperHub testnet is enabled");
  return selected;
}

export function buildExecutionKey(
  chainId: number,
  vault: Address,
  policyVersion: bigint,
  action: SettlementAction,
  eligibilityTimestamp: bigint,
): string {
  addressSchema.parse(vault);
  return keccak256(
    stringToHex(
      `lastwish:${chainId}:${vault.toLowerCase()}:${policyVersion}:${action}:${eligibilityTimestamp}`,
    ),
  );
}

export function classifyKeeperHubEvidence(
  input: KeeperHubExecutionResponse,
  expectedStatus: VaultStatus,
  independentlyObservedStatus?: VaultStatus,
): KeeperHubEvidence {
  const execution = executionSchema.parse(input);
  const claimedHash = execution.transactionHash;
  const receipt = execution.receipts.find(
    (candidate) => !claimedHash || candidate.transactionHash.toLowerCase() === claimedHash.toLowerCase(),
  );
  const receiptVerified = receipt?.verified === true && receipt.receiptStatus === "success";
  const stateVerified = independentlyObservedStatus === expectedStatus;
  const verified = execution.status === "completed" && receiptVerified && stateVerified;
  const ambiguous =
    execution.status === "unconfirmed" ||
    receipt?.receiptStatus === "timeout" ||
    (claimedHash !== undefined && !receiptVerified) ||
    independentlyObservedStatus === undefined;

  return {
    workflowId: execution.workflowId ?? "",
    executionId: execution.executionId,
    status: verified
      ? "verified"
      : ambiguous
        ? "unknown"
        : execution.status === "pending"
          ? "pending"
          : execution.status === "running"
            ? "running"
            : "failed",
    transactionHash: claimedHash as Address | undefined,
    transactionLink: execution.transactionLink,
    verified,
    receiptStatus: receipt?.receiptStatus,
    blockNumber: receipt?.blockNumber === undefined ? undefined : BigInt(receipt.blockNumber),
    gasUsed: receipt?.gasUsed === undefined ? undefined : BigInt(receipt.gasUsed),
    observedVaultStatus: ambiguous ? "RECOVERY_REQUIRED" : independentlyObservedStatus,
    timestamp: parseTimestamp(execution.completedAt ?? execution.createdAt),
  };
}

export function parseWorkflowExecutions(input: unknown): KeeperHubWorkflowExecution[] {
  const candidate = typeof input === "object" && input !== null && "data" in input
    ? (input as { data: unknown }).data
    : input;
  return z.array(workflowExecutionSchema).parse(candidate);
}

export function verifyKeeperHubWriteLog(
  input: unknown,
  transactionHash: Address,
  expectedExecutionId: string,
  expectedWorkflowId: string,
): boolean {
  const parsed = workflowLogResponseSchema.safeParse(input);
  if (!parsed.success) return false;
  if (parsed.data.execution.id !== expectedExecutionId || parsed.data.execution.workflowId !== expectedWorkflowId) return false;
  return parsed.data.logs.some((log) => {
    const hash = log.output?.transactionHash;
    return log.executionId === expectedExecutionId &&
      log.nodeType === "web3/write-contract" &&
      log.status === "success" &&
      log.output?.success === true &&
      typeof hash === "string" &&
      hash.toLowerCase() === transactionHash.toLowerCase();
  });
}

export function classifyWorkflowEvidence(
  input: unknown,
  expectedStatus: VaultStatus,
  reconciliation: {
    receiptStatus?: string;
    keeperWriteVerified?: boolean;
    eventVerified?: boolean;
    blockNumber?: bigint;
    gasUsed?: bigint;
    observedVaultStatus?: VaultStatus;
  },
): KeeperHubEvidence {
  const execution = workflowExecutionSchema.parse(input);
  const transaction = execution.transactionHashes.at(-1);

  if (!transaction) {
    const successfulCheck = execution.status === "success";
    return {
      workflowId: execution.workflowId,
      executionId: execution.id,
      status: successfulCheck
        ? "verified"
        : execution.status === "pending" || execution.status === "running"
          ? execution.status
          : "failed",
      verified: successfulCheck,
      observedVaultStatus: reconciliation.observedVaultStatus,
      outcome: "NO_WRITE",
      timestamp: parseTimestamp(execution.completedAt ?? execution.startedAt),
    };
  }

  const receiptVerified = reconciliation.keeperWriteVerified === true && reconciliation.receiptStatus === "success" && reconciliation.eventVerified === true;
  const stateVerified = reconciliation.observedVaultStatus === expectedStatus;
  const verified = execution.status === "success" && receiptVerified && stateVerified;
  const recoveryRequired = !verified;

  return {
    workflowId: execution.workflowId,
    executionId: execution.id,
    status: verified
      ? "verified"
      : "unknown",
    transactionHash: transaction.hash as Address,
    verified,
    receiptStatus: reconciliation.receiptStatus,
    blockNumber: reconciliation.blockNumber,
    gasUsed: reconciliation.gasUsed,
    observedVaultStatus: recoveryRequired ? "RECOVERY_REQUIRED" : reconciliation.observedVaultStatus,
    outcome: "TRANSACTION",
    timestamp: parseTimestamp(execution.completedAt ?? execution.startedAt),
  };
}

function parseTimestamp(value?: string): bigint | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1_000)) : undefined;
}
