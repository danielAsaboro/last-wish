import { describe, expect, it } from "vitest";

import * as workflowModule from "./workflow";
import { buildVaultWorkflows, buildWorkflowCreateIdempotencyKey, findObsoleteVaultWorkflows, findWorkflowByRegistrationKey, findWorkflowsByRegistrationKey, isWorkflowForVault, selectCanonicalWorkflow, workflowGraphMatchesDefinition } from "./workflow";

describe("buildVaultWorkflows", () => {
  it("builds scheduled read-condition-write workflows for both settlement stages", () => {
    const workflows = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    });

    expect(workflows).toHaveLength(2);
    expect(workflows.map((workflow) => workflow.name)).toEqual([
      "LastWish · open · 0x111111…1111",
      "LastWish · finalize · 0x111111…1111",
    ]);
    for (const workflow of workflows) {
      expect(workflow.enabled).toBe(true);
      expect(workflow.nodes.map((node) => node.type)).toEqual(["trigger", "action", "action", "action"]);
      expect(workflow.nodes.map((node) => node.data.type)).toEqual(["trigger", "action", "action", "action"]);
      expect(workflow.nodes[1].data.config.actionType).toBe("web3/read-contract");
      expect(workflow.nodes[2]).toEqual({
        id: "eligible",
        type: "action",
        data: {
          type: "action",
          label: "Eligible onchain?",
          config: {
            actionType: "Condition",
            condition: "{{@check:Check eligibility.result}} == true",
          },
        },
      });
      expect(workflow.nodes.some((node) => (node as { type: string }).type === "condition" || "conditionType" in node.data.config)).toBe(false);
      expect(workflow.nodes[3].data.config.actionType).toBe("web3/write-contract");
      expect(workflow.edges.at(-1)).toMatchObject({ source: "eligible", target: "execute", sourceHandle: "true" });
    }
    expect(workflows[0].nodes[1].data.config.abiFunction).toBe("canOpenSettlementForPolicy");
    expect(workflows[0].nodes[3].data.config.abiFunction).toBe("openSettlementForPolicy");
    expect(workflows[1].nodes[1].data.config.abiFunction).toBe("canFinalizeSettlementForPolicy");
    expect(workflows[1].nodes[3].data.config.abiFunction).toBe("finalizeSettlementForPolicy");
    expect(workflows[0].nodes[1].data.config.functionArgs).toBe('["3"]');
    expect(workflows.map((workflow) => workflow.description)).toEqual([
      expect.stringContaining("lastwish:84532:0x1111111111111111111111111111111111111111:3:open"),
      expect.stringContaining("lastwish:84532:0x1111111111111111111111111111111111111111:3:finalize"),
    ]);
  });

  it("reuses only an exact policy-bound workflow registration", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    expect(findWorkflowByRegistrationKey([
      { id: "wf_old", name: definition.name, description: definition.description.replace(":3:open", ":2:open"), deletedAt: null, deactivatedAt: null },
      { id: "wf_current", name: definition.name, description: definition.description, deletedAt: null, deactivatedAt: null },
    ], definition)).toMatchObject({ id: "wf_current" });
  });

  it("binds evidence workflow IDs to the requested chain and vault", () => {
    const description = "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:3:open";
    expect(isWorkflowForVault({ description }, 84532, "0x1111111111111111111111111111111111111111")).toBe(true);
    expect(isWorkflowForVault({ description }, 11155111, "0x1111111111111111111111111111111111111111")).toBe(false);
    expect(isWorkflowForVault({ description }, 84532, "0x2222222222222222222222222222222222222222")).toBe(false);
  });

  it("parses only a complete canonical final registration key", () => {
    const parseWorkflowRegistrationKey = (workflowModule as {
      parseWorkflowRegistrationKey?: (description?: string) => unknown;
    }).parseWorkflowRegistrationKey;
    expect(parseWorkflowRegistrationKey).toEqual(expect.any(Function));
    if (!parseWorkflowRegistrationKey) return;

    const description = "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:3:open";
    expect(parseWorkflowRegistrationKey(description)).toEqual({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      policyVersion: 3n,
      action: "open",
    });
    for (const invalid of [
      "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:03:open",
      "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:0:open",
      "Reads eligibility. Registration key: lastwish:1:0x1111111111111111111111111111111111111111:3:open",
      "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:3:open:tampered",
      "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:3:open extra",
      "Reads eligibility. Registration key: lastwish:84532:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3:open",
    ]) expect(parseWorkflowRegistrationKey(invalid)).toBeUndefined();
  });

  it("excludes malformed, prefix-only, and suffixed keys consistently", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    const suffixed = `${definition.description}:tampered`;
    const prefixOnly = definition.description.replace(":3:open", ":3");
    expect(findWorkflowByRegistrationKey([{ id: "wf_suffix", description: suffixed, deletedAt: null, deactivatedAt: null }], definition)).toBeUndefined();
    expect(findWorkflowsByRegistrationKey([{ id: "wf_prefix", description: prefixOnly, deletedAt: null, deactivatedAt: null }], definition)).toEqual([]);
    expect(isWorkflowForVault({ description: suffixed }, 84532, "0x1111111111111111111111111111111111111111")).toBe(false);
    expect(findObsoleteVaultWorkflows(
      [{ id: "wf_suffix", description: suffixed, deletedAt: null, deactivatedAt: null }, { id: "wf_prefix", description: prefixOnly, deletedAt: null, deactivatedAt: null }],
      84532,
      "0x1111111111111111111111111111111111111111",
      [definition],
    )).toEqual([]);
  });

  it("identifies prior-policy workflows that must be retired", () => {
    const current = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    });
    const oldDescription = current[0].description.replace(":3:open", ":2:open");
    expect(findObsoleteVaultWorkflows([
      { id: "wf_old", description: oldDescription, deletedAt: null, deactivatedAt: null },
      { id: "wf_current", description: current[0].description, deletedAt: null, deactivatedAt: null },
      { id: "wf_other_vault", description: current[0].description.replace(/0x1{40}/, `0x${"2".repeat(40)}`), deletedAt: null, deactivatedAt: null },
    ], 84532, "0x1111111111111111111111111111111111111111", current)).toEqual([{ id: "wf_old", description: oldDescription, deletedAt: null, deactivatedAt: null }]);
  });

  it("selects one deterministic canonical copy when registration was replayed", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    const copies = findWorkflowsByRegistrationKey([
      { id: "wf_b", description: definition.description, createdAt: "2026-08-12T12:00:01Z", deletedAt: null, deactivatedAt: null },
      { id: "wf_a", description: definition.description, createdAt: "2026-08-12T12:00:00Z", deletedAt: null, deactivatedAt: null },
    ], definition);
    expect(selectCanonicalWorkflow(copies)?.id).toBe("wf_a");
  });

  it("excludes deleted and deactivated registrations from canonical selection", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    const rows = [
      { id: "wf_deleted", description: definition.description, createdAt: "2026-08-12T11:00:00Z", deletedAt: "2026-08-12T12:00:00Z" },
      { id: "wf_deactivated", description: definition.description, createdAt: "2026-08-12T11:01:00Z", deactivatedAt: "2026-08-12T12:00:00Z" },
      { id: "wf_malformed", description: definition.description, createdAt: "2026-08-12T11:01:30Z" },
      { id: "wf_live", description: definition.description, createdAt: "2026-08-12T11:02:00Z", deletedAt: null, deactivatedAt: null },
    ];
    expect(findWorkflowsByRegistrationKey(rows, definition).map((row) => row.id)).toEqual(["wf_live"]);
    expect(selectCanonicalWorkflow(rows)?.id).toBe("wf_live");
  });

  it("compares the normalized canonical graph rather than trusting its registration description", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    const withMetadata = { ...definition, id: "wf_open", createdAt: "now" };
    expect(workflowGraphMatchesDefinition(withMetadata, definition)).toBe(true);
    const tampered = structuredClone(definition);
    tampered.nodes[3].data.config.contractAddress = "0x2222222222222222222222222222222222222222";
    const tamperedWithMetadata = { ...tampered, id: "wf_tampered" };
    expect(workflowGraphMatchesDefinition(tamperedWithMetadata, definition)).toBe(false);
    const wrongBranch = structuredClone(definition);
    delete wrongBranch.edges[2].sourceHandle;
    const wrongBranchWithMetadata = { ...wrongBranch, id: "wf_branch" };
    expect(workflowGraphMatchesDefinition(wrongBranchWithMetadata, definition)).toBe(false);

    const sanitized = structuredClone(definition);
    for (const node of sanitized.nodes) {
      (node as typeof node & { position: { x: number; y: number } }).position = { x: 0, y: 0 };
      node.data.status = "idle";
    }
    expect(workflowGraphMatchesDefinition(sanitized, definition)).toBe(true);

    const mutations = [
      (candidate: typeof definition) => { candidate.nodes[3].data.config.abiFunction = "finalizeSettlementForPolicy"; },
      (candidate: typeof definition) => { candidate.nodes[1].data.config.functionArgs = '["4"]'; },
      (candidate: typeof definition) => { candidate.nodes[2].data.config.condition = "true"; },
      (candidate: typeof definition) => { candidate.nodes[0].data.config.scheduleCron = "*/10 * * * *"; },
      (candidate: typeof definition) => { candidate.nodes[3].data.enabled = false; },
      (candidate: typeof definition) => { candidate.nodes[3].data.status = "unexpected"; },
      (candidate: typeof definition) => { candidate.edges[2].targetHandle = "unexpected"; },
      (candidate: typeof definition) => { candidate.edges[0].data = { mode: "changed" }; },
      (candidate: typeof definition) => { candidate.edges.pop(); },
      (candidate: typeof definition) => { candidate.nodes.push({ ...structuredClone(candidate.nodes[3]), id: "extra" }); },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(definition);
      mutate(candidate);
      expect(workflowGraphMatchesDefinition(candidate, definition)).toBe(false);
    }
  });

  it("treats EVM contract-address casing as semantic equality", () => {
    const definition = buildVaultWorkflows({ chainId: 84532, vault: "0x52908400098527886E0F7030069857D2E4169EE7", scheduleCron: "*/5 * * * *", policyVersion: 3n })[0];
    const lowercase = structuredClone(definition);
    for (const node of lowercase.nodes) {
      if (typeof node.data.config.contractAddress === "string") node.data.config.contractAddress = node.data.config.contractAddress.toLowerCase();
    }
    expect(workflowGraphMatchesDefinition(lowercase, definition)).toBe(true);
  });

  it("uses a stable definition-scoped create key and rotates it after a tombstoned candidate", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    expect(buildWorkflowCreateIdempotencyKey(definition, [])).toBe(buildWorkflowCreateIdempotencyKey(definition, []));
    expect(buildWorkflowCreateIdempotencyKey(definition, ["wf_b", "wf_a"])).toBe(buildWorkflowCreateIdempotencyKey(definition, ["wf_a", "wf_b"]));
    expect(buildWorkflowCreateIdempotencyKey(definition, ["wf_deleted"])).not.toBe(buildWorkflowCreateIdempotencyKey(definition, []));
    const finalize = buildVaultWorkflows({ chainId: 84532, vault: "0x1111111111111111111111111111111111111111", scheduleCron: "*/5 * * * *", policyVersion: 3n })[1];
    const nextPolicy = buildVaultWorkflows({ chainId: 84532, vault: "0x1111111111111111111111111111111111111111", scheduleCron: "*/5 * * * *", policyVersion: 4n })[0];
    expect(buildWorkflowCreateIdempotencyKey(finalize, [])).not.toBe(buildWorkflowCreateIdempotencyKey(definition, []));
    expect(buildWorkflowCreateIdempotencyKey(nextPolicy, [])).not.toBe(buildWorkflowCreateIdempotencyKey(definition, []));
  });
});
