import { describe, expect, it } from "vitest";

import { selectCreatedVault } from "./deployment-receipt";

const factory = "0x5555555555555555555555555555555555555555" as const;
const owner = "0x1111111111111111111111111111111111111111" as const;
const vault = "0x2222222222222222222222222222222222222222" as const;

describe("selectCreatedVault", () => {
  it("accepts only the trusted factory event for the submitting owner", () => {
    expect(selectCreatedVault([
      { address: factory, args: { owner, vault } },
    ], factory, owner)).toBe(vault);
  });

  it("rejects an event emitted by another contract", () => {
    expect(selectCreatedVault([
      { address: "0x4444444444444444444444444444444444444444", args: { owner, vault } },
    ], factory, owner)).toBeUndefined();
  });

  it("rejects an event for a different owner", () => {
    expect(selectCreatedVault([
      { address: factory, args: { owner: "0x3333333333333333333333333333333333333333", vault } },
    ], factory, owner)).toBeUndefined();
  });
});
