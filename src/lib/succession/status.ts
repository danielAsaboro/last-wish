import type { VaultStatus } from "./types";

export type VaultTimingState = {
  lastHeartbeat: bigint;
  heartbeatInterval: bigint;
  gracePeriod: bigint;
  pendingAt: bigint;
  vetoed: boolean;
  settled: boolean;
};

export function deriveVaultStatus(state: VaultTimingState, now: bigint): VaultStatus {
  if (state.settled) return "SETTLED";
  if (state.vetoed) return "VETOED";
  if (state.pendingAt === 0n) return "ACTIVE";
  return now >= state.pendingAt + state.gracePeriod ? "READY" : "PENDING";
}
export function expectedClaims(balanceWei: bigint, sharesBps: number[]): bigint[] {
  if (sharesBps.length === 0 || sharesBps.reduce((total, share) => total + share, 0) !== 10_000) {
    throw new Error("Shares must total exactly 10,000 basis points");
  }
  let allocated = 0n;
  return sharesBps.map((share, index) => {
    const amount =
      index === sharesBps.length - 1
        ? balanceWei - allocated
        : (balanceWei * BigInt(share)) / 10_000n;
    allocated += amount;
    return amount;
  });
}
