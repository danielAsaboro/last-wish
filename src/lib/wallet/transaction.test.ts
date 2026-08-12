import { describe, expect, it } from "vitest";

import { assertSuccessfulReceipt } from "./transaction";

describe("assertSuccessfulReceipt", () => {
  it("rejects a mined-but-reverted wallet transaction", () => {
    expect(() => assertSuccessfulReceipt({ status: "reverted", blockNumber: 42n })).toThrow("Transaction reverted in block 42.");
  });

  it("returns a successful receipt for follow-up state reconciliation", () => {
    const receipt = { status: "success" as const, blockNumber: 43n };
    expect(assertSuccessfulReceipt(receipt)).toBe(receipt);
  });
});
