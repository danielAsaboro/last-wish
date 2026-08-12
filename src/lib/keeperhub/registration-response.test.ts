import { describe, expect, it } from "vitest";

import { WorkflowRegistrationMutationError } from "./registration";
import { publicWorkflowRegistrationFailure } from "./registration-response";

const upstreamSecrets = "https://rpc.example/v2/private-key?token=secret Bearer private-token sk-abcdefghijklmnopqrstuvwxyz123456 hunter2";

describe("publicWorkflowRegistrationFailure", () => {
  it("redacts upstream mutation errors while retaining reconciliation metadata", () => {
    const observedWorkflows = [{
      workflowId: "wf_open",
      enabled: false,
      deletedAt: null,
      deactivatedAt: null,
      definitionMatches: true,
    }];
    const result = publicWorkflowRegistrationFailure(new WorkflowRegistrationMutationError(
      upstreamSecrets,
      [
        { action: "open", workflowId: "wf_open", operation: "simulated", outcome: "applied", detail: "policy_state_advisory" },
        { action: "finalize", workflowId: "wf_finalize", operation: "simulated", outcome: "applied", detail: "simulated" },
        { action: "open", workflowId: "wf_open", operation: "created", outcome: "applied", detail: upstreamSecrets },
        { action: "finalize", workflowId: "wf_finalize", operation: "simulated", outcome: "attempted", detail: upstreamSecrets },
        { action: "open", workflowId: "wf_open", operation: "simulated", outcome: "failed", detail: upstreamSecrets },
      ],
      observedWorkflows,
    ));

    expect(result).toMatchObject({
      error: "KeeperHub changed workflow state but could not confirm a healthy automation pair. Refresh readiness and evidence before authorizing another registration.",
      recoveryRequired: true,
      mutationJournal: expect.arrayContaining([
        { action: "open", workflowId: "wf_open", operation: "simulated", outcome: "applied", detail: "policy_state_advisory" },
        { action: "finalize", workflowId: "wf_finalize", operation: "simulated", outcome: "applied", detail: "simulated" },
        { action: "open", workflowId: "wf_open", operation: "created", outcome: "applied" },
        { action: "finalize", workflowId: "wf_finalize", operation: "simulated", outcome: "attempted" },
        { action: "open", workflowId: "wf_open", operation: "simulated", outcome: "failed" },
      ]),
      observedWorkflows,
    });
    expect(result.mutationJournal[2]).not.toHaveProperty("detail");
    expect(result.mutationJournal[3]).not.toHaveProperty("detail");
    expect(result.mutationJournal[4]).not.toHaveProperty("detail");

    const body = JSON.stringify(result);
    for (const secret of ["https://rpc.example/v2/private-key?token=secret", "Bearer private-token", "sk-abcdefghijklmnopqrstuvwxyz123456", "hunter2"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("uses a fixed preflight failure response for non-mutation errors", () => {
    expect(publicWorkflowRegistrationFailure(new Error(upstreamSecrets))).toEqual({
      error: "KeeperHub workflow registration could not be completed. Refresh readiness and evidence before retrying.",
      recoveryRequired: false,
      mutationJournal: [],
      observedWorkflows: [],
    });
  });
});
