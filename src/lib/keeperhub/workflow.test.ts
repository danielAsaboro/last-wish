import { describe, expect, it } from "vitest";

import { buildVaultWorkflows, findObsoleteVaultWorkflows, findWorkflowByRegistrationKey, findWorkflowsByRegistrationKey, isWorkflowForVault, selectCanonicalWorkflow } from "./workflow";

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
      expect(workflow.nodes.map((node) => node.type)).toEqual(["trigger", "action", "condition", "action"]);
      expect(workflow.nodes[1].data.config.actionType).toBe("web3/read-contract");
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
      { id: "wf_old", name: definition.name, description: definition.description.replace(":3:open", ":2:open") },
      { id: "wf_current", name: definition.name, description: definition.description },
    ], definition)).toMatchObject({ id: "wf_current" });
  });

  it("binds evidence workflow IDs to the requested chain and vault", () => {
    const description = "Reads eligibility. Registration key: lastwish:84532:0x1111111111111111111111111111111111111111:3:open";
    expect(isWorkflowForVault({ description }, 84532, "0x1111111111111111111111111111111111111111")).toBe(true);
    expect(isWorkflowForVault({ description }, 11155111, "0x1111111111111111111111111111111111111111")).toBe(false);
    expect(isWorkflowForVault({ description }, 84532, "0x2222222222222222222222222222222222222222")).toBe(false);
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
      { id: "wf_old", description: oldDescription },
      { id: "wf_current", description: current[0].description },
      { id: "wf_other_vault", description: current[0].description.replace(/0x1{40}/, `0x${"2".repeat(40)}`) },
    ], 84532, "0x1111111111111111111111111111111111111111", current)).toEqual([{ id: "wf_old", description: oldDescription }]);
  });

  it("selects one deterministic canonical copy when registration was replayed", () => {
    const definition = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
      policyVersion: 3n,
    })[0];
    const copies = findWorkflowsByRegistrationKey([
      { id: "wf_b", description: definition.description, createdAt: "2026-08-12T12:00:01Z" },
      { id: "wf_a", description: definition.description, createdAt: "2026-08-12T12:00:00Z" },
    ], definition);
    expect(selectCanonicalWorkflow(copies)?.id).toBe("wf_a");
  });
});
