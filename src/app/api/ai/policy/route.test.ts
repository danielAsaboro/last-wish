import { afterEach, describe, expect, it } from "vitest";

import { handlePolicyRequest } from "@/lib/ai/policy-route";
import { POST } from "./route";

describe("POST /api/ai/policy", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it("returns unavailable instead of presenting a deterministic response as AI", async () => {
    const request = new Request("http://localhost/api/ai/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        beneficiaries: [{ label: "Ada", address: "0x1111111111111111111111111111111111111111" }],
        notes: "Split the policy evenly and keep a conservative review window.",
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      available: false,
      error: "Policy Copilot is unavailable because no AI provider credential is configured.",
    });
  });

  it("rejects malformed input before invoking a provider", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/policy", {
        method: "POST",
        body: JSON.stringify({ goal: "execute settlement" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("does not expose provider failures or credential-bearing URLs", async () => {
    process.env.OPENAI_API_KEY = "configured";
    const request = new Request("http://localhost/api/ai/policy", {
      method: "POST",
      body: JSON.stringify({
        beneficiaries: [{ label: "Ada", address: "0x1111111111111111111111111111111111111111" }],
        notes: "Prefer a conservative guardian review window.",
      }),
    });
    const response = await handlePolicyRequest(request, async () => {
      throw new Error("Provider failed at https://api.example/v1?token=secret-value");
    });

    expect(response.status).toBe(502);
    expect(await response.text()).toBe(JSON.stringify({ error: "Policy Copilot could not produce a valid draft. Try again." }));
  });
});
