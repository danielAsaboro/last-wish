import type { VaultStatus } from "./types";

export type VaultTimingState = {
  lastHeartbeat: bigint;
  heartbeatInterval: bigint;
  gracePeriod: bigint;
  pendingAt: bigint;
  vetoed: boolean;
  settled: boolean;
};

export type LifecyclePhase =
  | "HEARTBEAT_ACTIVE"
  | "OPEN_ELIGIBLE"
  | "GRACE_ACTIVE"
  | "FINALIZE_ELIGIBLE"
  | "VETOED"
  | "SETTLED"
  | "RECOVERY_REQUIRED";

export type LifecycleSummary = {
  phase: LifecyclePhase;
  title: string;
  detail: string;
  deadline?: bigint;
  progressBps: number;
  currentStep: 0 | 1 | 2;
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

export function buildLifecycleSummary(
  state: Pick<VaultTimingState, "lastHeartbeat" | "heartbeatInterval" | "gracePeriod" | "pendingAt"> & { status: VaultStatus },
  now: bigint,
): LifecycleSummary {
  const heartbeatDeadline = state.lastHeartbeat + state.heartbeatInterval;

  if (state.status === "SETTLED") {
    return { phase: "SETTLED", title: "Settlement is complete", detail: "Beneficiary allocations are fixed and available as individual claims.", progressBps: 10_000, currentStep: 2 };
  }
  if (state.status === "RECOVERY_REQUIRED") {
    return { phase: "RECOVERY_REQUIRED", title: "Evidence needs reconciliation", detail: "Inspect the existing execution and onchain receipt before another write is attempted.", progressBps: 10_000, currentStep: 2 };
  }
  if (state.status === "VETOED") {
    return { phase: "VETOED", title: "Settlement was vetoed", detail: "Only an owner heartbeat can reactivate the policy and begin a new inactivity window.", progressBps: 0, currentStep: 0 };
  }
  if (state.status === "READY") {
    return { phase: "FINALIZE_ELIGIBLE", title: "Settlement is eligible to finalize", detail: "The grace period ended. KeeperHub or any caller may now execute the contract-gated finalization.", deadline: state.pendingAt + state.gracePeriod, progressBps: 10_000, currentStep: 2 };
  }
  if (state.status === "PENDING") {
    const deadline = state.pendingAt + state.gracePeriod;
    return {
      phase: "GRACE_ACTIVE",
      title: "Guardian grace period is active",
      detail: "The owner can reactivate and the guardian can veto until the exact grace deadline.",
      deadline,
      progressBps: progressBetween(state.pendingAt, deadline, now),
      currentStep: 1,
    };
  }
  if (now >= heartbeatDeadline) {
    return { phase: "OPEN_ELIGIBLE", title: "Heartbeat expired — grace may open", detail: "The vault now permits KeeperHub or any caller to open the guardian review period.", deadline: heartbeatDeadline, progressBps: 10_000, currentStep: 1 };
  }
  return {
    phase: "HEARTBEAT_ACTIVE",
    title: "Heartbeat window is active",
    detail: "The owner can reset the clock before KeeperHub is allowed to open grace.",
    deadline: heartbeatDeadline,
    progressBps: progressBetween(state.lastHeartbeat, heartbeatDeadline, now),
    currentStep: 0,
  };
}

function progressBetween(start: bigint, end: bigint, now: bigint): number {
  if (end <= start || now >= end) return 10_000;
  if (now <= start) return 0;
  return Number(((now - start) * 10_000n) / (end - start));
}
