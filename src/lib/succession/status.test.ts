import { describe, expect, it } from "vitest";

import { deriveVaultStatus, expectedClaims } from "./status";

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
