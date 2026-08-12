import { afterEach, describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/keeperhub/workflows", () => {
  afterEach(() => {
    delete process.env.KEEPERHUB_API_KEY;
    delete process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
  });

  it("does not expose a setup success state when KeeperHub is unconfigured", async () => {
    const response = await POST(
      new Request("http://localhost/api/keeperhub/workflows", {
        method: "POST",
        body: JSON.stringify({
          chainId: 84532,
          vault: "0x1111111111111111111111111111111111111111",
          scheduleCron: "*/5 * * * *",
          policyVersion: "1",
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
          signer: "0x2222222222222222222222222222222222222222",
          signature: `0x${"a".repeat(130)}`,
        }),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      configured: false,
      error: "KeeperHub automation is unavailable because KEEPERHUB_API_KEY is not configured.",
    });
  });

  it("refuses registration when trusted factory provenance cannot be checked", async () => {
    process.env.KEEPERHUB_API_KEY = "kh_test";
    const response = await POST(new Request("http://localhost/api/keeperhub/workflows", {
      method: "POST",
      body: JSON.stringify({
        chainId: 84532,
        vault: "0x1111111111111111111111111111111111111111",
        scheduleCron: "*/5 * * * *",
        policyVersion: "1",
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
        signer: "0x2222222222222222222222222222222222222222",
        signature: `0x${"a".repeat(130)}`,
      }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/factory/i) });
  });
});
