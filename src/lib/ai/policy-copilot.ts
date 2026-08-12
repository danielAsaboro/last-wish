import { openai } from "@ai-sdk/openai";
import { gateway, generateText, Output } from "ai";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const copilotInputSchema = z
  .object({
    beneficiaries: z
      .array(z.object({ label: z.string().trim().min(1).max(60), address: addressSchema }))
      .min(1)
      .max(10),
    notes: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const copilotOutputSchema = z
  .object({
    beneficiaries: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60),
          address: addressSchema,
          shareBps: z.number().int().min(1).max(10_000),
        }),
      )
      .min(1)
      .max(10),
    heartbeatDays: z.number().int().min(1).max(365),
    graceDays: z.number().int().min(1).max(90),
    explanation: z.string().trim().min(20).max(800),
  })
  .superRefine((draft, context) => {
    const total = draft.beneficiaries.reduce((sum, beneficiary) => sum + beneficiary.shareBps, 0);
    if (total !== 10_000) {
      context.addIssue({ code: "custom", path: ["beneficiaries"], message: "Shares must total 10,000 basis points" });
    }
    const unique = new Set(draft.beneficiaries.map((beneficiary) => beneficiary.address.toLowerCase()));
    if (unique.size !== draft.beneficiaries.length) {
      context.addIssue({ code: "custom", path: ["beneficiaries"], message: "Beneficiary addresses must be unique" });
    }
  });

export type CopilotInput = z.infer<typeof copilotInputSchema>;
export type CopilotDraft = z.infer<typeof copilotOutputSchema>;

export function copilotProviderConfiguration(env: Record<string, string | undefined> = process.env): { kind: "openai" | "gateway"; modelId: string } | undefined {
  if (env.OPENAI_API_KEY) return { kind: "openai", modelId: env.OPENAI_MODEL ?? "gpt-5-mini" };
  if (env.AI_GATEWAY_API_KEY) return { kind: "gateway", modelId: env.AI_GATEWAY_MODEL ?? "openai/gpt-5-mini" };
  return undefined;
}

export function isCopilotConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return copilotProviderConfiguration(env) !== undefined;
}

export function assertCopilotPreservesBeneficiaries(input: CopilotInput, draft: CopilotDraft): void {
  const supplied = new Map(input.beneficiaries.map((beneficiary) => [
    beneficiary.address.toLowerCase(),
    beneficiary.label,
  ]));
  const preserved = draft.beneficiaries.length === supplied.size && draft.beneficiaries.every(
    (beneficiary) => supplied.get(beneficiary.address.toLowerCase()) === beneficiary.label,
  );
  if (!preserved) throw new Error("The AI draft must preserve every supplied beneficiary address and label.");
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
