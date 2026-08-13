import { describe, expect, it } from "vitest";

import { buildAuditTimeline } from "./timeline";

describe("buildAuditTimeline", () => {
  it("orders chain and KeeperHub evidence while preserving provenance", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [
        { id: "policy-1", type: "PolicyUpdated", timestamp: 100n, blockNumber: 10n, transactionHash: `0x${"1".repeat(64)}` },
        { id: "heartbeat-1", type: "Heartbeat", timestamp: 120n, blockNumber: 12n, transactionHash: `0x${"2".repeat(64)}` },
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
          timestamp: 130n,
          blockNumber: 99n,
          gasUsed: 70_000n,
        },
      ],
    });
    expect(timeline.map((item) => item.source)).toEqual(["keeperhub", "chain", "chain"]);
    expect(timeline[0]).toMatchObject({
      title: "KeeperHub execution verified",
      tone: "success",
      blockNumber: 99n,
      gasUsed: 70_000n,
      receiptStatus: "success",
      observedVaultStatus: "PENDING",
    });
  });

  it("shows human-readable value and actor provenance for chain events", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [{
        id: "deposit",
        type: "Deposit",
        timestamp: 1_800_000_000n,
        blockNumber: 42n,
        transactionHash: `0x${"4".repeat(64)}`,
        actor: "0x1111111111111111111111111111111111111111",
        amountWei: 250000000000000000n,
      }],
      keeperHub: [],
    });
    expect(timeline[0]).toMatchObject({
      detail: "0.25 ETH · confirmed in block 42 · actor 0x1111…1111.",
      timestamp: 1_800_000_000n,
      blockNumber: 42n,
    });
  });

  it("preserves policy lineage across chain and KeeperHub evidence", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [{
        id: "opened",
        type: "SettlementOpened",
        timestamp: 100n,
        blockNumber: 42n,
        transactionHash: `0x${"4".repeat(64)}`,
        policyVersion: 7n,
      }],
      keeperHub: [{
        workflowId: "wf_open",
        executionId: "exec_open",
        status: "verified",
        verified: true,
        observedVaultStatus: "PENDING",
        policyVersion: 7n,
        workflowAction: "open",
        timestamp: 101n,
      }],
    });

    expect(timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "chain", policyVersion: 7n }),
      expect.objectContaining({ source: "keeperhub", policyVersion: 7n, workflowAction: "open" }),
    ]));
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

  it("includes safe failed-node context in a failed KeeperHub audit item", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [],
      keeperHub: [{
        workflowId: "wf_1",
        executionId: "exec_failed",
        status: "failed",
        verified: false,
        failedNode: "Open grace",
        failureReason: "RPC timeout after simulation.",
      }],
    });
    expect(timeline[0]).toMatchObject({
      title: "KeeperHub execution failed",
      detail: "Open grace failed: RPC timeout after simulation.",
      tone: "danger",
    });
  });

  it("keeps failed-node context visible while an attempted write awaits reconciliation", () => {
    const timeline = buildAuditTimeline({
      chainEvents: [],
      keeperHub: [{
        workflowId: "wf_1",
        executionId: "exec_ambiguous",
        status: "unknown",
        verified: false,
        transactionHash: `0x${"a".repeat(64)}`,
        observedVaultStatus: "RECOVERY_REQUIRED",
        failedNode: "Open grace",
        failureReason: "Receipt lookup timed out.",
      }],
    });
    expect(timeline[0].detail).toContain("Open grace failed: Receipt lookup timed out.");
    expect(timeline[0].detail).toContain("not safe to retry automatically");
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

  it("includes an unresolved wallet submission as recovery evidence", () => {
    const transactionHash = `0x${"b".repeat(64)}` as const;
    const timeline = buildAuditTimeline({
      chainEvents: [],
      keeperHub: [],
      walletRecovery: {
        label: "Withdraw funds",
        transactionHash,
        target: "0x2222222222222222222222222222222222222222",
      },
    });

    expect(timeline[0]).toMatchObject({
      source: "wallet",
      title: "Wallet transaction needs reconciliation",
      tone: "danger",
      transactionHash,
      action: "Do not submit another write to this vault until this hash has a terminal receipt.",
    });
  });
});
