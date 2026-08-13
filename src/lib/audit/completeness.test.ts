import { describe, expect, it } from "vitest";

import { deriveVerificationStatus } from "./completeness";

const baseline = {
  provenanceVerified: true,
  auditCoverage: { state: "fresh" as const, indexedThroughBlock: 42n },
  refreshState: "fresh" as const,
  currentVaultEvidence: "fresh" as const,
  automationState: "healthy" as const,
  keeperHubEvidence: [],
  workflows: [],
};

describe("verification status", () => {
  it("marks all current checks verified only when each check is verified", () => {
    expect(deriveVerificationStatus(baseline)).toMatchObject({
      status: "verified",
      checks: [
        { id: "factory_provenance", status: "verified" },
        { id: "chain_history", status: "verified" },
        { id: "keeperhub_reconciliation", status: "verified" },
        { id: "unresolved_writes", status: "verified" },
      ],
    });
  });

  it("labels stale or incomplete coverage without overstating failure", () => {
    const result = deriveVerificationStatus({
      ...baseline,
      auditCoverage: { state: "stale", targetBlock: 44n, lastCompleteBlock: 42n },
      currentVaultEvidence: "stale_with_success",
    });
    expect(result.status).toBe("incomplete");
    expect(result.checks.find((check) => check.id === "chain_history")?.status).toBe("incomplete");
    expect(result.checks.find((check) => check.id === "keeperhub_reconciliation")?.status).toBe("incomplete");
  });

  it("keeps fresh evidence partial while required automation is unhealthy", () => {
    const result = deriveVerificationStatus({ ...baseline, automationState: "recovery_required" });
    expect(result.status).toBe("incomplete");
    expect(result.checks.find((check) => check.id === "keeperhub_reconciliation")).toMatchObject({
      status: "incomplete",
      detail: expect.stringMatching(/automation needs repair/i),
    });
  });

  it("requires recovery for an ambiguous KeeperHub or wallet transaction", () => {
    const ambiguous = deriveVerificationStatus({
      ...baseline,
      keeperHubEvidence: [{ workflowId: "wf", executionId: "run", status: "unknown", verified: false, observedVaultStatus: "RECOVERY_REQUIRED" }],
    });
    expect(ambiguous.status).toBe("recovery_required");
    expect(ambiguous.checks.find((check) => check.id === "unresolved_writes")?.status).toBe("action_required");

    expect(deriveVerificationStatus({ ...baseline, walletRecovery: { transactionHash: `0x${"a".repeat(64)}` } }).status).toBe("recovery_required");
  });

  it("keeps in-flight executions and truncated provider windows partial", () => {
    const running = deriveVerificationStatus({
      ...baseline,
      keeperHubEvidence: [{ workflowId: "wf", executionId: "run", status: "running", verified: false }],
    });
    expect(running.status).toBe("incomplete");
    expect(running.checks.find((check) => check.id === "unresolved_writes")?.status).toBe("incomplete");

    const truncated = deriveVerificationStatus({
      ...baseline,
      workflows: [{ coverage: { olderRunsMayExist: true } }],
    });
    expect(truncated.status).toBe("incomplete");
    expect(truncated.checks.find((check) => check.id === "keeperhub_reconciliation")?.detail).toMatch(/older runs may exist/i);
  });
});
