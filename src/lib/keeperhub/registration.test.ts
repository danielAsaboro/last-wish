import { describe, expect, it, vi } from "vitest";

import { registerVaultWorkflowPair, WorkflowRegistrationMutationError } from "./registration";
import { buildVaultWorkflows, workflowGraphMatchesDefinition, type KeeperHubWorkflowDefinition } from "./workflow";

const vault = "0x1111111111111111111111111111111111111111" as const;
const definitions = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 3n });

function row(id: string, definition: KeeperHubWorkflowDefinition, enabled = false) {
  return { id, ...structuredClone(definition), enabled, createdAt: `2026-08-12T12:00:0${id.endsWith("open") ? "0" : "1"}Z`, deletedAt: null, deactivatedAt: null };
}

describe("idempotent KeeperHub workflow-pair registration", () => {
  it("stages and simulates the complete pair before activation, then retires the old policy", async () => {
    const old = row("wf_old", buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0], true);
    let current = [old];
    const calls: string[] = [];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(async (definition: KeeperHubWorkflowDefinition, key: string) => {
        const created = row(definition.description.endsWith(":open") ? "wf_open" : "wf_finalize", definition);
        current.push(created); calls.push(`create:${created.id}:${key}`); return created;
      }),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        calls.push(`patch:${id}:${String(patch.enabled)}`);
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        return {};
      }),
      simulateWorkflow: vi.fn(async (id: string) => { calls.push(`simulate:${id}`); return { warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 }; }),
    };

    const result = await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });

    expect(result.workflows.map((workflow) => workflow.workflowId)).toEqual(["wf_open", "wf_finalize"]);
    const firstEnable = calls.findIndex((call) => call === "patch:wf_open:true");
    expect(calls.indexOf("simulate:wf_open")).toBeLessThan(firstEnable);
    expect(calls.indexOf("simulate:wf_finalize")).toBeLessThan(firstEnable);
    expect(calls.indexOf("patch:wf_old:false")).toBeGreaterThan(calls.indexOf("patch:wf_finalize:true"));
    expect(client.createWorkflow.mock.calls[0][1]).toMatch(/^lastwish-workflow-/);
    expect(client.createWorkflow.mock.calls[1][1]).not.toBe(client.createWorkflow.mock.calls[0][1]);
  });

  it("re-lists and disables uncertain candidates with a complete truthful journal after a mutation fails", async () => {
    let current = [row("wf_open", definitions[0])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(async (definition: KeeperHubWorkflowDefinition) => {
        const created = row("wf_finalize", definition); current.push(created); return created;
      }),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        return {};
      }),
      simulateWorkflow: vi.fn(async (id: string) => id === "wf_finalize"
        ? { warnings: [{ code: "SIMULATION_SIGNER_UNAVAILABLE", nodeId: "execute", message: "no signer", parameterPath: "nodes[3].data.config.web3Connection" }], simulatedNodeCount: 0, skippedNodeCount: 1 }
        : { warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 }),
    };

    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(WorkflowRegistrationMutationError);
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.recoveryRequired).toBe(true);
      expect(mutation.journal).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "open", workflowId: "wf_open", operation: "stage_disabled", outcome: "applied" }),
        expect.objectContaining({ action: "finalize", workflowId: "wf_finalize", operation: "created", outcome: "applied" }),
        expect.objectContaining({ action: "open", workflowId: "wf_open", operation: "recovery_disabled", outcome: "applied" }),
        expect.objectContaining({ action: "finalize", workflowId: "wf_finalize", operation: "recovery_disabled", outcome: "applied" }),
      ]));
      expect(mutation.observedWorkflows).toEqual(expect.arrayContaining([
        expect.objectContaining({ workflowId: "wf_open", enabled: false }),
        expect.objectContaining({ workflowId: "wf_finalize", enabled: false }),
      ]));
      return true;
    });
  });

  it("does not select a deleted matching row and creates a new idempotent candidate", async () => {
    const deleted = { ...row("wf_deleted", definitions[0]), deletedAt: "2026-08-12T12:00:00Z" };
    let current = [deleted, row("wf_finalize", definitions[1])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(async (definition: KeeperHubWorkflowDefinition) => {
        const created = row("wf_open_new", definition); current.push(created); return created;
      }),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };
    const result = await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });
    expect(result.workflows.map((workflow) => workflow.workflowId)).toContain("wf_open_new");
    expect(client.updateWorkflow).not.toHaveBeenCalledWith("wf_deleted", expect.anything());
  });

  it("recovers a create whose response is lost after KeeperHub persists the candidate", async () => {
    let current: ReturnType<typeof row>[] = [];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(async (definition: KeeperHubWorkflowDefinition) => {
        current.push(row("wf_open_lost", definition));
        throw new Error("response lost");
      }),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.recoveryRequired).toBe(true);
      expect(mutation.journal).toEqual(expect.arrayContaining([
        expect.objectContaining({ workflowId: "pending", operation: "created", outcome: "attempted" }),
        expect.objectContaining({ workflowId: "wf_open_lost", operation: "recovery_disabled", outcome: "applied" }),
      ]));
      return true;
    });
  });

  it("journals a malformed create response and recovers the persisted candidate", async () => {
    let current: ReturnType<typeof row>[] = [];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(async (definition: KeeperHubWorkflowDefinition) => {
        current.push(row("wf_open_missing_id", definition));
        return {};
      }),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };

    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.journal).toContainEqual(expect.objectContaining({
        action: "open",
        workflowId: "pending",
        operation: "created",
        outcome: "failed",
      }));
      expect(mutation.observedWorkflows).toContainEqual(expect.objectContaining({ workflowId: "wf_open_missing_id", enabled: false }));
      return true;
    });
  });

  it("enables finalize before open, confirms the pair, and retires obsolete workflows last", async () => {
    const old = row("wf_old", buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0], true);
    let current = [old, row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    const calls: string[] = [];
    const client = {
      listWorkflows: vi.fn(async () => { calls.push("list"); return structuredClone(current); }),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        calls.push(`patch:${id}:${String(patch.enabled)}`);
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async (id: string) => { calls.push(`simulate:${id}`); return { warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 }; }),
    };
    await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });
    expect(calls.indexOf("patch:wf_finalize:true")).toBeLessThan(calls.indexOf("patch:wf_open:true"));
    expect(calls.indexOf("patch:wf_old:false")).toBeGreaterThan(calls.indexOf("patch:wf_open:true"));
    expect(calls.slice(calls.indexOf("patch:wf_open:true") + 1, calls.indexOf("patch:wf_old:false"))).toContain("list");
  });

  it("returns an already healthy exact pair without mutating it", async () => {
    const current = [row("wf_open", definitions[0], true), row("wf_finalize", definitions[1], true)];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      simulateWorkflow: vi.fn(),
    };
    const result = await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });
    expect(result.workflows.map((item) => item.workflowId)).toEqual(["wf_open", "wf_finalize"]);
    expect(client.createWorkflow).not.toHaveBeenCalled();
    expect(client.updateWorkflow).not.toHaveBeenCalled();
    expect(client.simulateWorkflow).not.toHaveBeenCalled();
  });

  it("reconfirms an apparently healthy pair and retires a concurrently exposed prior-policy workflow", async () => {
    const oldDefinition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0];
    let current = [row("wf_open", definitions[0], true), row("wf_finalize", definitions[1], true)];
    let listed = 0;
    const client = {
      listWorkflows: vi.fn(async () => {
        listed += 1;
        if (listed === 2) current.push(row("wf_old_concurrent", oldDefinition, true));
        return structuredClone(current);
      }),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        return {};
      }),
      simulateWorkflow: vi.fn(),
    };

    const result = await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });

    expect(result.retiredWorkflowIds).toEqual(["wf_old_concurrent"]);
    expect(client.listWorkflows).toHaveBeenCalledTimes(3);
    expect(client.updateWorkflow).toHaveBeenCalledWith("wf_old_concurrent", { enabled: false });
    expect(client.createWorkflow).not.toHaveBeenCalled();
    expect(client.simulateWorkflow).not.toHaveBeenCalled();
  });

  it("keeps an exact enabled pair untouched while retiring an enabled prior-policy schedule", async () => {
    const old = row("wf_old", buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0], true);
    let current = [row("wf_open", definitions[0], true), row("wf_finalize", definitions[1], true), old];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(),
    };
    const result = await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });
    expect(result.retiredWorkflowIds).toEqual(["wf_old"]);
    expect(client.updateWorkflow).toHaveBeenCalledOnce();
    expect(client.updateWorkflow).toHaveBeenCalledWith("wf_old", { enabled: false });
    expect(client.updateWorkflow).not.toHaveBeenCalledWith("wf_open", expect.anything());
    expect(client.updateWorkflow).not.toHaveBeenCalledWith("wf_finalize", expect.anything());
    expect(client.simulateWorkflow).not.toHaveBeenCalled();
  });

  it("detects a concurrent enabled prior-policy schedule during healthy-pair cleanup", async () => {
    const oldDefinition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0];
    let current = [row("wf_open", definitions[0], true), row("wf_finalize", definitions[1], true), row("wf_old", oldDefinition, true)];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        if (id === "wf_old") current.push(row("wf_old_concurrent", oldDefinition, true));
        return {};
      }),
      simulateWorkflow: vi.fn(),
    };

    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.observedWorkflows).toContainEqual(expect.objectContaining({ workflowId: "wf_old_concurrent", enabled: true }));
      return true;
    });
    expect(current.find((workflow) => workflow.id === "wf_open")?.enabled).toBe(true);
    expect(current.find((workflow) => workflow.id === "wf_finalize")?.enabled).toBe(true);
  });

  it("repairs a disabled current-key duplicate whose graph drifted instead of taking the healthy shortcut", async () => {
    const drifted = row("wf_open_drifted", definitions[0]);
    drifted.nodes[3].data.config.abiFunction = "attackerChangedFunction";
    let current = [row("wf_open", definitions[0], true), drifted, row("wf_finalize", definitions[1], true)];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };

    await registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false });

    expect(current.filter((workflow) => workflow.description === definitions[0].description)).toSatisfy((matches: typeof current) =>
      matches.every((workflow) => workflowGraphMatchesDefinition(workflow, definitions[0])),
    );
    expect(client.updateWorkflow).toHaveBeenCalledWith("wf_open_drifted", expect.objectContaining({
      enabled: false,
      nodes: definitions[0].nodes,
      edges: definitions[0].edges,
    }));
    expect(client.simulateWorkflow).toHaveBeenCalledTimes(2);
  });

  it("finishes both simulations before rejecting a blocked open candidate", async () => {
    let current = [row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async (id: string) => id === "wf_open"
        ? { warnings: [{ code: "SIMULATION_SIGNER_UNAVAILABLE", nodeId: "execute", fieldKey: "web3Connection", message: "no signer", parameterPath: "nodes[3].data.config.web3Connection" }], simulatedNodeCount: 0, skippedNodeCount: 1 }
        : { warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 }),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toBeInstanceOf(WorkflowRegistrationMutationError);
    expect(client.simulateWorkflow).toHaveBeenCalledWith("wf_open");
    expect(client.simulateWorkflow).toHaveBeenCalledWith("wf_finalize");
    expect(client.updateWorkflow).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
  });

  it("re-lists and verifies the complete disabled pair together before either simulation", async () => {
    let current = [row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        if (id === "wf_finalize" && patch.enabled === false) {
          current[0].nodes[3].data.config.abiFunction = "attackerChangedFunction";
        }
        return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toBeInstanceOf(WorkflowRegistrationMutationError);
    expect(client.simulateWorkflow).not.toHaveBeenCalled();
    expect(client.updateWorkflow).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
  });

  it("recovers both candidates when finalize activation succeeds and open activation fails", async () => {
    let current = [row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    let failedOpen = false;
    const calls: string[] = [];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        calls.push(`${id}:${String(patch.enabled)}`);
        if (id === "wf_open" && patch.enabled === true && !failedOpen) {
          failedOpen = true;
          throw new Error("open activation response lost");
        }
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.observedWorkflows).toEqual(expect.arrayContaining([
        expect.objectContaining({ workflowId: "wf_open", enabled: false }),
        expect.objectContaining({ workflowId: "wf_finalize", enabled: false }),
      ]));
      return true;
    });
    expect(calls.indexOf("wf_finalize:true")).toBeLessThan(calls.indexOf("wf_open:true"));
    expect(calls.filter((call) => call === "wf_finalize:false")).toHaveLength(2);
    expect(calls.filter((call) => call === "wf_open:false")).toHaveLength(2);
  });

  it("does not claim recovery or mutate when the initial read fails", async () => {
    const client = {
      listWorkflows: vi.fn(async () => { throw new Error("list unavailable"); }),
      createWorkflow: vi.fn(), updateWorkflow: vi.fn(), simulateWorkflow: vi.fn(),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toThrow("list unavailable");
    expect(client.createWorkflow).not.toHaveBeenCalled();
    expect(client.updateWorkflow).not.toHaveBeenCalled();
  });

  it("does not rotate an idempotency key or blindly retry idempotency_in_progress", async () => {
    const client = {
      listWorkflows: vi.fn(async () => []),
      createWorkflow: vi.fn(async () => { throw new Error("idempotency_in_progress"); }),
      updateWorkflow: vi.fn(), simulateWorkflow: vi.fn(),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toBeInstanceOf(WorkflowRegistrationMutationError);
    expect(client.createWorkflow).toHaveBeenCalledOnce();
  });

  it("retains a confirmed healthy pair when only obsolete cleanup fails", async () => {
    const old = row("wf_old", buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0], true);
    let current = [old, row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        if (id === "wf_old" && patch.enabled === false) throw new Error("cleanup unavailable");
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow); return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };
    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.recoveryRequired).toBe(true);
      expect(mutation.observedWorkflows).toEqual(expect.arrayContaining([
        expect.objectContaining({ workflowId: "wf_open", enabled: true }),
        expect.objectContaining({ workflowId: "wf_finalize", enabled: true }),
      ]));
      expect(mutation.journal).toContainEqual(expect.objectContaining({ action: "open", workflowId: "wf_old", operation: "retired", outcome: "failed" }));
      return true;
    });
    expect(current.find((workflow) => workflow.id === "wf_open")?.enabled).toBe(true);
    expect(current.find((workflow) => workflow.id === "wf_finalize")?.enabled).toBe(true);
  });

  it("retains the confirmed pair when KeeperHub acknowledges but does not apply obsolete retirement", async () => {
    const old = row("wf_old", buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0], true);
    let current = [old, row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        if (id !== "wf_old") {
          current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        }
        return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };

    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toBeInstanceOf(WorkflowRegistrationMutationError);
    expect(current.find((workflow) => workflow.id === "wf_open")?.enabled).toBe(true);
    expect(current.find((workflow) => workflow.id === "wf_finalize")?.enabled).toBe(true);
    expect(current.find((workflow) => workflow.id === "wf_old")?.enabled).toBe(true);
  });

  it("detects a concurrent enabled prior-policy schedule during staged-pair retirement", async () => {
    const oldDefinition = buildVaultWorkflows({ chainId: 84532, vault, scheduleCron: "*/5 * * * *", policyVersion: 2n })[0];
    let current = [row("wf_old", oldDefinition, true), row("wf_open", definitions[0]), row("wf_finalize", definitions[1])];
    const client = {
      listWorkflows: vi.fn(async () => structuredClone(current)),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        current = current.map((workflow) => workflow.id === id ? { ...workflow, ...structuredClone(patch) } as typeof workflow : workflow);
        if (id === "wf_old") current.push(row("wf_old_concurrent", oldDefinition, true));
        return {};
      }),
      simulateWorkflow: vi.fn(async () => ({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })),
    };

    await expect(registerVaultWorkflowPair(client, { chainId: 84532, vault, definitions, readPolicyGuard: async () => false })).rejects.toSatisfy((error) => {
      const mutation = error as WorkflowRegistrationMutationError;
      expect(mutation.observedWorkflows).toContainEqual(expect.objectContaining({ workflowId: "wf_old_concurrent", enabled: true }));
      return true;
    });
    expect(current.find((workflow) => workflow.id === "wf_open")?.enabled).toBe(true);
    expect(current.find((workflow) => workflow.id === "wf_finalize")?.enabled).toBe(true);
  });
});
