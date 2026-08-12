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
  status: z.enum(["pending", "running", "unconfirmed", "success", "error", "cancelled", "phantom", "system_error"]),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  transactionHashes: z.array(z.object({
    hash: hashSchema,
    nodeId: z.string(),
    nodeName: z.string(),
    chainId: z.number().optional(),
    network: z.string().optional(),
    iterationIndex: z.number().optional(),
    verified: z.boolean().optional(),
    receiptStatus: z.enum(["success", "reverted", "not_found", "timeout", "safe_inner_failure"]).optional(),
    blockNumber: z.number().optional(),
    gasUsed: z.string().optional(),
    verifiedAt: z.string().optional(),
  })).default([]),
}).passthrough();

const workflowLogResponseSchema = z.object({
  execution: z.object({ id: z.string(), workflowId: z.string(), status: z.string() }).passthrough(),
  logs: z.array(z.object({
    id: z.string(),
    executionId: z.string(),
    nodeId: z.string(),
    nodeName: z.string(),
    nodeType: z.string(),
    status: z.string(),
    input: z.unknown().nullable().optional(),
    output: z.unknown().nullable().optional(),
    outputRaw: z.unknown().nullable().optional(),
    error: z.string().nullable(),
    duration: z.string().nullable(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  }).passthrough()),
});

export type KeeperHubChain = z.infer<typeof chainSchema>;
export type KeeperHubExecutionResponse = z.input<typeof executionSchema>;
export type KeeperHubWorkflowExecution = z.infer<typeof workflowExecutionSchema>;
export type WorkflowLogInspection =
  | { kind: "write"; transactionHash: Address }
  | { kind: "no_write" }
  | { kind: "unknown" };
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

export function selectRequestedExecutionChain(chains: KeeperHubChain[], requestedChainId: number): KeeperHubChain {
  const selected = chains.find(
    (chain) => chain.chainId === requestedChainId && chain.isEnabled && chain.isTestnet && (chain.chainId === 84532 || chain.chainId === 11155111),
  );
  if (!selected) throw new Error("The requested chain is not an enabled supported KeeperHub testnet");
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
  if (parsed.data.execution.id !== expectedExecutionId || parsed.data.execution.workflowId !== expectedWorkflowId || parsed.data.execution.status !== "success") return false;
  return parsed.data.logs.some((log) => {
    const output = objectValue(log.outputRaw ?? log.output);
    const hash = output?.transactionHash;
    return log.executionId === expectedExecutionId &&
      log.nodeId === "execute" &&
      log.nodeType === "web3/write-contract" &&
      log.status === "success" &&
      output?.success === true &&
      typeof hash === "string" &&
      hash.toLowerCase() === transactionHash.toLowerCase();
  });
}

export function inspectWorkflowExecutionLogs(
  input: unknown,
  expectedExecutionId: string,
  expectedWorkflowId: string,
): WorkflowLogInspection {
  const parsed = workflowLogResponseSchema.safeParse(input);
  if (!parsed.success || parsed.data.execution.id !== expectedExecutionId || parsed.data.execution.workflowId !== expectedWorkflowId) {
    return { kind: "unknown" };
  }
  const writeLogs = parsed.data.logs.filter((log) =>
    log.executionId === expectedExecutionId &&
    (log.nodeId === "execute" || log.nodeType === "web3/write-contract"),
  );
  const hashes = new Map<string, Address>();
  for (const log of writeLogs) {
    const output = objectValue(log.outputRaw ?? log.output);
    if (log.executionId === expectedExecutionId && log.nodeId === "execute" && log.nodeType === "web3/write-contract" && log.status === "success" && output?.success === true) {
      for (const candidate of transactionHashesIn(log.outputRaw ?? log.output)) {
        hashes.set(candidate.toLowerCase(), candidate);
      }
    }
  }
  if (hashes.size === 1) return { kind: "write", transactionHash: [...hashes.values()][0] };
  if (hashes.size > 1) return { kind: "unknown" };
  if (writeLogs.length > 0) return { kind: "unknown" };
  if (parsed.data.logs.some((log) => transactionHashesIn(log.outputRaw ?? log.output).length > 0)) return { kind: "unknown" };

  if (parsed.data.execution.status !== "success") return { kind: "unknown" };
  const conditionLogs = parsed.data.logs.filter((log) => log.executionId === expectedExecutionId && log.nodeId === "eligible");
  const conditionProvesFalseBranch = conditionLogs.length > 0 && conditionLogs.every((log) =>
    log.executionId === expectedExecutionId &&
    log.nodeId === "eligible" &&
    log.nodeType === "Condition" &&
    log.status === "success" &&
    objectValue(log.outputRaw ?? log.output)?.condition === false,
  );
  const checkLogs = parsed.data.logs.filter((log) => log.executionId === expectedExecutionId && log.nodeId === "check");
  const checkProvesFalse = checkLogs.length > 0 && checkLogs.every((log) =>
    log.nodeType === "web3/read-contract" &&
    log.status === "success" &&
    objectValue(log.outputRaw ?? log.output)?.result === false,
  );
  return conditionProvesFalseBranch && checkProvesFalse ? { kind: "no_write" } : { kind: "unknown" };
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
    noWriteVerified?: boolean;
    transactionHash?: Address;
  },
): KeeperHubEvidence {
  const execution = workflowExecutionSchema.parse(input);
  const multipleHashes = execution.transactionHashes.length > 1;
  const transactionHash = reconciliation.transactionHash ?? (multipleHashes ? undefined : execution.transactionHashes.at(-1)?.hash as Address | undefined);

  if (multipleHashes) {
    return {
      workflowId: execution.workflowId,
      executionId: execution.id,
      status: "unknown",
      verified: false,
      observedVaultStatus: "RECOVERY_REQUIRED",
      timestamp: parseTimestamp(execution.completedAt ?? execution.startedAt),
    };
  }

  if (!transactionHash) {
    if (execution.status === "pending" || execution.status === "running" || execution.status === "phantom") {
      return {
        workflowId: execution.workflowId,
        executionId: execution.id,
        status: execution.status === "phantom" ? "pending" : execution.status,
        verified: false,
        observedVaultStatus: reconciliation.observedVaultStatus,
        timestamp: parseTimestamp(execution.completedAt ?? execution.startedAt),
      };
    }
    const successfulCheck = execution.status === "success" && reconciliation.noWriteVerified === true;
    return {
      workflowId: execution.workflowId,
      executionId: execution.id,
      status: successfulCheck
        ? "verified"
        : execution.status === "success" || execution.status === "unconfirmed"
          ? "unknown"
          : "failed",
      verified: successfulCheck,
      observedVaultStatus: successfulCheck ? reconciliation.observedVaultStatus : "RECOVERY_REQUIRED",
      ...(successfulCheck ? { outcome: "NO_WRITE" as const } : {}),
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
    transactionHash,
    verified,
    receiptStatus: reconciliation.receiptStatus,
    blockNumber: reconciliation.blockNumber,
    gasUsed: reconciliation.gasUsed,
    observedVaultStatus: recoveryRequired ? "RECOVERY_REQUIRED" : reconciliation.observedVaultStatus,
    outcome: "TRANSACTION",
    timestamp: parseTimestamp(execution.completedAt ?? execution.startedAt),
  };
}

function parseTimestamp(value?: string | null): bigint | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1_000)) : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function transactionHashesIn(value: unknown, seen = new Set<object>()): Address[] {
  if (typeof value === "string") return hashSchema.safeParse(value).success ? [value as Address] : [];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return (Array.isArray(value) ? value : Object.values(value as Record<string, unknown>))
    .flatMap((item) => transactionHashesIn(item, seen));
}
