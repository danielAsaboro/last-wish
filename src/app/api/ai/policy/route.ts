import { ZodError } from "zod";

import {
  copilotInputSchema,
  draftPolicyWithAi,
  isCopilotConfigured,
} from "@/lib/ai/policy-copilot";

export async function POST(request: Request) {
  try {
    const body = await request.json();
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
    const draft = await draftPolicyWithAi(parsed.data);
    return Response.json({ available: true, source: "ai", draft });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return Response.json({ error: "Invalid Policy Copilot request" }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Policy Copilot failed" },
      { status: 502 },
    );
  }
}
