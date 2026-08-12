import { describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("POST /api/keeperhub/evidence", () => {
  it("rejects malformed vault and workflow registrations", async () => {
    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST",
      body: JSON.stringify({ chainId: 84532, vault: "wrong", registrations: [] }),
    }));
    expect(response.status).toBe(400);
  });

  it("reports unavailable without exposing or using a missing credential", async () => {
    vi.stubEnv("KEEPERHUB_API_KEY", "");
    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST",
      body: JSON.stringify({
        chainId: 84532,
        vault: "0x1111111111111111111111111111111111111111",
        registrations: [{ workflowId: "wf_open", expectedStatus: "PENDING" }],
      }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ configured: false }));
    vi.unstubAllEnvs();
  });
});
