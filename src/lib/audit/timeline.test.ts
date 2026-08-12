import { describe, expect, it } from "vitest";

import { buildAuditTimeline } from "./timeline";

describe("buildAuditTimeline", () => {
  it("orders chain and KeeperHub evidence while preserving provenance", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [
        { id: "policy-1", type: "PolicyUpdated", timestamp: 100n, transactionHash: `0x${"1".repeat(64)}` },
        { id: "heartbeat-1", type: "Heartbeat", timestamp: 120n, transactionHash: `0x${"2".repeat(64)}` },
      ],
      keeperHub: [
        {
          workflowId: "wf_1",
          executionId: "exec_1",
          status: "verified",
          verified: true,
          transactionHash: `0x${"3".repeat(40)}`,
          receiptStatus: "success",
          observedVaultStatus: "PENDING",
        },
      ],
    });
    expect(timeline.map((item) => item.source)).toEqual(["chain", "chain", "keeperhub"]);
    expect(timeline.at(-1)).toMatchObject({ title: "KeeperHub execution verified", tone: "success" });
  });

  it("turns ambiguous execution into an explicit reconciliation step", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [],
      keeperHub: [
        {
          workflowId: "wf_1",
          executionId: "exec_unknown",
          status: "unknown",
          verified: false,
          receiptStatus: "timeout",
          observedVaultStatus: "RECOVERY_REQUIRED",
        },
      ],
    });
    expect(timeline[0]).toMatchObject({
      title: "Execution needs reconciliation",
      tone: "danger",
      action: "Inspect the existing execution and transaction before attempting another write.",
    });
  });

  it("labels completed no-write runs as eligibility checks rather than transactions", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [],
      keeperHub: [{
        workflowId: "wf_1",
        executionId: "exec_check",
        status: "verified",
        verified: true,
        outcome: "NO_WRITE",
        observedVaultStatus: "ACTIVE",
      }],
    });
    expect(timeline[0]).toMatchObject({
      title: "Eligibility check completed",
      detail: "KeeperHub completed the workflow without an onchain write; the vault remained ACTIVE.",
    });
  });
});
