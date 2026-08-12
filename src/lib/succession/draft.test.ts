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
});
