import { describe, expect, it, vi } from "vitest";

import { KeeperHubClient } from "./server";

describe("KeeperHubClient", () => {
  it("creates workflows through the documented endpoint and unwraps API data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "wf_123", name: "LastWish" } }));
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.createWorkflow({ name: "LastWish", description: "policy", enabled: false, nodes: [], edges: [] })).resolves.toEqual({ id: "wf_123", name: "LastWish" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.keeperhub.com/api/workflows/create",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("lists organization workflows for idempotent registration", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "wf_123", name: "LastWish", description: "lastwish:key", enabled: false }] }));
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.listWorkflows()).resolves.toEqual([{ id: "wf_123", name: "LastWish", description: "lastwish:key", enabled: false }]);
    expect(fetcher).toHaveBeenCalledWith("https://app.keeperhub.com/api/workflows", expect.any(Object));
  });

  it("requires KeeperHub's explicit workflow simulation success envelope", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, result: { simulatedNodeCount: 4, skippedNodeCount: 1 } }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: "SIMULATION_UNAVAILABLE" }));
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.simulateWorkflow("wf_123")).resolves.toEqual({ simulatedNodeCount: 4, skippedNodeCount: 1 });
    await expect(client.simulateWorkflow("wf_123")).rejects.toThrow(/simulation unavailable/i);
  });


  it("keeps the credential in the authorization header and parses enabled chains", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ chains: [{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }] }),
    );
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.getChains()).resolves.toMatchObject([{ chainId: 84532 }]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.keeperhub.com/api/chains",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer kh_secret" }) }),
    );
  });

  it("returns a decoded would-revert simulation even when KeeperHub responds 400", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: "simulated", success: false, wouldRevert: true, revertReason: "GracePeriodActive" }, { status: 400 }),
    );
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(
      client.contractCall({
        contractAddress: "0x1111111111111111111111111111111111111111",
        chainId: 84532,
        functionName: "finalizeSettlement",
        functionArgs: "[]",
        abi: "[]",
        simulate: true,
      }),
    ).resolves.toMatchObject({ wouldRevert: true, revertReason: "GracePeriodActive" });
  });

  it("returns KeeperHub's polling hint with execution evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { executionId: "exec_123", status: "running", receipts: [] },
        { headers: { "X-Poll-Interval-Hint": "2500" } },
      ),
    );
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.getExecution("exec_123")).resolves.toEqual({
      execution: { executionId: "exec_123", status: "running", receipts: [] },
      pollAfterMs: 2500,
    });
  });

  it("lists workflow execution history from the documented endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      { id: "exec_123", workflowId: "wf_123", status: "success", transactionHashes: [] },
    ]));
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.listWorkflowExecutions("wf_123")).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.keeperhub.com/api/workflows/wf_123/executions",
      expect.any(Object),
    );
  });

  it("retrieves per-step execution logs for KeeperHub-side write verification", async () => {
    const response = { execution: { id: "exec_123", workflowId: "wf_123", status: "success" }, logs: [] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    const client = new KeeperHubClient({ apiKey: "kh_secret", fetcher });
    await expect(client.getWorkflowExecutionLogs("exec_123")).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.keeperhub.com/api/workflows/executions/exec_123/logs",
      expect.any(Object),
    );
  });
});
