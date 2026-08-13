import { describe, expect, it } from "vitest";

import { buildChainAuditEvents } from "./chain-events";

const transactionHash = `0x${"a".repeat(64)}` as const;

describe("buildChainAuditEvents", () => {
  it("attaches real block time, block number, actor, amount, and policy version", () => {
    expect(buildChainAuditEvents([
      {
        eventName: "SettlementFinalized",
        blockNumber: 42n,
        transactionHash,
        logIndex: 3,
        args: { caller: "0x1111111111111111111111111111111111111111", balance: 250000000000000000n, policyVersion: 7n },
      },
    ], new Map([[42n, 1_800_000_000n]]))).toEqual([{
      id: `${transactionHash}-3`,
      type: "SettlementFinalized",
      timestamp: 1_800_000_000n,
      blockNumber: 42n,
      transactionHash,
      actor: "0x1111111111111111111111111111111111111111",
      amountWei: 250000000000000000n,
      policyVersion: 7n,
    }]);
  });

  it("drops unknown or unconfirmed logs instead of fabricating provenance", () => {
    expect(buildChainAuditEvents([
      { eventName: "UnknownEvent", blockNumber: 42n, transactionHash, logIndex: 0, args: {} },
      { eventName: "Heartbeat", blockNumber: null, transactionHash, logIndex: 1, args: {} },
    ], new Map([[42n, 1_800_000_000n]]))).toEqual([]);
  });

  it("uses the explicit transaction actor instead of a policy value or withdrawal recipient", () => {
    const owner = "0x1111111111111111111111111111111111111111" as const;
    const guardian = "0x2222222222222222222222222222222222222222" as const;
    const recipient = "0x3333333333333333333333333333333333333333" as const;
    const events = buildChainAuditEvents([
      { eventName: "PolicyUpdated", blockNumber: 42n, transactionHash, logIndex: 1, args: { guardian, actor: owner } },
      { eventName: "Withdrawal", blockNumber: 42n, transactionHash, logIndex: 2, args: { recipient, actor: owner } },
      { eventName: "PolicyUpdated", blockNumber: 42n, transactionHash, logIndex: 3, args: { guardian } },
    ], new Map([[42n, 1_800_000_000n]]));

    expect(events.map((event) => event.actor)).toEqual([owner, owner, undefined]);
  });

  it("preserves complete policy terms from a policy update event", () => {
    const beneficiaryA = "0x3333333333333333333333333333333333333333" as const;
    const beneficiaryB = "0x4444444444444444444444444444444444444444" as const;
    const events = buildChainAuditEvents([{
      eventName: "PolicyUpdated",
      blockNumber: 42n,
      transactionHash,
      logIndex: 0,
      args: {
        policyVersion: 3n,
        guardian: "0x2222222222222222222222222222222222222222",
        actor: "0x1111111111111111111111111111111111111111",
        heartbeatInterval: 2_592_000n,
        gracePeriod: 1_209_600n,
        beneficiaries: [beneficiaryA, beneficiaryB],
        shares: [6_000, 4_000],
      },
    }], new Map([[42n, 1_800_000_000n]]));

    expect(events[0]).toMatchObject({
      policyVersion: 3n,
      guardian: "0x2222222222222222222222222222222222222222",
      heartbeatInterval: 2_592_000n,
      gracePeriod: 1_209_600n,
      allocations: [
        { beneficiary: beneficiaryA, shareBps: 6_000 },
        { beneficiary: beneficiaryB, shareBps: 4_000 },
      ],
    });
  });

  it("does not present malformed allocation evidence as a complete policy", () => {
    const baseArgs = {
      policyVersion: 3n,
      guardian: "0x2222222222222222222222222222222222222222",
      actor: "0x1111111111111111111111111111111111111111",
      heartbeatInterval: 2_592_000n,
      gracePeriod: 1_209_600n,
      beneficiaries: [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
      ],
    };
    const events = buildChainAuditEvents([{
      eventName: "PolicyUpdated",
      blockNumber: 42n,
      transactionHash,
      logIndex: 0,
      args: { ...baseArgs, shares: [6_000, 3_999] },
    }], new Map([[42n, 1_800_000_000n]]));

    expect(events[0]).not.toHaveProperty("guardian");
    expect(events[0]).not.toHaveProperty("allocations");
  });
});
