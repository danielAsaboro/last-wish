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

const copilotSuccessResponseSchema = z.object({
  available: z.literal(true),
  source: z.literal("ai"),
  draft: copilotOutputSchema,
}).strict();

export type CopilotInput = z.infer<typeof copilotInputSchema>;
export type CopilotDraft = z.infer<typeof copilotOutputSchema>;

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

export function parseCopilotSuccessResponse(response: unknown, request: unknown): CopilotDraft {
  try {
    const input = copilotInputSchema.parse(request);
    const parsed = copilotSuccessResponseSchema.parse(response);
    assertCopilotPreservesBeneficiaries(input, parsed.draft);
    return parsed.draft;
  } catch {
    throw new Error("Policy Copilot returned an invalid draft. Your policy was not changed.");
  }
}
