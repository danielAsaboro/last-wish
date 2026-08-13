import { describe, expect, it } from "vitest";

import { buildVaultIntegrityReport, hashVaultIntegrityReport } from "./report";

const input = {
  chain: { id: 84532 as const, name: "Base Sepolia" },
  vault: {
    address: "0x1111111111111111111111111111111111111111",
    owner: "0x2222222222222222222222222222222222222222",
    guardian: "0x3333333333333333333333333333333333333333",
    factory: "0x4444444444444444444444444444444444444444",
    policyVersion: 2n,
    status: "ACTIVE" as const,
    balanceWei: 5n,
    heartbeatInterval: 86_400n,
    gracePeriod: 43_200n,
    lastHeartbeat: 1_700_000_000n,
    pendingAt: 0n,
    observedAt: 1_700_000_010n,
    observedBlockNumber: 99n,
    beneficiaries: [
      { address: "0x6666666666666666666666666666666666666666", shareBps: 4000, claimableWei: 0n },
      { address: "0x5555555555555555555555555555555555555555", shareBps: 6000, claimableWei: 0n },
    ],
  },
  keeperHub: {
    configured: true,
    coverageLimited: false,
    workflows: [
      { workflowId: "wf_open", action: "open" as const, policyVersion: 2n, enabled: true, definitionMatches: true },
      { workflowId: "wf_finalize", action: "finalize" as const, policyVersion: 2n, enabled: true, definitionMatches: true },
    ],
    executions: [{ workflowId: "wf_open", executionId: "exec_1", status: "success", verified: true, blockNumber: 98n }],
  },
  audit: { state: "fresh" as const, indexedThroughBlock: 99n },
  generatedAt: "2026-08-13T10:00:00.000Z",
};

describe("vault integrity report", () => {
  it("normalizes and deterministically orders public evidence", () => {
    const report = buildVaultIntegrityReport(input);
    expect(report.schema).toBe("lastwish.integrity.v1");
    expect(report.vault.policyVersion).toBe("2");
    expect(report.vault.beneficiaries.map((item) => item.address)).toEqual([
      "0x5555555555555555555555555555555555555555",
      "0x6666666666666666666666666666666666666666",
    ]);
    expect(report.verification.status).toBe("verified");
  });

  it("produces the same content hash for equivalent unordered input", () => {
    const first = buildVaultIntegrityReport(input);
    const second = buildVaultIntegrityReport({
      ...input,
      vault: { ...input.vault, beneficiaries: [...input.vault.beneficiaries].reverse() },
    });
    expect(hashVaultIntegrityReport(first)).toMatch(/^0x[a-f0-9]{64}$/);
    expect(hashVaultIntegrityReport(second)).toBe(hashVaultIntegrityReport(first));
  });

  it("marks incomplete workflow or audit evidence explicitly", () => {
    const report = buildVaultIntegrityReport({
      ...input,
      keeperHub: { ...input.keeperHub, workflows: [{ ...input.keeperHub.workflows[0], definitionMatches: false }] },
      audit: { state: "stale" as const, targetBlock: 99n, lastCompleteBlock: 90n },
    });
    expect(report.verification.status).toBe("incomplete");
    expect(report.verification.checks).toContainEqual(expect.objectContaining({ id: "keeperhub_definitions", status: "incomplete" }));
    expect(report.verification.checks).toContainEqual(expect.objectContaining({ id: "audit_coverage", status: "incomplete" }));
  });

  it("requires one healthy current workflow for each settlement action", () => {
    const report = buildVaultIntegrityReport({
      ...input,
      keeperHub: { ...input.keeperHub, workflows: [input.keeperHub.workflows[0]] },
    });
    expect(report.verification.status).toBe("incomplete");
    expect(report.verification.checks).toContainEqual(expect.objectContaining({ id: "keeperhub_definitions", status: "incomplete" }));
  });

  it("checks deterministic beneficiary share conservation", () => {
    const report = buildVaultIntegrityReport({
      ...input,
      vault: { ...input.vault, beneficiaries: [{ ...input.vault.beneficiaries[0], shareBps: 9_999 }] },
    });
    expect(report.verification.status).toBe("incomplete");
    expect(report.verification.checks).toContainEqual(expect.objectContaining({ id: "beneficiary_shares", status: "incomplete" }));
  });

  it("classifies contradictory successful execution evidence as recovery required", () => {
    const report = buildVaultIntegrityReport({
      ...input,
      keeperHub: { ...input.keeperHub, executions: [{ ...input.keeperHub.executions[0], status: "success", verified: false }] },
    });
    expect(report.verification.status).toBe("recovery_required");
    expect(report.verification.checks).toContainEqual(expect.objectContaining({ id: "keeperhub_executions", status: "recovery_required" }));
  });

  it("classifies an ambiguous transaction-bearing execution as recovery required", () => {
    const report = buildVaultIntegrityReport({
      ...input,
      keeperHub: { ...input.keeperHub, executions: [{ ...input.keeperHub.executions[0], status: "unknown", verified: false, transactionHash: `0x${"a".repeat(64)}` }] },
    });
    expect(report.verification.status).toBe("recovery_required");
  });

  it("does not call a truncated KeeperHub execution window fully verified", () => {
    const report = buildVaultIntegrityReport({
      ...input,
      keeperHub: { ...input.keeperHub, coverageLimited: true },
    });
    expect(report.verification.status).toBe("incomplete");
    expect(report.verification.checks).toContainEqual(expect.objectContaining({ id: "keeperhub_coverage", status: "incomplete" }));
  });
});
