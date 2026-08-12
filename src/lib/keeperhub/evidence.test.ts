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
    definitionMatches: true,
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
    expect(deriveAutomationHealth([
      currentOpen,
      { ...currentOpen, workflowId: "wf_open_disabled", enabled: false },
      currentFinalize,
    ]).state).toBe("healthy");
    expect(deriveAutomationHealth([{ ...currentOpen, enabled: false }, currentFinalize]).state).toBe("recovery_required");
    expect(deriveAutomationHealth([currentOpen, { ...currentOpen, workflowId: "wf_open_copy" }, currentFinalize]).state).toBe("recovery_required");
    expect(deriveAutomationHealth([currentOpen]).state).toBe("recovery_required");
  });

  it("requires a canonical normalized graph before declaring matching metadata healthy", () => {
    const currentOpen = workflow({ definitionMatches: false });
    const currentFinalize = workflow({ workflowId: "wf_finalize", action: "finalize", definitionMatches: true });
    expect(deriveAutomationHealth([currentOpen, currentFinalize])).toMatchObject({
      state: "recovery_required",
      detail: expect.stringMatching(/graph|definition/i),
    });
  });

  it("requires recovery when a disabled current-key duplicate carries graph drift", () => {
    const currentOpen = workflow({});
    const currentFinalize = workflow({ workflowId: "wf_finalize", action: "finalize" });
    const driftedDuplicate = workflow({
      workflowId: "wf_open_drifted",
      enabled: false,
      definitionMatches: false,
    });

    expect(deriveAutomationHealth([currentOpen, driftedDuplicate, currentFinalize])).toMatchObject({
      state: "recovery_required",
      detail: expect.stringMatching(/graph|definition/i),
    });
  });

  it("requires recovery while a stale prior-policy workflow remains enabled", () => {
    const currentOpen = workflow({});
    const currentFinalize = workflow({ workflowId: "wf_finalize", action: "finalize" });
    const staleOpen = workflow({
      workflowId: "wf_open_v2",
      policyVersion: "2",
      registrationState: "stale",
    });

    expect(deriveAutomationHealth([currentOpen, currentFinalize, staleOpen])).toMatchObject({
      state: "recovery_required",
      detail: expect.stringMatching(/stale|prior-policy/i),
    });
    expect(deriveAutomationHealth([currentOpen, currentFinalize, { ...staleOpen, enabled: false }]).state).toBe("healthy");
  });
});
