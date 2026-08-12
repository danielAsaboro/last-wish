import {
  WorkflowRegistrationMutationError,
  type MutationJournalEntry,
  type ObservedWorkflowState,
} from "./registration";

const mutationFailureMessage = "KeeperHub changed workflow state but could not confirm a healthy automation pair. Refresh readiness and evidence before authorizing another registration.";
const preflightFailureMessage = "KeeperHub workflow registration could not be completed. Refresh readiness and evidence before retrying.";

export type PublicMutationJournalEntry = Omit<MutationJournalEntry, "detail"> & { detail?: "simulated" | "policy_state_advisory" };

export function publicWorkflowRegistrationFailure(error: unknown): {
  error: string;
  recoveryRequired: boolean;
  mutationJournal: PublicMutationJournalEntry[];
  observedWorkflows: ObservedWorkflowState[];
} {
  if (!(error instanceof WorkflowRegistrationMutationError)) {
    return {
      error: preflightFailureMessage,
      recoveryRequired: false,
      mutationJournal: [],
      observedWorkflows: [],
    };
  }

  return {
    error: mutationFailureMessage,
    recoveryRequired: true,
    mutationJournal: error.journal.map((entry) => {
      const publicEntry: PublicMutationJournalEntry = {
        action: entry.action,
        workflowId: entry.workflowId,
        operation: entry.operation,
        outcome: entry.outcome,
      };
      if (entry.detail === "simulated" || entry.detail === "policy_state_advisory") {
        publicEntry.detail = entry.detail;
      }
      return publicEntry;
    }),
    observedWorkflows: error.observedWorkflows,
  };
}
