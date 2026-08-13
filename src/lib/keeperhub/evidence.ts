import { z } from "zod";

import type { Address, KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";

export type WorkflowCoverage = {
  runsReturned: number;
  providerWindow: "latest_50_non_purged";
  olderRunsMayExist: boolean;
  providerPagination: "unavailable";
};

export type DiscoveredWorkflowRegistration = {
  workflowId: string;
  name: string;
  policyVersion: string;
  action: "open" | "finalize";
  enabled?: boolean;
  definitionMatches: boolean;
  registrationState: "current" | "stale";
  coverage: WorkflowCoverage;
};

export type AutomationHealth = {
  state: "healthy" | "recovery_required";
  detail: string;
};

const decimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const policyVersionSchema = z.string().regex(/^[1-9][0-9]*$/);
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value as Address);
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value as Address);
const vaultStatusSchema = z.enum(["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED", "RECOVERY_REQUIRED"] satisfies VaultStatus[]);
const coverageSchema = z.object({
  runsReturned: z.number().int().nonnegative(),
  providerWindow: z.literal("latest_50_non_purged"),
  olderRunsMayExist: z.boolean(),
  providerPagination: z.literal("unavailable"),
});
const workflowRegistrationSchema = z.object({
  workflowId: z.string().min(1).max(200),
  name: z.string(),
  policyVersion: policyVersionSchema,
  action: z.enum(["open", "finalize"]),
  enabled: z.boolean().optional(),
  definitionMatches: z.boolean(),
  registrationState: z.enum(["current", "stale"]),
  coverage: coverageSchema,
});
const evidenceItemSchema = z.object({
  workflowId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  status: z.enum(["pending", "running", "verified", "failed", "unknown"]),
  transactionHash: hashSchema.optional(),
  transactionLink: z.string().url().optional(),
  verified: z.boolean(),
  receiptStatus: z.string().optional(),
  blockNumber: decimalSchema.optional(),
  gasUsed: decimalSchema.optional(),
  observedVaultStatus: vaultStatusSchema.optional(),
  outcome: z.enum(["TRANSACTION", "NO_WRITE"]).optional(),
  timestamp: decimalSchema.optional(),
  failedNode: z.string().optional(),
  failureReason: z.string().optional(),
  policyVersion: policyVersionSchema,
  workflowAction: z.enum(["open", "finalize"]),
});

const evidenceResponseSchema = z.object({
  configured: z.literal(true),
  chainId: z.number().int().positive(),
  vault: addressSchema,
  policyVersion: policyVersionSchema,
  workflows: z.array(workflowRegistrationSchema),
  executionEvidenceScope: z.literal("recent_keeperhub_window_only").default("recent_keeperhub_window_only"),
  evidence: z.array(evidenceItemSchema),
}).superRefine((response, context) => {
  const workflowById = new Map<string, (typeof response.workflows)[number]>();
  response.workflows.forEach((workflow, index) => {
    if (workflowById.has(workflow.workflowId)) {
      context.addIssue({ code: "custom", path: ["workflows", index, "workflowId"], message: "Workflow IDs must be unique." });
      return;
    }
    workflowById.set(workflow.workflowId, workflow);
    const expectedState = workflow.policyVersion === response.policyVersion ? "current" : "stale";
    if (workflow.registrationState !== expectedState) {
      context.addIssue({ code: "custom", path: ["workflows", index, "registrationState"], message: "Registration state must match the current policy version." });
    }
  });
  response.evidence.forEach((item, index) => {
    const workflow = workflowById.get(item.workflowId);
    if (!workflow) {
      context.addIssue({ code: "custom", path: ["evidence", index, "workflowId"], message: "Evidence must reference a discovered workflow." });
      return;
    }
    if (item.policyVersion !== workflow.policyVersion || item.workflowAction !== workflow.action) {
      context.addIssue({ code: "custom", path: ["evidence", index], message: "Evidence lineage must match its workflow registration." });
    }
    if (item.verified !== (item.status === "verified")) {
      context.addIssue({ code: "custom", path: ["evidence", index, "verified"], message: "Evidence verification flag must match its classified status." });
    }
  });
});

export function parseKeeperHubEvidenceResponse(input: unknown): {
  chainId: number;
  vault: Address;
  policyVersion: bigint;
  workflows: DiscoveredWorkflowRegistration[];
  executionEvidenceScope: "recent_keeperhub_window_only";
  evidence: KeeperHubEvidence[];
} {
  const parsed = evidenceResponseSchema.parse(input);
  return {
    chainId: parsed.chainId,
    vault: parsed.vault,
    policyVersion: BigInt(parsed.policyVersion),
    workflows: parsed.workflows,
    executionEvidenceScope: parsed.executionEvidenceScope,
    evidence: parsed.evidence.map((item) => ({
      ...item,
      blockNumber: item.blockNumber === undefined ? undefined : BigInt(item.blockNumber),
      gasUsed: item.gasUsed === undefined ? undefined : BigInt(item.gasUsed),
      timestamp: item.timestamp === undefined ? undefined : BigInt(item.timestamp),
      policyVersion: BigInt(item.policyVersion),
    })),
  };
}

export function deriveAutomationHealth(workflows: DiscoveredWorkflowRegistration[]): AutomationHealth {
  const current = workflows.filter((workflow) => workflow.registrationState === "current");
  const enabledStale = workflows.filter((workflow) => workflow.registrationState === "stale" && workflow.enabled === true);
  const problems = [
    ...(enabledStale.length > 0 ? ["a stale prior-policy workflow remains enabled"] : []),
    ...(["open", "finalize"] as const).flatMap((action) => {
      const matches = current.filter((workflow) => workflow.action === action);
      if (matches.length === 0) return [`the current ${action} workflow is missing`];
      if (matches.some((workflow) => !workflow.definitionMatches)) {
        return [`a current ${action} workflow graph does not match the canonical LastWish definition`];
      }
      const enabled = matches.filter((workflow) => workflow.enabled === true);
      if (enabled.length === 0) return [`the current ${action} workflow is disabled`];
      if (enabled.length > 1) return [`the current ${action} workflow is duplicated`];
      return [];
    }),
  ];
  return problems.length === 0
    ? { state: "healthy", detail: "Enabled current open and finalize workflows are registered." }
    : { state: "recovery_required", detail: `${capitalize(problems.join(" and "))}. Re-register only after inspecting the existing workflows and evidence.` };
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
