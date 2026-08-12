import { describe, expect, it } from "vitest";

import { buildVaultWorkflows } from "./workflow";

describe("buildVaultWorkflows", () => {
  it("builds scheduled read-condition-write workflows for both settlement stages", () => {
    const workflows = buildVaultWorkflows({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      scheduleCron: "*/5 * * * *",
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
    expect(workflows[0].nodes[1].data.config.abiFunction).toBe("canOpenSettlement");
    expect(workflows[0].nodes[3].data.config.abiFunction).toBe("openSettlement");
    expect(workflows[1].nodes[1].data.config.abiFunction).toBe("canFinalizeSettlement");
    expect(workflows[1].nodes[3].data.config.abiFunction).toBe("finalizeSettlement");
  });
});
