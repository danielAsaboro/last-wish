import { afterEach, describe, expect, it } from "vitest";

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
});
