import { describe, expect, it } from "vitest";

import { parseCopilotSuccessResponse } from "./policy-copilot-schema";

const input = {
  beneficiaries: [
    { label: "Ada", address: "0x1111111111111111111111111111111111111111" },
    { label: "Lin", address: "0x2222222222222222222222222222222222222222" },
  ],
  notes: "Prefer a conservative guardian review window.",
};

describe("parseCopilotSuccessResponse", () => {
  it("accepts a structured AI draft only when supplied beneficiary identity is preserved", () => {
    expect(parseCopilotSuccessResponse({
      available: true,
      source: "ai",
      draft: {
        beneficiaries: [
          { ...input.beneficiaries[0], shareBps: 6_000 },
          { ...input.beneficiaries[1], shareBps: 4_000 },
        ],
        heartbeatDays: 45,
        graceDays: 21,
        explanation: "A conservative timing window gives the holder and guardian more time to review state changes.",
      },
    }, input)).toMatchObject({ heartbeatDays: 45, beneficiaries: [{ shareBps: 6_000 }, { shareBps: 4_000 }] });

    expect(() => parseCopilotSuccessResponse({
      available: true,
      source: "ai",
      draft: {
        beneficiaries: [
          { label: "Ada", address: "0x3333333333333333333333333333333333333333", shareBps: 6_000 },
          { ...input.beneficiaries[1], shareBps: 4_000 },
        ],
        heartbeatDays: 45,
        graceDays: 21,
        explanation: "This response changed a beneficiary address and must not reach the unsigned policy editor.",
      },
    }, input)).toThrow(/invalid draft.*not changed/i);
  });

  it("requires an exact AI response envelope", () => {
    const draft = {
      beneficiaries: [
        { ...input.beneficiaries[0], shareBps: 6_000 },
        { ...input.beneficiaries[1], shareBps: 4_000 },
      ],
      heartbeatDays: 45,
      graceDays: 21,
      explanation: "A conservative timing window gives the holder and guardian more time to review state changes.",
    };
    expect(() => parseCopilotSuccessResponse({ available: true, source: "deterministic", draft }, input)).toThrow(/invalid draft/i);
    expect(() => parseCopilotSuccessResponse({ available: true, source: "ai", draft, providerKey: "secret" }, input)).toThrow(/invalid draft/i);
  });
});
