import {
  copilotInputSchema,
  draftPolicyWithAi,
  isCopilotConfigured,
} from "./policy-copilot";
import type { CopilotDraft } from "./policy-copilot-schema";

export async function handlePolicyRequest(
  request: Request,
  draftPolicy: (input: unknown) => Promise<CopilotDraft> = draftPolicyWithAi,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid Policy Copilot request" }, { status: 400 });
  }
  const parsed = copilotInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid Policy Copilot request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isCopilotConfigured()) {
    return Response.json(
      {
        available: false,
        error: "Policy Copilot is unavailable because no AI provider credential is configured.",
      },
      { status: 503 },
    );
  }
  try {
    const draft = await draftPolicy(parsed.data);
    return Response.json({ available: true, source: "ai", draft });
  } catch {
    return Response.json({ error: "Policy Copilot could not produce a valid draft. Try again." }, { status: 502 });
  }
}
