export type WorkflowCoverage = {
  runsReturned: number;
  providerWindow: "latest_50_non_purged";
  olderRunsMayExist: boolean;
  providerPagination: "unavailable";
};

export type DiscoveredWorkflowRegistration = {
  workflowId: string;
  name: string;
  policyVersion: string;
  action: "open" | "finalize";
  enabled?: boolean;
  registrationState: "current" | "stale";
  coverage: WorkflowCoverage;
};

export type AutomationHealth = {
  state: "healthy" | "recovery_required";
  detail: string;
};

export function deriveAutomationHealth(workflows: DiscoveredWorkflowRegistration[]): AutomationHealth {
  const current = workflows.filter((workflow) => workflow.registrationState === "current");
  const problems = (["open", "finalize"] as const).flatMap((action) => {
    const matches = current.filter((workflow) => workflow.action === action);
    if (matches.length === 0) return [`the current ${action} workflow is missing`];
    if (matches.length > 1) return [`the current ${action} workflow is duplicated`];
    if (matches[0].enabled !== true) return [`the current ${action} workflow is disabled`];
    return [];
  });
  return problems.length === 0
    ? { state: "healthy", detail: "Enabled current open and finalize workflows are registered." }
    : { state: "recovery_required", detail: `${capitalize(problems.join(" and "))}. Re-register only after inspecting the existing workflows and evidence.` };
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
