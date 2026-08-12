import { describe, expect, it } from "vitest";

import { policyHashInput, validatePolicy } from "./policy";
import type { SuccessionPolicy } from "./types";

const policy: SuccessionPolicy = {
  owner: "0x1111111111111111111111111111111111111111",
  guardian: "0x2222222222222222222222222222222222222222",
  beneficiaries: [
    {
      address: "0x3333333333333333333333333333333333333333",
      label: "Amara",
      shareBps: 6000,
    },
    {
      address: "0x4444444444444444444444444444444444444444",
      label: "Tobi",
      shareBps: 4000,
    },
  ],
  heartbeatIntervalSeconds: 30 * 24 * 60 * 60,
  gracePeriodSeconds: 14 * 24 * 60 * 60,
  version: 1,
};

describe("validatePolicy", () => {
  it("accepts a policy whose distinct beneficiaries total 10,000 basis points", () => {
    expect(validatePolicy(policy)).toEqual({ ok: true, errors: [] });
  });

  it("rejects shares that do not total 10,000 basis points", () => {
    const invalid: SuccessionPolicy = {
      ...policy,
      beneficiaries: policy.beneficiaries.map((beneficiary) => ({
        ...beneficiary,
        shareBps: 4000,
      })),
    };

    expect(validatePolicy(invalid)).toEqual({
      ok: false,
      errors: ["Beneficiary shares must total exactly 10,000 basis points."],
    });
  });

  it("rejects duplicate and zero beneficiary addresses", () => {
    const invalid: SuccessionPolicy = {
      ...policy,
      beneficiaries: [
        { ...policy.beneficiaries[0], address: "0x0000000000000000000000000000000000000000" },
        { ...policy.beneficiaries[1], address: "0x0000000000000000000000000000000000000000" },
      ],
    };

    expect(validatePolicy(invalid)).toEqual({
      ok: false,
      errors: [
        "Beneficiary addresses cannot be the zero address.",
        "Beneficiary addresses must be unique.",
      ],
    });
  });

  it("rejects heartbeat or grace periods shorter than one hour", () => {
    expect(
      validatePolicy({
        ...policy,
        heartbeatIntervalSeconds: 3599,
        gracePeriodSeconds: 60,
      }),
    ).toEqual({
      ok: false,
      errors: [
        "Heartbeat interval must be at least one hour.",
        "Grace period must be at least one hour.",
      ],
    });
  });

  it("rejects overlapping owner, guardian, and beneficiary roles", () => {
    expect(validatePolicy({
      ...policy,
      guardian: policy.owner,
      beneficiaries: [{ ...policy.beneficiaries[0], address: policy.owner }, policy.beneficiaries[1]],
    })).toEqual({
      ok: false,
      errors: [
        "Guardian must be different from the owner.",
        "Beneficiaries must be different from the owner and guardian.",
      ],
    });
  });

  it("rejects more than ten beneficiaries", () => {
    expect(validatePolicy({
      ...policy,
      beneficiaries: Array.from({ length: 11 }, (_, index) => ({
        address: `0x${String(index + 10).padStart(40, "0")}`,
        label: `Beneficiary ${index + 1}`,
        shareBps: index === 10 ? 910 : 909,
      })) as SuccessionPolicy["beneficiaries"],
    })).toEqual({ ok: false, errors: ["A policy can include at most 10 beneficiaries."] });
  });
});

describe("policyHashInput", () => {
  it("normalizes addresses and omits human labels from signed policy data", () => {
    expect(policyHashInput(policy)).toEqual({
      owner: "0x1111111111111111111111111111111111111111",
      guardian: "0x2222222222222222222222222222222222222222",
      beneficiaries: [
        { address: "0x3333333333333333333333333333333333333333", shareBps: 6000 },
        { address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
      ],
      heartbeatIntervalSeconds: 2592000,
      gracePeriodSeconds: 1209600,
      version: 1,
    });
  });
});
