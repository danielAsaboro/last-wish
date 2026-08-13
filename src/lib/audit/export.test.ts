import { describe, expect, it } from "vitest";

import { buildAuditExportManifest, serializeAuditExport, type AuditExportInput } from "./export";

const vault = "0x2222222222222222222222222222222222222222" as const;

describe("audit export", () => {
  it("builds a versioned, lossless manifest with explicit evidence boundaries", () => {
    const manifest = buildAuditExportManifest({
      chain: { id: 84532, name: "Base Sepolia" },
      vault: {
        address: vault,
        owner: "0x1111111111111111111111111111111111111111" as const,
        guardian: "0x3333333333333333333333333333333333333333" as const,
        status: "ACTIVE",
        balanceWei: 240_000_000_000_000_000n,
        policyVersion: 3n,
        heartbeatInterval: 2_592_000n,
        gracePeriod: 1_209_600n,
        lastHeartbeat: 1_800_000_000n,
        pendingAt: 0n,
        observedAt: 1_800_000_010n,
        observedBlockNumber: 42n,
        provenance: { kind: "factory_verified", factory: "0x4444444444444444444444444444444444444444", verifiedAtBlock: 42n },
        beneficiaries: [{ address: "0x5555555555555555555555555555555555555555", label: "Ada", shareBps: 10_000, claimableWei: 0n }],
      },
      chainEvents: [{
        id: "chain-1",
        type: "PolicyUpdated",
        timestamp: 1_800_000_000n,
        blockNumber: 42n,
        transactionHash: `0x${"a".repeat(64)}`,
        actor: "0x1111111111111111111111111111111111111111",
        amountWei: 5n,
        policyVersion: 3n,
      }],
      auditIndexCoverage: { state: "fresh", indexedThroughBlock: 42n },
      keeperHub: {
        scope: "recent_keeperhub_window_only",
        reconciliation: { refreshState: "stale", currentVaultEvidence: "stale_with_success", automationState: "healthy" },
        workflows: [{
          workflowId: "wf_open",
          name: "Open",
          policyVersion: "3",
          action: "open",
          enabled: true,
          definitionMatches: true,
          registrationState: "current",
          coverage: { runsReturned: 1, providerWindow: "latest_50_non_purged", olderRunsMayExist: false, providerPagination: "unavailable" },
        }],
        evidence: [{ workflowId: "wf_open", executionId: "exec_1", status: "verified", verified: true, policyVersion: 3n, workflowAction: "open", gasUsed: 50_000n }],
      },
      walletRecovery: {
        action: "heartbeat",
        label: "Record heartbeat",
        target: vault,
        transactionHash: `0x${"b".repeat(64)}`,
        labels: { "0x5555555555555555555555555555555555555555": "Private nickname" },
      } as unknown as AuditExportInput["walletRecovery"],
    }, "2026-08-13T00:00:00.000Z");

    expect(manifest).toMatchObject({
      schema: "lastwish.audit.v1",
      generatedAt: "2026-08-13T00:00:00.000Z",
      generatedAtSource: "client_clock",
      environment: "testnet",
      vault: {
        balanceWei: "240000000000000000",
        observedBlockNumber: "42",
        beneficiaries: [{ displayLabel: "Ada", displayLabelSource: "local_display_metadata", shareBps: 10_000 }],
      },
      chainEvidence: { coverage: { state: "fresh", indexedThroughBlock: "42" }, events: [{ actor: "0x1111111111111111111111111111111111111111", amountWei: "5" }] },
      keeperHubEvidence: {
        scope: "recent_keeperhub_window_only",
        reconciliation: { refreshState: "stale", currentVaultEvidence: "stale_with_success", automationState: "healthy" },
        runs: [{ gasUsed: "50000", policyVersion: "3" }],
      },
      walletRecovery: { action: "heartbeat", transactionHash: `0x${"b".repeat(64)}` },
    });
    const json = serializeAuditExport(manifest);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain("[object Object]");
    expect(json).not.toContain("Private nickname");
  });

  it("does not mix a different vault's recovery record into the export", () => {
    const input = {
      chain: { id: 84532, name: "Base Sepolia" },
      vault: {
        address: vault,
        owner: "0x1111111111111111111111111111111111111111" as const,
        guardian: "0x3333333333333333333333333333333333333333" as const,
        status: "ACTIVE" as const,
        balanceWei: 0n,
        policyVersion: 1n,
        heartbeatInterval: 86_400n,
        gracePeriod: 86_400n,
        lastHeartbeat: 1n,
        pendingAt: 0n,
        observedAt: 2n,
        observedBlockNumber: 3n,
        provenance: { kind: "factory_verified" as const, factory: "0x4444444444444444444444444444444444444444" as const, verifiedAtBlock: 3n },
        beneficiaries: [],
      },
      chainEvents: [],
      auditIndexCoverage: { state: "fresh" as const, indexedThroughBlock: 3n },
      keeperHub: {
        scope: "recent_keeperhub_window_only" as const,
        reconciliation: { refreshState: "fresh" as const, currentVaultEvidence: "fresh" as const, automationState: "healthy" as const },
        workflows: [],
        evidence: [],
      },
      walletRecovery: {
        action: "heartbeat",
        label: "Record heartbeat",
        target: "0x6666666666666666666666666666666666666666" as const,
        transactionHash: `0x${"c".repeat(64)}` as const,
      },
    };

    expect(buildAuditExportManifest(input, "2026-08-13T00:00:00.000Z").walletRecovery).toBeUndefined();
  });
});
