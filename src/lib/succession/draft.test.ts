import { describe, expect, it } from "vitest";

import { buildPolicyArguments } from "./draft";

const owner = "0x1111111111111111111111111111111111111111";

describe("buildPolicyArguments", () => {
  it("normalizes a safe day-based dashboard policy into contract arguments", () => {
    expect(
      buildPolicyArguments({
        owner,
        guardian: "0x2222222222222222222222222222222222222222",
        beneficiaries: [
          { label: "Ada", address: "0x3333333333333333333333333333333333333333", shareBps: 6000 },
          { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
        ],
        heartbeatDays: 30,
        graceDays: 14,
        testnetDemo: false,
      }),
    ).toEqual({
      guardian: "0x2222222222222222222222222222222222222222",
      beneficiaryAddresses: [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
      ],
      shares: [6000, 4000],
      heartbeatSeconds: 2592000n,
      graceSeconds: 1209600n,
      testnetDemo: false,
    });
  });

  it("rejects role overlap and malformed addresses before a wallet request", () => {
    expect(() =>
      buildPolicyArguments({
        owner,
        guardian: owner,
        beneficiaries: [{ label: "Ada", address: "not-an-address", shareBps: 10000 }],
        heartbeatDays: 30,
        graceDays: 14,
        testnetDemo: false,
      }),
    ).toThrow(/guardian must be different|valid evm address/i);
  });

  it("rejects beneficiary role overlap and beneficiary sets larger than ten", () => {
    const base = {
      owner,
      guardian: "0x2222222222222222222222222222222222222222",
      heartbeatDays: 30,
      graceDays: 14,
      testnetDemo: false,
    };
    expect(() => buildPolicyArguments({
      ...base,
      beneficiaries: [{ label: "Owner", address: owner, shareBps: 10000 }],
    })).toThrow(/different from the owner and guardian/i);

    expect(() => buildPolicyArguments({
      ...base,
      beneficiaries: Array.from({ length: 11 }, (_, index) => ({
        label: `Beneficiary ${index + 1}`,
        address: `0x${String(index + 10).padStart(40, "0")}`,
        shareBps: index === 10 ? 910 : 909,
      })),
    })).toThrow(/at most 10 beneficiaries/i);
  });

  it("rejects timing that exceeds the contract safety horizon", () => {
    expect(() => buildPolicyArguments({
      owner,
      guardian: "0x2222222222222222222222222222222222222222",
      beneficiaries: [{ label: "Ada", address: "0x3333333333333333333333333333333333333333", shareBps: 10000 }],
      heartbeatDays: 3651,
      graceDays: 14,
      testnetDemo: false,
    })).toThrow(/10 years/i);
  });
});
