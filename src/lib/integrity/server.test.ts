import { describe, expect, it } from "vitest";

import { assembleVaultIntegrityReport } from "./server";

const vault = "0x1111111111111111111111111111111111111111";
const snapshot = {
  address: vault,
  owner: "0x2222222222222222222222222222222222222222",
  guardian: "0x3333333333333333333333333333333333333333",
  factory: "0x4444444444444444444444444444444444444444",
  policyVersion: 1n,
  status: "ACTIVE" as const,
  balanceWei: 10n,
  heartbeatInterval: 1n,
  gracePeriod: 2n,
  lastHeartbeat: 3n,
  pendingAt: 0n,
  observedAt: 4n,
  observedBlockNumber: 5n,
  beneficiaries: [],
};

describe("assembleVaultIntegrityReport", () => {
  it("binds a report hash to chain and KeeperHub evidence", async () => {
    const result = await assembleVaultIntegrityReport({ chainId: 84532, vault }, {
      readVault: async () => snapshot,
      readKeeperHubEvidence: async () => ({ configured: true, workflows: [{ workflowId: "wf", action: "open", policyVersion: 1n, enabled: true, definitionMatches: true }], executions: [] }),
      readAuditCoverage: async () => ({ state: "fresh", indexedThroughBlock: 5n }),
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    });
    expect(result.report.vault.address).toBe(vault);
    expect(result.reportHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("rejects a snapshot for a different vault", async () => {
    await expect(assembleVaultIntegrityReport({ chainId: 84532, vault }, {
      readVault: async () => ({ ...snapshot, address: "0x9999999999999999999999999999999999999999" }),
      readKeeperHubEvidence: async () => ({ configured: true, workflows: [], executions: [] }),
      readAuditCoverage: async () => ({ state: "idle" }),
      now: () => new Date(),
    })).rejects.toThrow(/different vault/i);
  });

  it("rejects unsupported chains before invoking dependencies", async () => {
    let called = false;
    await expect(assembleVaultIntegrityReport({ chainId: 1, vault }, {
      readVault: async () => { called = true; return snapshot; },
      readKeeperHubEvidence: async () => ({ configured: false, workflows: [], executions: [] }),
      readAuditCoverage: async () => ({ state: "idle" }),
      now: () => new Date(),
    })).rejects.toThrow(/unsupported chain/i);
    expect(called).toBe(false);
  });
});
