import { describe, expect, it } from "vitest";

import { labelsFromDraft, mergeBeneficiaryLabels, parseBeneficiaryLabels } from "./labels";

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

  it("preserves valid entries when another locally stored label is invalid", () => {
    expect(parseBeneficiaryLabels(JSON.stringify({
      "0x1111111111111111111111111111111111111111": "Amara",
      "0x2222222222222222222222222222222222222222": "x".repeat(61),
      wrong: "Ignored",
    }))).toEqual({ "0x1111111111111111111111111111111111111111": "Amara" });
  });

  it("does not persist invalid draft label metadata", () => {
    expect(labelsFromDraft([
      { address: "0x1111111111111111111111111111111111111111", label: " Amara " },
      { address: "not-an-address", label: "Ignored" },
      { address: "0x2222222222222222222222222222222222222222", label: "x".repeat(61) },
    ])).toEqual({ "0x1111111111111111111111111111111111111111": "Amara" });
  });
});
