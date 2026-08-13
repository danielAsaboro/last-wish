import type { KeeperHubEvidence } from "@/lib/succession/types";

export type VerificationCheck = {
  id: "factory_provenance" | "chain_history" | "keeperhub_reconciliation" | "unresolved_writes";
  label: string;
  status: "verified" | "incomplete" | "action_required";
  detail: string;
};

export type VerificationStatus = { status: "verified" | "incomplete" | "recovery_required"; checks: VerificationCheck[] };

type AuditCoverage =
  | { state: "idle" }
  | { state: "indexing"; targetBlock: bigint; lastCompleteBlock?: bigint }
  | { state: "fresh"; indexedThroughBlock: bigint }
  | { state: "stale"; targetBlock: bigint; lastCompleteBlock?: bigint };

export function deriveVerificationStatus(input: {
  provenanceVerified: boolean;
  auditCoverage: AuditCoverage;
  refreshState: "checking" | "refreshing" | "fresh" | "stale";
  currentVaultEvidence: "unknown" | "refreshing" | "fresh" | "stale_with_success";
  automationState: "healthy" | "recovery_required";
  keeperHubEvidence: KeeperHubEvidence[];
  workflows: Array<{ coverage: { olderRunsMayExist: boolean } }>;
  walletRecovery?: { transactionHash: string };
}): VerificationStatus {
  const hasAmbiguousWrite = Boolean(input.walletRecovery) || input.keeperHubEvidence.some((evidence) =>
    evidence.status === "unknown" || evidence.observedVaultStatus === "RECOVERY_REQUIRED",
  );
  const hasInFlightExecution = input.keeperHubEvidence.some((evidence) => evidence.status === "pending" || evidence.status === "running");
  const hasTruncatedKeeperHubHistory = input.workflows.some((workflow) => workflow.coverage.olderRunsMayExist);
  const checks: VerificationCheck[] = [
    input.provenanceVerified
      ? { id: "factory_provenance", label: "Factory provenance", status: "verified", detail: "Vault ownership was verified against the configured LastWish factory." }
      : { id: "factory_provenance", label: "Factory provenance", status: "incomplete", detail: "Factory provenance has not been verified for this snapshot." },
    input.auditCoverage.state === "fresh"
      ? { id: "chain_history", label: "Chain history", status: "verified", detail: `Contract events are indexed through block ${input.auditCoverage.indexedThroughBlock}.` }
      : { id: "chain_history", label: "Chain history", status: "incomplete", detail: chainCoverageDetail(input.auditCoverage) },
    input.refreshState === "fresh" && input.currentVaultEvidence === "fresh" && input.automationState === "healthy" && !hasTruncatedKeeperHubHistory
      ? { id: "keeperhub_reconciliation", label: "KeeperHub reconciliation", status: "verified", detail: "Current workflow evidence is fresh and automation is healthy." }
      : { id: "keeperhub_reconciliation", label: "KeeperHub reconciliation", status: "incomplete", detail: hasTruncatedKeeperHubHistory ? "The available KeeperHub window is current, but older runs may exist outside the provider response." : input.refreshState === "fresh" && input.currentVaultEvidence === "fresh" ? "Current workflow evidence is fresh, but automation needs repair." : "Current-vault KeeperHub evidence is not freshly reconciled." },
    hasAmbiguousWrite
      ? { id: "unresolved_writes", label: "Unresolved writes", status: "action_required", detail: "A submitted transaction or KeeperHub execution needs receipt and state reconciliation before another write." }
      : hasInFlightExecution
        ? { id: "unresolved_writes", label: "Unresolved writes", status: "incomplete", detail: "A KeeperHub execution is still in flight; wait for terminal receipt and state reconciliation." }
        : { id: "unresolved_writes", label: "Unresolved writes", status: "verified", detail: "No ambiguous submitted write is currently recorded for this vault." },
  ];
  return { status: hasAmbiguousWrite ? "recovery_required" : checks.every((check) => check.status === "verified") ? "verified" : "incomplete", checks };
}

function chainCoverageDetail(coverage: Exclude<AuditCoverage, { state: "fresh" }>) {
  if (coverage.state === "idle") return "Chain event indexing has not started.";
  if (coverage.state === "indexing") return `Chain event indexing is still running toward block ${coverage.targetBlock}.`;
  return coverage.lastCompleteBlock === undefined
    ? `No complete chain event range is available through target block ${coverage.targetBlock}.`
    : `Chain history is complete only through block ${coverage.lastCompleteBlock}; target block ${coverage.targetBlock}.`;
}
