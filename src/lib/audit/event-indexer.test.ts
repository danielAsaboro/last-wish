import { describe, expect, it } from "vitest";

import { readEventHistoryInWindows } from "./event-indexer";

describe("readEventHistoryInWindows", () => {
  it("splits an inclusive event range into bounded contiguous windows", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const logs = await readEventHistoryInWindows({
      fromBlock: 7n,
      toBlock: 25_010n,
      readRange: async (fromBlock, toBlock) => {
        calls.push([fromBlock, toBlock]);
        return [`${fromBlock}-${toBlock}`];
      },
    });

    expect(calls).toEqual([[7n, 10_006n], [10_007n, 20_006n], [20_007n, 25_010n]]);
    expect(logs).toEqual(["7-10006", "10007-20006", "20007-25010"]);
  });

  it("returns no logs without reading when the range is reversed", async () => {
    let calls = 0;
    const logs = await readEventHistoryInWindows({
      fromBlock: 5n,
      toBlock: 4n,
      readRange: async () => {
        calls += 1;
        return ["unexpected"];
      },
    });

    expect(calls).toBe(0);
    expect(logs).toEqual([]);
  });

  it("reads a one-block range as one inclusive window", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const logs = await readEventHistoryInWindows({
      fromBlock: 42n,
      toBlock: 42n,
      readRange: async (fromBlock, toBlock) => {
        calls.push([fromBlock, toBlock]);
        return ["log"];
      },
    });

    expect(calls).toEqual([[42n, 42n]]);
    expect(logs).toEqual(["log"]);
  });

  it("stops on rejection without returning a partial result", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const failure = new Error("read failed");

    await expect(readEventHistoryInWindows({
      fromBlock: 7n,
      toBlock: 25_010n,
      readRange: async (fromBlock, toBlock) => {
        calls.push([fromBlock, toBlock]);
        if (fromBlock === 10_007n) throw failure;
        return ["partial"];
      },
    })).rejects.toBe(failure);

    expect(calls).toEqual([[7n, 10_006n], [10_007n, 20_006n]]);
  });
});
