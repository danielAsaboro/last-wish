import { describe, expect, it } from "vitest";

import {
  assertSuccessfulReceipt,
  reconcileTransactionReceipt,
  submitAndConfirmTransaction,
} from "./transaction";

describe("assertSuccessfulReceipt", () => {
  it("rejects a mined-but-reverted wallet transaction", () => {
    expect(() => assertSuccessfulReceipt({ status: "reverted", blockNumber: 42n })).toThrow("Transaction reverted in block 42.");
  });

  it("returns a successful receipt for follow-up state reconciliation", () => {
    const receipt = { status: "success" as const, blockNumber: 43n };
    expect(assertSuccessfulReceipt(receipt)).toBe(receipt);
  });
});

describe("submitAndConfirmTransaction", () => {
  const hash = `0x${"a".repeat(64)}` as const;

  it("keeps a submitted hash when receipt confirmation becomes ambiguous", async () => {
    const submitted: string[] = [];
    const result = await submitAndConfirmTransaction({
      submit: async () => hash,
      waitForReceipt: async () => { throw new Error("https://rpc.example/private-token timed out"); },
      onSubmitted: (transactionHash) => submitted.push(transactionHash),
    });

    expect(submitted).toEqual([hash]);
    expect(result).toEqual({ kind: "recovery_required", transactionHash: hash });
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("returns a terminal reverted result instead of treating it as ambiguous", async () => {
    await expect(submitAndConfirmTransaction({
      submit: async () => hash,
      waitForReceipt: async () => ({ status: "reverted", blockNumber: 42n, logs: [] }),
    })).resolves.toEqual({ kind: "reverted", transactionHash: hash, blockNumber: 42n });
  });

  it("keeps an unrecognized receipt status in recovery instead of calling it reverted", async () => {
    await expect(submitAndConfirmTransaction({
      submit: async () => hash,
      waitForReceipt: async () => ({ status: "pending", blockNumber: 42n, logs: [] }),
    })).resolves.toEqual({ kind: "recovery_required", transactionHash: hash });
  });

  it("does not confirm a successful receipt for a different contract target", async () => {
    await expect(submitAndConfirmTransaction({
      submit: async () => hash,
      waitForReceipt: async () => ({ status: "success", blockNumber: 42n, to: "0x3333333333333333333333333333333333333333", logs: [] }),
      expectedTarget: "0x2222222222222222222222222222222222222222",
    })).resolves.toEqual({ kind: "recovery_required", transactionHash: hash });
  });

  it("classifies a rejected signature without exposing wallet error text", async () => {
    const rejected = Object.assign(new Error("User rejected request at https://wallet.example/private"), { code: 4001 });
    const result = await submitAndConfirmTransaction({
      submit: async () => { throw rejected; },
      waitForReceipt: async () => ({ status: "success", blockNumber: 42n, logs: [] }),
    });

    expect(result).toEqual({ kind: "not_submitted", reason: "rejected" });
    expect(JSON.stringify(result)).not.toContain("wallet.example");
  });

  it("classifies insufficient funds using fixed output", async () => {
    const result = await submitAndConfirmTransaction({
      submit: async () => { throw new Error("insufficient funds for gas * price + value at https://rpc.example/token"); },
      waitForReceipt: async () => ({ status: "success", blockNumber: 42n, logs: [] }),
    });

    expect(result).toEqual({ kind: "not_submitted", reason: "insufficient_funds" });
  });
});

describe("reconcileTransactionReceipt", () => {
  const hash = `0x${"b".repeat(64)}` as const;

  it("resolves a successful receipt through a read-only lookup", async () => {
    const receipt = { status: "success" as const, blockNumber: 51n, logs: [] };
    await expect(reconcileTransactionReceipt(hash, async () => receipt)).resolves.toEqual({
      kind: "confirmed",
      transactionHash: hash,
      receipt,
    });
  });

  it("keeps recovery required when the receipt lookup is unavailable", async () => {
    await expect(reconcileTransactionReceipt(hash, async () => {
      throw new Error("https://rpc.example/private-token unavailable");
    })).resolves.toEqual({ kind: "recovery_required", transactionHash: hash });
  });

  it("keeps recovery required when the receipt target does not match the reviewed target", async () => {
    await expect(reconcileTransactionReceipt(
      hash,
      async () => ({ status: "success" as const, blockNumber: 52n, to: "0x3333333333333333333333333333333333333333", logs: [] }),
      "0x2222222222222222222222222222222222222222",
    )).resolves.toEqual({ kind: "recovery_required", transactionHash: hash });
  });
});
