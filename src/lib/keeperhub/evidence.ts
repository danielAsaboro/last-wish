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
  definitionMatches: boolean;
  registrationState: "current" | "stale";
  coverage: WorkflowCoverage;
};

export type AutomationHealth = {
  state: "healthy" | "recovery_required";
  detail: string;
};

export function deriveAutomationHealth(workflows: DiscoveredWorkflowRegistration[]): AutomationHealth {
  const current = workflows.filter((workflow) => workflow.registrationState === "current");
  const enabledStale = workflows.filter((workflow) => workflow.registrationState === "stale" && workflow.enabled === true);
  const problems = [
    ...(enabledStale.length > 0 ? ["a stale prior-policy workflow remains enabled"] : []),
    ...(["open", "finalize"] as const).flatMap((action) => {
      const matches = current.filter((workflow) => workflow.action === action);
      if (matches.length === 0) return [`the current ${action} workflow is missing`];
      if (matches.some((workflow) => !workflow.definitionMatches)) {
        return [`a current ${action} workflow graph does not match the canonical LastWish definition`];
      }
      const enabled = matches.filter((workflow) => workflow.enabled === true);
      if (enabled.length === 0) return [`the current ${action} workflow is disabled`];
      if (enabled.length > 1) return [`the current ${action} workflow is duplicated`];
      return [];
    }),
  ];
  return problems.length === 0
    ? { state: "healthy", detail: "Enabled current open and finalize workflows are registered." }
    : { state: "recovery_required", detail: `${capitalize(problems.join(" and "))}. Re-register only after inspecting the existing workflows and evidence.` };
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
