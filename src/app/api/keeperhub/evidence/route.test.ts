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
const parseEventLogs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/keeperhub/server", () => ({ keeperHubClientFromEnv: () => keeperHub }));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn(() => rpc), parseEventLogs };
});

import { POST } from "./route";
import { buildVaultWorkflows } from "@/lib/keeperhub/workflow";

describe("POST /api/keeperhub/evidence", () => {
  beforeEach(() => {
    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    keeperHub.listWorkflows.mockReset();
    keeperHub.listWorkflowExecutions.mockReset();
    keeperHub.getWorkflowExecutionLogs.mockReset();
    rpc.readContract.mockReset();
    rpc.getTransactionReceipt.mockReset();
    parseEventLogs.mockReset();
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
    const currentOpenDefinition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    const staleFinalizeDefinition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[1];
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n);
    keeperHub.listWorkflows.mockResolvedValue([
      { id: "wf_current", ...currentOpenDefinition, name: "Open current", description: key(3, "open"), enabled: true, deletedAt: null, deactivatedAt: null },
      { id: "wf_stale", ...staleFinalizeDefinition, name: "Finalize stale", description: key(2, "finalize"), enabled: false, deletedAt: null, deactivatedAt: null },
      { id: "wf_wrong_chain", name: "Wrong chain", description: key(3, "open").replace("84532", "11155111"), enabled: true, nodes: [], edges: [], deletedAt: null, deactivatedAt: null },
      { id: "wf_wrong_vault", name: "Wrong vault", description: key(3, "open").replace(vault, "0x2222222222222222222222222222222222222222"), enabled: true, nodes: [], edges: [], deletedAt: null, deactivatedAt: null },
      { id: "wf_suffix", name: "Suffixed", description: `${key(3, "open")}:tampered`, enabled: true, nodes: [], edges: [], deletedAt: null, deactivatedAt: null },
      { id: "wf_prefix", name: "Prefix", description: key(3, "open").replace(":3:open", ":3"), enabled: true, nodes: [], edges: [], deletedAt: null, deactivatedAt: null },
    ]);
    keeperHub.listWorkflowExecutions.mockImplementation(async (workflowId: string) => workflowId === "wf_current" ? runs : []);
    keeperHub.getWorkflowExecutionLogs.mockResolvedValue({ execution: { id: "unresolved", workflowId: "wf_current", status: "success" }, logs: [] });

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

  it("verifies a transaction only when its vault settlement event has the registration policy version", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const hash = `0x${"a".repeat(64)}`;
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n).mockResolvedValueOnce(1);
    const definition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    keeperHub.listWorkflows.mockResolvedValue([{ id: "wf_open", ...definition, name: "Open", enabled: true, deletedAt: null, deactivatedAt: null }]);
    keeperHub.listWorkflowExecutions.mockResolvedValue([
      { id: "exec_open", workflowId: "wf_open", status: "success", transactionHashes: [{ hash, nodeId: "execute", nodeName: "Open grace" }] },
    ]);
    keeperHub.getWorkflowExecutionLogs.mockResolvedValue({
      execution: { id: "exec_open", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_open", executionId: "exec_open", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: hash }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    });
    rpc.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 42n, gasUsed: 70_000n, logs: [] });
    parseEventLogs.mockReturnValue([{ address: vault, eventName: "SettlementOpened", args: { policyVersion: 3n } }]);

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST", body: JSON.stringify({ chainId: 84532, vault }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      evidence: [expect.objectContaining({ executionId: "exec_open", status: "verified", observedVaultStatus: "PENDING" })],
    });
  });

  it("keeps a transaction recovery-required when the vault event policy version differs from the registration", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const hash = `0x${"b".repeat(64)}`;
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n).mockResolvedValueOnce(1);
    const definition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    keeperHub.listWorkflows.mockResolvedValue([{ id: "wf_open", ...definition, name: "Open", enabled: true, deletedAt: null, deactivatedAt: null }]);
    keeperHub.listWorkflowExecutions.mockResolvedValue([
      { id: "exec_open", workflowId: "wf_open", status: "success", transactionHashes: [{ hash, nodeId: "execute", nodeName: "Open grace" }] },
    ]);
    keeperHub.getWorkflowExecutionLogs.mockResolvedValue({
      execution: { id: "exec_open", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_open", executionId: "exec_open", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: hash }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    });
    rpc.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 42n, gasUsed: 70_000n, logs: [] });
    parseEventLogs.mockReturnValue([{ address: vault, eventName: "SettlementOpened", args: { policyVersion: 2n } }]);

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST", body: JSON.stringify({ chainId: 84532, vault }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      evidence: [expect.objectContaining({ executionId: "exec_open", status: "unknown", observedVaultStatus: "RECOVERY_REQUIRED" })],
    });
  });

  it("proves a genuine condition no-write from logs before marking it verified", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n);
    const definition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    keeperHub.listWorkflows.mockResolvedValue([{ id: "wf_open", ...definition, enabled: true, deletedAt: null, deactivatedAt: null }]);
    keeperHub.listWorkflowExecutions.mockResolvedValue([{
      id: "exec_check", workflowId: "wf_open", status: "success", completedAt: null, transactionHashes: [],
    }]);
    keeperHub.getWorkflowExecutionLogs.mockResolvedValue({
      execution: { id: "exec_check", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_check", executionId: "exec_check", nodeId: "check", nodeName: "Check eligibility", nodeType: "web3/read-contract", status: "success",
        input: null, output: { result: false }, outputRaw: { result: false }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00.000Z", completedAt: "2026-08-12T12:00:00.001Z", timestamp: "2026-08-12T12:00:00.000Z", iterationIndex: null, forEachNodeId: null,
      }, {
        id: "log_condition", executionId: "exec_check", nodeId: "eligible", nodeName: "Eligible onchain?", nodeType: "Condition", status: "success",
        input: { condition: false, expression: "{{@check:Check eligibility.result}} == true", resolvedExpression: "false == true" },
        output: { condition: false }, outputRaw: { condition: false }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00.000Z", completedAt: "2026-08-12T12:00:00.001Z", timestamp: "2026-08-12T12:00:00.000Z", iterationIndex: null, forEachNodeId: null,
      }],
    });

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST", body: JSON.stringify({ chainId: 84532, vault }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      policyVersion: "3",
      evidence: [expect.objectContaining({ executionId: "exec_check", status: "verified", outcome: "NO_WRITE" })],
    });
    expect(keeperHub.getWorkflowExecutionLogs).toHaveBeenCalledWith("exec_check");
  });

  it("reconstructs a historical write hash from logs when the execution row has no denormalized hash", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const hash = `0x${"c".repeat(64)}`;
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n).mockResolvedValueOnce(1);
    const definition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    keeperHub.listWorkflows.mockResolvedValue([{ id: "wf_open", ...definition, enabled: true, deletedAt: null, deactivatedAt: null }]);
    keeperHub.listWorkflowExecutions.mockResolvedValue([{
      id: "exec_legacy", workflowId: "wf_open", status: "success", completedAt: null, transactionHashes: [],
    }]);
    keeperHub.getWorkflowExecutionLogs.mockResolvedValue({
      execution: { id: "exec_legacy", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_write", executionId: "exec_legacy", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: null, output: { success: true, transactionHash: hash, chainId: 84532 }, outputRaw: { success: true, transactionHash: hash, chainId: 84532 }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00.000Z", completedAt: "2026-08-12T12:00:00.001Z", timestamp: "2026-08-12T12:00:00.000Z", iterationIndex: null, forEachNodeId: null,
      }],
    });
    rpc.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 42n, gasUsed: 70_000n, logs: [] });
    parseEventLogs.mockReturnValue([{ address: vault, eventName: "SettlementOpened", args: { policyVersion: 3n } }]);

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST", body: JSON.stringify({ chainId: 84532, vault }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      evidence: [expect.objectContaining({ executionId: "exec_legacy", transactionHash: hash, status: "verified", outcome: "TRANSACTION" })],
    });
  });

  it("stops for reconciliation without fetching a receipt when a run reports multiple transaction hashes", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const definition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n);
    keeperHub.listWorkflows.mockResolvedValue([{ id: "wf_open", ...definition, enabled: true, deletedAt: null, deactivatedAt: null }]);
    keeperHub.listWorkflowExecutions.mockResolvedValue([{
      id: "exec_multi", workflowId: "wf_open", status: "success", completedAt: null,
      transactionHashes: [
        { hash: `0x${"a".repeat(64)}`, nodeId: "execute", nodeName: "Open grace" },
        { hash: `0x${"b".repeat(64)}`, nodeId: "execute", nodeName: "Open grace" },
      ],
    }]);

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST", body: JSON.stringify({ chainId: 84532, vault }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      evidence: [expect.objectContaining({ executionId: "exec_multi", status: "unknown", observedVaultStatus: "RECOVERY_REQUIRED" })],
    });
    expect(rpc.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("filters tombstones and reports a live registration-key match with graph drift as recovery-required", async () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const description = `Registration key: lastwish:84532:${vault}:3:open`;
    rpc.readContract.mockResolvedValueOnce(0).mockResolvedValueOnce(3n);
    keeperHub.listWorkflows.mockResolvedValue([
      { id: "wf_deleted", name: "Deleted", description, enabled: true, deletedAt: "2026-08-12T12:00:00Z", deactivatedAt: null, nodes: [], edges: [] },
      { id: "wf_tampered", name: "Tampered", description, enabled: true, deletedAt: null, deactivatedAt: null, nodes: [], edges: [] },
    ]);
    keeperHub.listWorkflowExecutions.mockResolvedValue([]);

    const response = await POST(new Request("http://localhost/api/keeperhub/evidence", {
      method: "POST", body: JSON.stringify({ chainId: 84532, vault }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      workflows: [expect.objectContaining({ workflowId: "wf_tampered", definitionMatches: false })],
    });
    expect(keeperHub.listWorkflowExecutions).toHaveBeenCalledOnce();
    expect(keeperHub.listWorkflowExecutions).toHaveBeenCalledWith("wf_tampered");
  });
});
