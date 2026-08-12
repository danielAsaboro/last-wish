import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keeperHub = vi.hoisted(() => ({
  getChains: vi.fn(),
  listWorkflows: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  simulateWorkflow: vi.fn(),
}));
const rpc = vi.hoisted(() => ({ readContract: vi.fn() }));

vi.mock("@/lib/keeperhub/server", () => ({ keeperHubClientFromEnv: () => keeperHub }));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn(() => rpc), verifyMessage: vi.fn(async () => true) };
});

import { POST } from "./route";

describe("POST /api/keeperhub/workflows", () => {
  beforeEach(() => {
    keeperHub.getChains.mockReset();
    keeperHub.listWorkflows.mockReset();
    keeperHub.createWorkflow.mockReset();
    keeperHub.updateWorkflow.mockReset();
    keeperHub.simulateWorkflow.mockReset();
    rpc.readContract.mockReset();
  });
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

  it("accepts a Sepolia registration when Base Sepolia is also enabled instead of applying a priority fallback", async () => {
    process.env.KEEPERHUB_API_KEY = "kh_test";
    process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS = "0x1111111111111111111111111111111111111111";
    const vault = "0x2222222222222222222222222222222222222222";
    const owner = "0x3333333333333333333333333333333333333333";
    rpc.readContract.mockResolvedValueOnce(owner).mockResolvedValueOnce(1n).mockResolvedValueOnce(vault);
    keeperHub.getChains.mockResolvedValue([
      { chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true },
      { chainId: 11155111, name: "Sepolia", isEnabled: true, isTestnet: true },
    ]);
    keeperHub.listWorkflows.mockResolvedValue([]);
    keeperHub.createWorkflow.mockResolvedValueOnce({ id: "wf_open" }).mockResolvedValueOnce({ id: "wf_finalize" });
    keeperHub.updateWorkflow.mockResolvedValue({});
    keeperHub.simulateWorkflow.mockResolvedValue({ success: true });

    const response = await POST(new Request("http://localhost/api/keeperhub/workflows", {
      method: "POST",
      body: JSON.stringify({
        chainId: 11155111,
        vault,
        scheduleCron: "*/5 * * * *",
        policyVersion: "1",
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
        signer: owner,
        signature: `0x${"a".repeat(130)}`,
      }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ chain: { chainId: 11155111 } });
  });
});
