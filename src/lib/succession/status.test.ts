import { describe, expect, it } from "vitest";

import { buildLifecycleSummary, deriveVaultStatus, expectedClaims } from "./status";

describe("deriveVaultStatus", () => {
  const base = {
    lastHeartbeat: 1_000n,
    heartbeatInterval: 100n,
    gracePeriod: 50n,
    pendingAt: 0n,
    vetoed: false,
    settled: false,
  };

  it("keeps the vault active until settlement is explicitly opened", () => {
    expect(deriveVaultStatus(base, 1_500n)).toBe("ACTIVE");
  });

  it("derives pending and ready at the exact grace boundary", () => {
    expect(deriveVaultStatus({ ...base, pendingAt: 1_200n }, 1_249n)).toBe("PENDING");
    expect(deriveVaultStatus({ ...base, pendingAt: 1_200n }, 1_250n)).toBe("READY");
  });

  it("prioritizes terminal and veto states", () => {
    expect(deriveVaultStatus({ ...base, vetoed: true }, 1_500n)).toBe("VETOED");
    expect(deriveVaultStatus({ ...base, vetoed: true, settled: true }, 1_500n)).toBe("SETTLED");
  });
});
describe("expectedClaims", () => {
  it("assigns the rounding remainder to the final beneficiary", () => {
    expect(expectedClaims(1_000_000_000_000_000_001n, [6_000, 4_000])).toEqual([
      600_000_000_000_000_000n,
      400_000_000_000_000_001n,
    ]);
  });
});

describe("buildLifecycleSummary", () => {
  const timing = {
    lastHeartbeat: 1_000n,
    heartbeatInterval: 600n,
    gracePeriod: 300n,
    pendingAt: 0n,
  };

  it("shows heartbeat progress and flips to open-eligible at the exact expiry boundary", () => {
    expect(buildLifecycleSummary({ ...timing, status: "ACTIVE" }, 1_300n)).toEqual({
      phase: "HEARTBEAT_ACTIVE",
      title: "Heartbeat window is active",
      detail: "The owner can reset the clock before KeeperHub is allowed to open grace.",
      deadline: 1_600n,
      progressBps: 5_000,
      currentStep: 0,
    });
    expect(buildLifecycleSummary({ ...timing, status: "ACTIVE" }, 1_600n)).toMatchObject({
      phase: "OPEN_ELIGIBLE",
      deadline: 1_600n,
      progressBps: 10_000,
      currentStep: 1,
    });
  });

  it("tracks the guardian grace window and finalization boundary", () => {
    expect(buildLifecycleSummary({ ...timing, status: "PENDING", pendingAt: 2_000n }, 2_150n)).toMatchObject({
      phase: "GRACE_ACTIVE",
      deadline: 2_300n,
      progressBps: 5_000,
      currentStep: 1,
    });
    expect(buildLifecycleSummary({ ...timing, status: "READY", pendingAt: 2_000n }, 2_300n)).toMatchObject({
      phase: "FINALIZE_ELIGIBLE",
      progressBps: 10_000,
      currentStep: 2,
    });
  });

  it("makes veto and settlement terminal next steps explicit", () => {
    expect(buildLifecycleSummary({ ...timing, status: "VETOED" }, 2_000n)).toMatchObject({ phase: "VETOED", currentStep: 0 });
    expect(buildLifecycleSummary({ ...timing, status: "SETTLED" }, 2_000n)).toMatchObject({ phase: "SETTLED", currentStep: 2 });
  });
});
