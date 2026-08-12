import { describe, expect, it } from "vitest";

import { copilotInputSchema, copilotOutputSchema, isCopilotConfigured } from "./policy-copilot";

describe("Policy Copilot schemas", () => {
  it("rejects requests that ask the model to decide eligibility or submit transactions", () => {
    expect(copilotInputSchema.safeParse({ goal: "settle this vault now", owner: "0x123" }).success).toBe(false);
  });

  it("accepts only complete 10,000-basis-point structured drafts", () => {
    expect(
      copilotOutputSchema.safeParse({
        beneficiaries: [
          { label: "Ada", address: "0x1111111111111111111111111111111111111111", shareBps: 6000 },
          { label: "Lin", address: "0x2222222222222222222222222222222222222222", shareBps: 4000 },
        ],
        heartbeatDays: 30,
        graceDays: 14,
        explanation: "A monthly owner heartbeat with a two-week guardian review window.",
      }).success,
    ).toBe(true);
    expect(
      copilotOutputSchema.safeParse({
        beneficiaries: [{ label: "Ada", address: "0x1111111111111111111111111111111111111111", shareBps: 9000 }],
        heartbeatDays: 30,
        graceDays: 14,
        explanation: "Invalid total.",
      }).success,
    ).toBe(false);
  });

  it("reports unavailable without an AI credential", () => {
    expect(isCopilotConfigured({})).toBe(false);
  });
});
