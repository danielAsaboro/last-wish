import { describe, expect, it } from "vitest";

import { assessWorkflowSimulation } from "./simulation";

const issue = (code: string, nodeId = "execute") => ({
  code,
  nodeId,
  message: `${code} from KeeperHub`,
  parameterPath: "nodes[3].data.config.abiFunction",
  fieldKey: "abiFunction",
});

describe("KeeperHub workflow simulation activation policy", () => {
  it("allows a fully simulated static write", () => {
    expect(assessWorkflowSimulation({ warnings: [], simulatedNodeCount: 1, skippedNodeCount: 0 })).toEqual({
      activationAllowed: true,
      mode: "simulated",
      blockingWarnings: [],
    });
  });

  it.each([
    ["SIMULATION_INVALID_WEB3_CONNECTION", 0],
    ["SIMULATION_SIGNER_UNAVAILABLE", 1],
    ["SIMULATION_INVALID_NETWORK", 0],
    ["SIMULATION_INVALID_TRANSACTION", 0],
    ["SIMULATION_UNAVAILABLE", 1],
    ["SIMULATION_SAFE_SIGNER_UNSUPPORTED", 1],
    ["SIMULATION_DYNAMIC_INPUT", 1],
  ])("blocks activation for source warning %s", (code, skippedNodeCount) => {
    const warning = issue(code);
    expect(assessWorkflowSimulation({ warnings: [warning], simulatedNodeCount: 0, skippedNodeCount })).toEqual({
      activationAllowed: false,
      mode: "blocked",
      blockingWarnings: [warning],
    });
  });

  it("distinguishes the canonical gated write's policy-state revert as advisory", () => {
    expect(assessWorkflowSimulation(
      { warnings: [issue("SIMULATION_WOULD_REVERT")], simulatedNodeCount: 0, skippedNodeCount: 0 },
      { canonicalGraph: true, policyGuardResult: false },
    )).toEqual({
      activationAllowed: true,
      mode: "policy_state_advisory",
      blockingWarnings: [],
    });
    expect(assessWorkflowSimulation(
      { warnings: [issue("SIMULATION_WOULD_REVERT", "other")], simulatedNodeCount: 0, skippedNodeCount: 0 },
      { canonicalGraph: true, policyGuardResult: false },
    ).activationAllowed).toBe(false);
    expect(assessWorkflowSimulation(
      { warnings: [issue("SIMULATION_WOULD_REVERT")], simulatedNodeCount: 0, skippedNodeCount: 0 },
      { canonicalGraph: true, policyGuardResult: true },
    ).activationAllowed).toBe(false);
  });

  it("blocks an unexamined skipped write even when no warning was returned", () => {
    expect(assessWorkflowSimulation({ warnings: [], simulatedNodeCount: 0, skippedNodeCount: 1 }).activationAllowed).toBe(false);
  });
});
