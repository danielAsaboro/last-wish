import { z } from "zod";

const simulationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  parameterPath: z.string(),
  nodeId: z.string().min(1),
  fieldKey: z.string().optional(),
});

export const workflowSimulationSchema = z.object({
  warnings: z.array(simulationIssueSchema).optional().default([]),
  simulatedNodeCount: z.number().int().nonnegative(),
  skippedNodeCount: z.number().int().nonnegative(),
});

export type KeeperHubWorkflowSimulation = z.infer<typeof workflowSimulationSchema>;
export type WorkflowSimulationAssessment = {
  activationAllowed: boolean;
  mode: "simulated" | "policy_state_advisory" | "blocked";
  blockingWarnings: KeeperHubWorkflowSimulation["warnings"];
};

export function parseWorkflowSimulation(input: unknown): KeeperHubWorkflowSimulation {
  const parsed = workflowSimulationSchema.safeParse(input);
  if (!parsed.success) throw new Error("KeeperHub returned an invalid workflow simulation result.");
  return parsed.data;
}

export function assessWorkflowSimulation(
  simulation: KeeperHubWorkflowSimulation,
  options: { canonicalGraph?: boolean; policyGuardResult?: boolean } = {},
): WorkflowSimulationAssessment {
  const advisoryPolicyReverts = simulation.warnings.filter((warning) =>
    warning.code === "SIMULATION_WOULD_REVERT" &&
    warning.nodeId === "execute" &&
    warning.fieldKey === "abiFunction" &&
    warning.parameterPath === "nodes[3].data.config.abiFunction",
  );
  const blockingWarnings = simulation.warnings.filter((warning) => !advisoryPolicyReverts.includes(warning));
  const onlyExpectedPolicyRevert = simulation.warnings.length === 1 &&
    advisoryPolicyReverts.length === 1 &&
    blockingWarnings.length === 0 &&
    simulation.simulatedNodeCount === 0 &&
    simulation.skippedNodeCount === 0 &&
    options.canonicalGraph === true &&
    options.policyGuardResult === false;
  const fullySimulated = simulation.warnings.length === 0 && simulation.simulatedNodeCount === 1;
  const activationAllowed = simulation.skippedNodeCount === 0 && (fullySimulated || onlyExpectedPolicyRevert);

  return {
    activationAllowed,
    mode: activationAllowed ? (onlyExpectedPolicyRevert ? "policy_state_advisory" : "simulated") : "blocked",
    blockingWarnings: activationAllowed ? [] : blockingWarnings.length > 0 ? blockingWarnings : simulation.warnings,
  };
}
