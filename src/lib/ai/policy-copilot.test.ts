import { describe, expect, it } from "vitest";

import { assertCopilotPreservesBeneficiaries, copilotInputSchema, copilotOutputSchema, copilotProviderConfiguration, isCopilotConfigured } from "./policy-copilot";

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

  it("selects a provider-compatible model for OpenAI and AI Gateway credentials", () => {
    expect(copilotProviderConfiguration({ OPENAI_API_KEY: "secret", OPENAI_MODEL: "gpt-5-mini" })).toEqual({ kind: "openai", modelId: "gpt-5-mini" });
    expect(copilotProviderConfiguration({ AI_GATEWAY_API_KEY: "secret" })).toEqual({ kind: "gateway", modelId: "openai/gpt-5-mini" });
    expect(copilotProviderConfiguration({ AI_GATEWAY_API_KEY: "secret", AI_GATEWAY_MODEL: "anthropic/claude-sonnet-4.5" })).toEqual({ kind: "gateway", modelId: "anthropic/claude-sonnet-4.5" });
  });

  it("rejects drafts that add, remove, or relabel supplied beneficiaries", () => {
    const input = {
      beneficiaries: [
        { label: "Ada", address: "0x1111111111111111111111111111111111111111" },
        { label: "Lin", address: "0x2222222222222222222222222222222222222222" },
      ],
      notes: "Keep both beneficiaries.",
    };
    const validDraft = {
      beneficiaries: [
        { ...input.beneficiaries[1], shareBps: 4000 },
        { ...input.beneficiaries[0], shareBps: 6000 },
      ],
      heartbeatDays: 30,
      graceDays: 14,
      explanation: "A monthly heartbeat with a two-week guardian review window.",
    };
    expect(() => assertCopilotPreservesBeneficiaries(input, validDraft)).not.toThrow();
    expect(() => assertCopilotPreservesBeneficiaries(input, { ...validDraft, beneficiaries: validDraft.beneficiaries.slice(0, 1) })).toThrow(/preserve every/i);
    expect(() => assertCopilotPreservesBeneficiaries(input, { ...validDraft, beneficiaries: [{ ...validDraft.beneficiaries[0], label: "Changed" }, validDraft.beneficiaries[1]] })).toThrow(/preserve every/i);
  });
});
