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
import { buildVaultWorkflows } from "@/lib/keeperhub/workflow";

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
    const rows: Array<Record<string, unknown>> = [];
    keeperHub.createWorkflow.mockImplementation(async (definition) => {
      const id = definition.description.endsWith(":open") ? "wf_open" : "wf_finalize";
      rows.push({ id, ...structuredClone(definition), enabled: false, deletedAt: null, deactivatedAt: null });
      return { id };
    });
    keeperHub.listWorkflows.mockImplementation(async () => structuredClone(rows));
    keeperHub.updateWorkflow.mockImplementation(async (id, patch) => {
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = { ...rows[index], ...structuredClone(patch) };
      return {};
    });
    keeperHub.simulateWorkflow.mockResolvedValue({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 });

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

  it("does not activate either workflow when a source-shaped simulation reports an unavailable signer", async () => {
    process.env.KEEPERHUB_API_KEY = "kh_test";
    process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS = "0x1111111111111111111111111111111111111111";
    const vault = "0x2222222222222222222222222222222222222222";
    const owner = "0x3333333333333333333333333333333333333333";
    const definitions = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 1n });
    const rows = definitions.map((definition, index) => ({
      id: index === 0 ? "wf_open" : "wf_finalize",
      ...structuredClone(definition),
      enabled: false,
      createdAt: `2026-08-12T12:00:0${index}Z`,
      deletedAt: null,
      deactivatedAt: null,
    }));
    rpc.readContract.mockResolvedValueOnce(owner).mockResolvedValueOnce(1n).mockResolvedValueOnce(vault);
    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }]);
    keeperHub.listWorkflows.mockResolvedValue(rows);
    keeperHub.updateWorkflow.mockImplementation(async (id, patch) => {
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = { ...rows[index], ...structuredClone(patch) };
      return {};
    });
    keeperHub.simulateWorkflow.mockResolvedValue({
      warnings: [{
        code: "SIMULATION_SIGNER_UNAVAILABLE",
        message: "Open grace period could not resolve its signer for simulation.",
        parameterPath: "nodes[3].data.config.web3Connection",
        nodeId: "execute",
        fieldKey: "web3Connection",
      }],
      simulatedNodeCount: 0,
      skippedNodeCount: 1,
    });

    const response = await POST(new Request("http://localhost/api/keeperhub/workflows", {
      method: "POST",
      body: JSON.stringify({
        chainId: 84532,
        vault,
        scheduleCron: "*/5 * * * *",
        policyVersion: "1",
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
        signer: owner,
        signature: `0x${"a".repeat(130)}`,
      }),
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      recoveryRequired: true,
      mutationJournal: expect.arrayContaining([expect.objectContaining({ workflowId: "wf_open" })]),
      observedWorkflows: expect.arrayContaining([expect.objectContaining({ workflowId: "wf_open", enabled: false })]),
    });
    expect(keeperHub.updateWorkflow).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
  });

  it("redacts provider credentials from a simulation failure while retaining recovery metadata", async () => {
    process.env.KEEPERHUB_API_KEY = "kh_test";
    process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS = "0x1111111111111111111111111111111111111111";
    const vault = "0x2222222222222222222222222222222222222222";
    const owner = "0x3333333333333333333333333333333333333333";
    const definitions = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 1n });
    const rows = definitions.map((definition, index) => ({
      id: index === 0 ? "wf_open" : "wf_finalize",
      ...structuredClone(definition),
      enabled: false,
      createdAt: `2026-08-12T12:00:0${index}Z`,
      deletedAt: null,
      deactivatedAt: null,
    }));
    const upstreamSecrets = "https://rpc.example/v2/private-key?token=secret Bearer private-token sk-abcdefghijklmnopqrstuvwxyz123456 hunter2";
    rpc.readContract.mockResolvedValueOnce(owner).mockResolvedValueOnce(1n).mockResolvedValueOnce(vault);
    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }]);
    keeperHub.listWorkflows.mockResolvedValue(rows);
    keeperHub.updateWorkflow.mockResolvedValue({});
    keeperHub.simulateWorkflow.mockRejectedValue(new Error(upstreamSecrets));

    const response = await POST(new Request("http://localhost/api/keeperhub/workflows", {
      method: "POST",
      body: JSON.stringify({
        chainId: 84532,
        vault,
        scheduleCron: "*/5 * * * *",
        policyVersion: "1",
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
        signer: owner,
        signature: `0x${"a".repeat(130)}`,
      }),
    }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({
      configured: true,
      error: "KeeperHub changed workflow state but could not confirm a healthy automation pair. Refresh readiness and evidence before authorizing another registration.",
      recoveryRequired: true,
      mutationJournal: expect.arrayContaining([
        expect.objectContaining({ action: "open", workflowId: "wf_open", operation: "simulated", outcome: "failed" }),
      ]),
      observedWorkflows: expect.arrayContaining([expect.objectContaining({ workflowId: "wf_open", enabled: false })]),
    });
    const serialized = JSON.stringify(body);
    for (const secret of ["https://rpc.example/v2/private-key?token=secret", "Bearer private-token", "sk-abcdefghijklmnopqrstuvwxyz123456", "hunter2"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
