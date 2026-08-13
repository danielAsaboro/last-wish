import "server-only";

import { openai } from "@ai-sdk/openai";
import { gateway, generateText, Output } from "ai";
import {
  assertCopilotPreservesBeneficiaries,
  copilotInputSchema,
  copilotOutputSchema,
  type CopilotDraft,
} from "./policy-copilot-schema";

export {
  assertCopilotPreservesBeneficiaries,
  copilotInputSchema,
  copilotOutputSchema,
  type CopilotDraft,
  type CopilotInput,
} from "./policy-copilot-schema";

export function copilotProviderConfiguration(env: Record<string, string | undefined> = process.env): { kind: "openai" | "gateway"; modelId: string } | undefined {
  if (env.OPENAI_API_KEY) return { kind: "openai", modelId: env.OPENAI_MODEL ?? "gpt-5-mini" };
  if (env.AI_GATEWAY_API_KEY) return { kind: "gateway", modelId: env.AI_GATEWAY_MODEL ?? "openai/gpt-5-mini" };
  return undefined;
}

export function isCopilotConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return copilotProviderConfiguration(env) !== undefined;
}

export async function draftPolicyWithAi(input: unknown): Promise<CopilotDraft> {
  const provider = copilotProviderConfiguration();
  if (!provider) throw new Error("Policy Copilot is unavailable because no AI provider credential is configured.");
  const parsed = copilotInputSchema.parse(input);
  const { output } = await generateText({
    model: provider.kind === "openai" ? openai(provider.modelId) : gateway(provider.modelId),
    output: Output.object({ schema: copilotOutputSchema }),
    system:
      "You draft unsigned digital-asset succession policy parameters. Never decide settlement eligibility, initiate transactions, provide legal advice, or alter supplied addresses. Shares must total exactly 10,000 basis points.",
    prompt: `Draft shares and timing for these supplied beneficiaries: ${JSON.stringify(parsed)}. Use days, not demo-length intervals.`,
  });

  assertCopilotPreservesBeneficiaries(parsed, output);
  return output;
}
