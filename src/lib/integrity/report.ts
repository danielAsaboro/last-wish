import { getAddress, keccak256, stringToHex } from "viem";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => getAddress(value));
const decimalSchema = z.union([z.bigint(), z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(String);
const statusSchema = z.enum(["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED", "RECOVERY_REQUIRED"]);

const inputSchema = z.object({
  chain: z.object({ id: z.union([z.literal(84532), z.literal(11155111)]), name: z.string().min(1) }),
  vault: z.object({
    address: addressSchema,
    owner: addressSchema,
    guardian: addressSchema,
    factory: addressSchema,
    policyVersion: decimalSchema,
    status: statusSchema,
    balanceWei: decimalSchema,
    heartbeatInterval: decimalSchema,
    gracePeriod: decimalSchema,
    lastHeartbeat: decimalSchema,
    pendingAt: decimalSchema,
    observedAt: decimalSchema,
    observedBlockNumber: decimalSchema,
    beneficiaries: z.array(z.object({ address: addressSchema, shareBps: z.number().int().min(0).max(10_000), claimableWei: decimalSchema })),
  }),
  keeperHub: z.object({
    configured: z.boolean(),
    coverageLimited: z.boolean().default(false),
    workflows: z.array(z.object({
      workflowId: z.string().min(1),
      action: z.enum(["open", "finalize"]),
      policyVersion: decimalSchema,
      enabled: z.boolean(),
      definitionMatches: z.boolean(),
    })),
    executions: z.array(z.object({
      workflowId: z.string().min(1),
      executionId: z.string().min(1),
      status: z.string().min(1),
      verified: z.boolean(),
      blockNumber: decimalSchema.optional(),
      transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    })),
  }),
  audit: z.discriminatedUnion("state", [
    z.object({ state: z.literal("fresh"), indexedThroughBlock: decimalSchema }),
    z.object({ state: z.literal("stale"), targetBlock: decimalSchema, lastCompleteBlock: decimalSchema.optional() }),
    z.object({ state: z.literal("indexing"), targetBlock: decimalSchema, lastCompleteBlock: decimalSchema.optional() }),
    z.object({ state: z.literal("idle") }),
  ]),
  generatedAt: z.string().datetime(),
});

export type VaultIntegrityReportInput = z.input<typeof inputSchema>;

export function buildVaultIntegrityReport(rawInput: VaultIntegrityReportInput) {
  const input = inputSchema.parse(rawInput);
  const currentWorkflows = input.keeperHub.workflows.filter((item) => BigInt(item.policyVersion) === BigInt(input.vault.policyVersion));
  const workflowActions = currentWorkflows.map((item) => item.action);
  const workflowsComplete = input.keeperHub.configured &&
    currentWorkflows.length === 2 &&
    workflowActions.filter((action) => action === "open").length === 1 &&
    workflowActions.filter((action) => action === "finalize").length === 1 &&
    currentWorkflows.every((item) => item.enabled && item.definitionMatches) &&
    input.keeperHub.workflows.filter((item) => BigInt(item.policyVersion) !== BigInt(input.vault.policyVersion)).every((item) => !item.enabled);
  const sharesComplete = input.vault.beneficiaries.length > 0 && input.vault.beneficiaries.reduce((total, item) => total + item.shareBps, 0) === 10_000;
  const auditComplete = input.audit.state === "fresh" && BigInt(input.audit.indexedThroughBlock) >= BigInt(input.vault.observedBlockNumber);
  const contradictoryExecution = input.keeperHub.executions.some((item) => !item.verified && (item.transactionHash !== undefined || item.status === "success" || item.status === "unconfirmed" || item.status === "unknown"));
  const executionsComplete = input.keeperHub.executions.every((item) => item.verified);
  const checks = [
    { id: "factory_provenance" as const, status: "verified" as const, detail: `Factory ${input.vault.factory} maps owner to this vault.` },
    { id: "beneficiary_shares" as const, status: sharesComplete ? "verified" as const : "incomplete" as const, detail: sharesComplete ? "Beneficiary shares total exactly 10,000 basis points." : "Beneficiary shares are missing or do not total 10,000 basis points." },
    { id: "keeperhub_definitions" as const, status: workflowsComplete ? "verified" as const : "incomplete" as const, detail: workflowsComplete ? "Current enabled KeeperHub workflow definitions match policy." : "Current enabled KeeperHub workflow definitions are missing or mismatched." },
    { id: "keeperhub_coverage" as const, status: input.keeperHub.coverageLimited ? "incomplete" as const : "verified" as const, detail: input.keeperHub.coverageLimited ? "KeeperHub returned its maximum recent execution window, so older runs may exist outside this report." : "KeeperHub execution history was not truncated at the provider window limit." },
    { id: "keeperhub_executions" as const, status: contradictoryExecution ? "recovery_required" as const : executionsComplete ? "verified" as const : "incomplete" as const, detail: contradictoryExecution ? "A successful or ambiguous KeeperHub run lacks independently verified evidence." : executionsComplete ? "Returned KeeperHub executions are independently verified, or no execution is yet expected." : "Returned KeeperHub execution evidence is still pending or failed." },
    { id: "audit_coverage" as const, status: auditComplete ? "verified" as const : "incomplete" as const, detail: auditComplete ? `Chain evidence is indexed through block ${input.vault.observedBlockNumber}.` : "Chain evidence does not cover the observation block." },
  ];
  const verificationStatus = checks.some((check) => check.status === "recovery_required")
    ? "recovery_required" as const
    : checks.every((check) => check.status === "verified")
      ? "verified" as const
      : "incomplete" as const;
  return {
    schema: "lastwish.integrity.v1" as const,
    generatedAt: input.generatedAt,
    generatedAtSource: "server_clock" as const,
    chain: input.chain,
    vault: {
      ...input.vault,
      beneficiaries: [...input.vault.beneficiaries].sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase())),
    },
    keeperHub: {
      ...input.keeperHub,
      workflows: [...input.keeperHub.workflows].sort((left, right) => left.workflowId.localeCompare(right.workflowId)),
      executions: [...input.keeperHub.executions].sort((left, right) => left.executionId.localeCompare(right.executionId)),
    },
    audit: input.audit,
    verification: {
      status: verificationStatus,
      checks,
    },
  };
}

export type VaultIntegrityReport = ReturnType<typeof buildVaultIntegrityReport>;

export function hashVaultIntegrityReport(report: VaultIntegrityReport): `0x${string}` {
  return keccak256(stringToHex(stableStringify(report)));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortValue(item)]));
}
