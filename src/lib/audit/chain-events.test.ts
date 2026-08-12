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
});
