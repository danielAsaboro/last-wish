export type DiscoveredWorkflowRegistration = { registrationState: "current" | "stale" };

export function countCurrentWorkflowRegistrations(workflows: DiscoveredWorkflowRegistration[]): number {
  return workflows.filter((workflow) => workflow.registrationState === "current").length;
}
