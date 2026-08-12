import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keeperHub = vi.hoisted(() => ({
  listWorkflows: vi.fn(),
  listWorkflowExecutions: vi.fn(),
  getWorkflowExecutionLogs: vi.fn(),
}));
const rpc = vi.hoisted(() => ({
  readContract: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock("@/lib/keeperhub/server", () => ({ keeperHubClientFromEnv: () => keeperHub }));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn(() => rpc) };
});

import { POST } from "./route";

describe("POST /api/keeperhub/evidence", () => {
  beforeEach(() => {
    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    keeperHub.listWorkflows.mockReset();
    keeperHub.listWorkflowExecutions.mockReset();
    keeperHub.getWorkflowExecutionLogs.mockReset();
    rpc.readContract.mockReset();
    rpc.getTransactionReceipt.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

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
  });

  it("discovers current and stale canonical workflows without browser registrations and reports the full provider window", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const key = (policyVersion: number, action: "open" | "finalize") =>
      `LastWish. Registration key: lastwish:84532:${vault}:${policyVersion}:${action}`;
    const runs = Array.from({ length: 50 }, (_, index) => ({
      id: `exec_${index}`,
      workflowId: "wf_current",
      status: "success",
      transactionHashes: [],
    }));
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n);
    keeperHub.listWorkflows.mockResolvedValue([
      { id: "wf_current", name: "Open current", description: key(3, "open"), enabled: true },
      { id: "wf_stale", name: "Finalize stale", description: key(2, "finalize"), enabled: false },
      { id: "wf_wrong_chain", name: "Wrong chain", description: key(3, "open").replace("84532", "11155111"), enabled: true },
      { id: "wf_wrong_vault", name: "Wrong vault", description: key(3, "open").replace(vault, "0x2222222222222222222222222222222222222222"), enabled: true },
      { id: "wf_suffix", name: "Suffixed", description: `${key(3, "open")}:tampered`, enabled: true },
      { id: "wf_prefix", name: "Prefix", description: key(3, "open").replace(":3:open", ":3"), enabled: true },
    ]);
    keeperHub.listWorkflowExecutions.mockImplementation(async (workflowId: string) => workflowId === "wf_current" ? runs : []);

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST",
      body: JSON.stringify({ chainId: 84532, vault }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      evidence: expect.arrayContaining([expect.objectContaining({ executionId: "exec_49", workflowId: "wf_current" })]),
      workflows: [
        {
          workflowId: "wf_current",
          policyVersion: "3",
          action: "open",
          registrationState: "current",
          enabled: true,
          coverage: {
            runsReturned: 50,
            providerWindow: "latest_50_non_purged",
            olderRunsMayExist: true,
            providerPagination: "unavailable",
          },
        },
        {
          workflowId: "wf_stale",
          policyVersion: "2",
          action: "finalize",
          registrationState: "stale",
          enabled: false,
          coverage: {
            runsReturned: 0,
            providerWindow: "latest_50_non_purged",
            olderRunsMayExist: false,
            providerPagination: "unavailable",
          },
        },
      ],
    });
    expect(keeperHub.listWorkflowExecutions).toHaveBeenCalledTimes(2);
  });
});
