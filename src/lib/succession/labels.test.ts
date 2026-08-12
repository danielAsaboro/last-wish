import { describe, expect, it } from "vitest";

import { mergeBeneficiaryLabels, parseBeneficiaryLabels } from "./labels";

describe("beneficiary display labels", () => {
  it("merges saved labels by normalized address without changing chain values", () => {
    expect(mergeBeneficiaryLabels([
      { address: "0x1111111111111111111111111111111111111111", shareBps: 6000 },
      { address: "0x2222222222222222222222222222222222222222", shareBps: 4000 },
    ], {
      "0X1111111111111111111111111111111111111111": "Amara",
    })).toEqual([
      { address: "0x1111111111111111111111111111111111111111", shareBps: 6000, label: "Amara" },
      { address: "0x2222222222222222222222222222222222222222", shareBps: 4000, label: "Beneficiary 2" },
    ]);
  });

  it("rejects malformed, oversized, and address-invalid stored metadata", () => {
    expect(parseBeneficiaryLabels("not-json")).toEqual({});
    expect(parseBeneficiaryLabels(JSON.stringify({ wrong: "Name" }))).toEqual({});
    expect(parseBeneficiaryLabels(JSON.stringify({
      "0x1111111111111111111111111111111111111111": "x".repeat(61),
    }))).toEqual({});
  });
});
