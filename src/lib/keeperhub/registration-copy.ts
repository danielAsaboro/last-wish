const simulationModes = ["already_healthy", "simulated", "policy_state_advisory"] as const;
type SimulationMode = typeof simulationModes[number];

export function keeperHubRegistrationSuccessCopy(input: unknown): string {
  if (!Array.isArray(input) || input.length === 0 || !input.every(hasSimulationMode)) {
    throw new Error("KeeperHub returned an invalid workflow registration result.");
  }
  if (input.every((workflow) => workflow.simulationMode === "already_healthy")) {
    return "KeeperHub already has the exact enabled workflow pair; no pair replacement was needed.";
  }
  if (input.some((workflow) => workflow.simulationMode === "policy_state_advisory")) {
    return `Registered ${input.length} workflows; KeeperHub’s fixed write currently reverts as expected while the onchain eligibility guard is false, so scheduled execution remains condition-gated.`;
  }
  return `Registered ${input.length} workflows after clean KeeperHub static-write simulation.`;
}

function hasSimulationMode(value: unknown): value is { simulationMode: SimulationMode } {
  return Boolean(value && typeof value === "object" && "simulationMode" in value && simulationModes.includes((value as { simulationMode: SimulationMode }).simulationMode));
}
