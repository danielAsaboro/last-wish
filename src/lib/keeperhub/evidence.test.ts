import { describe, expect, it } from "vitest";

import { deriveAutomationHealth, type DiscoveredWorkflowRegistration } from "./evidence";

const coverage = { runsReturned: 0, providerWindow: "latest_50_non_purged" as const, olderRunsMayExist: false, providerPagination: "unavailable" as const };

function workflow(overrides: Partial<DiscoveredWorkflowRegistration>): DiscoveredWorkflowRegistration {
  return {
    workflowId: "wf_open",
    name: "Open",
    policyVersion: "3",
    action: "open",
    enabled: true,
    registrationState: "current",
    coverage,
    ...overrides,
  };
}

describe("KeeperHub evidence discovery", () => {
  it("requires exactly one enabled current open and finalize workflow", () => {
    const currentOpen = workflow({});
    const currentFinalize = workflow({ workflowId: "wf_finalize", action: "finalize" });
    expect(deriveAutomationHealth([currentOpen, currentFinalize]).state).toBe("healthy");
    expect(deriveAutomationHealth([{ ...currentOpen, enabled: false }, currentFinalize]).state).toBe("recovery_required");
    expect(deriveAutomationHealth([currentOpen, { ...currentOpen, workflowId: "wf_open_copy" }, currentFinalize]).state).toBe("recovery_required");
    expect(deriveAutomationHealth([currentOpen]).state).toBe("recovery_required");
  });
});
