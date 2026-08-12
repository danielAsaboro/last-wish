import { afterEach, describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/keeperhub/workflows", () => {
  afterEach(() => delete process.env.KEEPERHUB_API_KEY);

  it("does not expose a setup success state when KeeperHub is unconfigured", async () => {
    const response = await POST(
      new Request("http://localhost/api/keeperhub/workflows", {
        method: "POST",
        body: JSON.stringify({
          chainId: 84532,
          vault: "0x1111111111111111111111111111111111111111",
          scheduleCron: "*/5 * * * *",
        }),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      configured: false,
      error: "KeeperHub automation is unavailable because KEEPERHUB_API_KEY is not configured.",
    });
  });
});
