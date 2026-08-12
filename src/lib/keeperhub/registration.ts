import { getAddress, type Address } from "viem";

import { assessWorkflowSimulation, type KeeperHubWorkflowSimulation } from "./simulation";
import {
  buildWorkflowCreateIdempotencyKey,
  findAllWorkflowsByRegistrationKey,
  findObsoleteVaultWorkflows,
  findWorkflowsByRegistrationKey,
  isLiveWorkflow,
  parseWorkflowRegistrationKey,
  selectCanonicalWorkflow,
  workflowGraphMatchesDefinition,
  type KeeperHubWorkflowDefinition,
} from "./workflow";

type WorkflowRow = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt?: string;
  nodes: unknown[];
  edges: unknown[];
  deletedAt: string | null;
  deactivatedAt: string | null;
};

type RegistrationClient = {
  listWorkflows(): Promise<WorkflowRow[]>;
  createWorkflow(definition: KeeperHubWorkflowDefinition, idempotencyKey: string): Promise<Record<string, unknown>>;
  updateWorkflow(workflowId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  simulateWorkflow(workflowId: string): Promise<KeeperHubWorkflowSimulation>;
};

export type MutationJournalEntry = {
  action: "open" | "finalize" | "pair";
  workflowId: string;
  operation: "created" | "stage_disabled" | "simulated" | "activated" | "retired" | "duplicate_disabled" | "recovery_disabled";
  outcome: "attempted" | "applied" | "failed";
  detail?: string;
};

export type ObservedWorkflowState = {
  workflowId: string;
  enabled?: boolean;
  deletedAt?: string | null;
  deactivatedAt?: string | null;
  definitionMatches: boolean;
};

export class WorkflowRegistrationMutationError extends Error {
  readonly recoveryRequired = true;
  constructor(message: string, readonly journal: MutationJournalEntry[], readonly observedWorkflows: ObservedWorkflowState[]) {
    super(message);
    this.name = "WorkflowRegistrationMutationError";
  }
}

export async function registerVaultWorkflowPair(
  client: RegistrationClient,
  input: {
    chainId: number;
    vault: Address;
    definitions: KeeperHubWorkflowDefinition[];
    readPolicyGuard?: (definition: KeeperHubWorkflowDefinition) => Promise<boolean>;
  },
): Promise<{
  workflows: Array<{ workflowId: string; name: string; simulation?: KeeperHubWorkflowSimulation; simulationMode: "already_healthy" | "simulated" | "policy_state_advisory" }>;
  retiredWorkflowIds: string[];
  mutationJournal: MutationJournalEntry[];
}> {
  const journal: MutationJournalEntry[] = [];
  const touched = new Set<string>();
  const candidates: Array<{ row: WorkflowRow; definition: KeeperHubWorkflowDefinition; simulation?: KeeperHubWorkflowSimulation; simulationMode?: "simulated" | "policy_state_advisory" }> = [];
  let mutationBegan = false;
  let pairConfirmed = false;

  try {
    let rows = await client.listWorkflows();
    const healthy = input.definitions.map((definition) => {
      const matches = findWorkflowsByRegistrationKey(rows, definition);
      const enabled = matches.filter((row) => row.enabled === true);
      return enabled.length === 1 && matches.every((row) => workflowGraphMatchesDefinition(row, definition))
        ? { row: enabled[0], definition }
        : undefined;
    });
    if (healthy.every((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)) {
      const enabledObsolete = findObsoleteVaultWorkflows(
        rows,
        input.chainId,
        getAddress(input.vault),
        input.definitions,
      ).filter((row) => row.enabled === true);
      if (enabledObsolete.length > 0) {
        pairConfirmed = true;
        for (const obsolete of enabledObsolete) {
          touched.add(obsolete.id);
          mutationBegan = true;
          await mutate(client, journal, definitionActionFromRow(obsolete), obsolete.id, "retired", { enabled: false });
        }
        rows = await client.listWorkflows();
        try {
          assertConfirmedPair(rows, healthy);
        } catch (error) {
          pairConfirmed = false;
          throw error;
        }
        assertRetired(rows, enabledObsolete.map((row) => row.id));
        assertNoEnabledObsolete(rows, input, touched);
      }
      return {
        workflows: healthy.map(({ row, definition }) => ({ workflowId: row.id, name: definition.name, simulationMode: "already_healthy" })),
        retiredWorkflowIds: enabledObsolete.map((row) => row.id),
        mutationJournal: journal,
      };
    }

    for (const definition of input.definitions) {
      const action = definitionAction(definition);
      let matches = findWorkflowsByRegistrationKey(rows, definition);
      let canonical = selectCanonicalWorkflow(matches);
      if (!canonical) {
        const inactiveIds = findAllWorkflowsByRegistrationKey(rows, definition).filter((row) => !isLiveWorkflow(row)).map((row) => row.id);
        mutationBegan = true;
        journal.push({ action, workflowId: "pending", operation: "created", outcome: "attempted", detail: definition.description });
        let created: Record<string, unknown>;
        try {
          created = await client.createWorkflow({ ...definition, enabled: false }, buildWorkflowCreateIdempotencyKey(definition, inactiveIds));
        } catch (error) {
          journal.push({ action, workflowId: "pending", operation: "created", outcome: "failed", detail: errorText(error) });
          throw error;
        }
        let candidateId: string;
        try {
          candidateId = workflowId(created);
        } catch (error) {
          journal.push({ action, workflowId: "pending", operation: "created", outcome: "failed", detail: errorText(error) });
          throw error;
        }
        touched.add(candidateId);
        journal.push({ action, workflowId: candidateId, operation: "created", outcome: "applied" });
        rows = await client.listWorkflows();
        matches = findWorkflowsByRegistrationKey(rows, definition);
        canonical = selectCanonicalWorkflow(matches);
        if (!canonical) throw new Error(`KeeperHub did not expose the newly created ${definition.name} candidate.`);
      }

      for (const match of matches) {
        const operation = match.id === canonical.id ? "stage_disabled" : "duplicate_disabled";
        touched.add(match.id);
        mutationBegan = true;
        await mutate(client, journal, action, match.id, operation, { ...definition, enabled: false });
      }
      rows = await client.listWorkflows();
      const staged = rows.find((row) => row.id === canonical!.id);
      const stagedMatches = findWorkflowsByRegistrationKey(rows, definition);
      if (
        !staged ||
        staged.enabled !== false ||
        !workflowGraphMatchesDefinition(staged, definition) ||
        stagedMatches.some((row) => row.enabled !== false || !workflowGraphMatchesDefinition(row, definition))
      ) {
        throw new Error(`KeeperHub did not preserve a disabled canonical graph for ${definition.name}.`);
      }
      candidates.push({ row: staged, definition });
    }

    rows = await client.listWorkflows();
    for (const candidate of candidates) {
      const staged = rows.find((row) => row.id === candidate.row.id);
      const stagedMatches = findWorkflowsByRegistrationKey(rows, candidate.definition);
      if (
        !staged ||
        !isLiveWorkflow(staged) ||
        staged.enabled !== false ||
        !workflowGraphMatchesDefinition(staged, candidate.definition) ||
        stagedMatches.some((row) => row.enabled !== false || !workflowGraphMatchesDefinition(row, candidate.definition))
      ) {
        throw new Error(`KeeperHub did not preserve the complete disabled workflow pair before simulation.`);
      }
      candidate.row = staged;
    }

    let simulationFailure: unknown;
    for (const candidate of candidates) {
      const action = definitionAction(candidate.definition);
      journal.push({ action, workflowId: candidate.row.id, operation: "simulated", outcome: "attempted" });
      try {
        const simulation = await client.simulateWorkflow(candidate.row.id);
        const assessment = assessWorkflowSimulation(simulation, {
          canonicalGraph: workflowGraphMatchesDefinition(candidate.row, candidate.definition),
          policyGuardResult: input.readPolicyGuard ? await input.readPolicyGuard(candidate.definition) : undefined,
        });
        journal.push({ action, workflowId: candidate.row.id, operation: "simulated", outcome: "applied", detail: assessment.mode });
        if (!assessment.activationAllowed) {
          simulationFailure ??= new Error(`KeeperHub preflight blocked ${candidate.definition.name}; the staged pair remains disabled.`);
          continue;
        }
        candidate.simulation = simulation;
        candidate.simulationMode = assessment.mode === "policy_state_advisory" ? "policy_state_advisory" : "simulated";
      } catch (error) {
        journal.push({ action, workflowId: candidate.row.id, operation: "simulated", outcome: "failed", detail: errorText(error) });
        simulationFailure ??= error;
      }
    }
    if (simulationFailure) throw simulationFailure;

    const activationOrder = [...candidates].sort((left, right) => actionRank(left.definition) - actionRank(right.definition));
    for (const candidate of activationOrder) {
      mutationBegan = true;
      await mutate(client, journal, definitionAction(candidate.definition), candidate.row.id, "activated", { ...candidate.definition, enabled: true });
    }

    let reconciled = await client.listWorkflows();
    assertConfirmedPair(reconciled, candidates);
    pairConfirmed = true;

    const retiredWorkflowIds: string[] = [];
    const enabledObsolete = findObsoleteVaultWorkflows(
      reconciled,
      input.chainId,
      getAddress(input.vault),
      input.definitions,
    ).filter((row) => row.enabled === true);
    for (const obsolete of enabledObsolete) {
      touched.add(obsolete.id);
      mutationBegan = true;
      await mutate(client, journal, definitionActionFromRow(obsolete), obsolete.id, "retired", { enabled: false });
      retiredWorkflowIds.push(obsolete.id);
    }

    reconciled = await client.listWorkflows();
    try {
      assertConfirmedPair(reconciled, candidates);
    } catch (error) {
      pairConfirmed = false;
      throw error;
    }
    assertRetired(reconciled, retiredWorkflowIds);
    assertNoEnabledObsolete(reconciled, input, touched);
    for (const candidate of candidates) {
      const matches = findWorkflowsByRegistrationKey(reconciled, candidate.definition);
      for (const duplicate of matches.filter((row) => row.id !== candidate.row.id && row.enabled === true)) {
        touched.add(duplicate.id);
        mutationBegan = true;
        await mutate(client, journal, definitionAction(candidate.definition), duplicate.id, "duplicate_disabled", { enabled: false });
      }
    }
    reconciled = await client.listWorkflows();
    try {
      assertConfirmedPair(reconciled, candidates);
    } catch (error) {
      pairConfirmed = false;
      throw error;
    }
    assertNoEnabledObsolete(reconciled, input, touched);

    return {
      workflows: candidates.map((candidate) => ({
        workflowId: candidate.row.id,
        name: candidate.definition.name,
        simulation: candidate.simulation,
        simulationMode: candidate.simulationMode!,
      })),
      retiredWorkflowIds,
      mutationJournal: journal,
    };
  } catch (error) {
    if (!mutationBegan) throw error;
    let observed: WorkflowRow[] = [];
    try {
      observed = await client.listWorkflows();
      if (!pairConfirmed) {
        for (const row of observed) {
          const relevant = touched.has(row.id) || input.definitions.some((definition) => findAllWorkflowsByRegistrationKey([row], definition).length > 0);
          if (!relevant || !isLiveWorkflow(row)) continue;
          touched.add(row.id);
          try {
            await mutate(client, journal, definitionActionFromRow(row), row.id, "recovery_disabled", { enabled: false });
          } catch {
            // mutate journals the failed cleanup and recovery continues for every candidate.
          }
        }
        observed = await client.listWorkflows();
      }
    } catch (recoveryError) {
      journal.push({ action: "pair", workflowId: "unknown", operation: "recovery_disabled", outcome: "failed", detail: errorText(recoveryError) });
    }
    throw new WorkflowRegistrationMutationError(errorText(error), journal, observedStates(observed, touched, input.definitions));
  }
}

async function mutate(
  client: RegistrationClient,
  journal: MutationJournalEntry[],
  action: MutationJournalEntry["action"],
  workflowId: string,
  operation: MutationJournalEntry["operation"],
  patch: Record<string, unknown>,
): Promise<void> {
  journal.push({ action, workflowId, operation, outcome: "attempted" });
  try {
    await client.updateWorkflow(workflowId, patch);
    journal.push({ action, workflowId, operation, outcome: "applied" });
  } catch (error) {
    journal.push({ action, workflowId, operation, outcome: "failed", detail: errorText(error) });
    throw error;
  }
}

function assertConfirmedPair(rows: WorkflowRow[], candidates: Array<{ row: WorkflowRow; definition: KeeperHubWorkflowDefinition }>): void {
  for (const candidate of candidates) {
    const matches = findWorkflowsByRegistrationKey(rows, candidate.definition);
    const enabled = matches.filter((row) => row.enabled === true);
    if (
      enabled.length !== 1 ||
      enabled[0].id !== candidate.row.id ||
      matches.some((row) => !workflowGraphMatchesDefinition(row, candidate.definition))
    ) {
      throw new Error(`KeeperHub could not reconcile the activated ${candidate.definition.name} workflow.`);
    }
  }
}

function assertRetired(rows: WorkflowRow[], retiredWorkflowIds: string[]): void {
  for (const workflowId of retiredWorkflowIds) {
    const workflow = rows.find((row) => row.id === workflowId);
    if (workflow && isLiveWorkflow(workflow) && workflow.enabled === true) {
      throw new Error(`KeeperHub did not retire obsolete workflow ${workflowId}.`);
    }
  }
}

function assertNoEnabledObsolete(
  rows: WorkflowRow[],
  input: { chainId: number; vault: Address; definitions: KeeperHubWorkflowDefinition[] },
  touched: Set<string>,
): void {
  const enabledObsolete = findObsoleteVaultWorkflows(
    rows,
    input.chainId,
    getAddress(input.vault),
    input.definitions,
  ).filter((row) => row.enabled === true);
  for (const workflow of enabledObsolete) touched.add(workflow.id);
  if (enabledObsolete.length > 0) {
    throw new Error("KeeperHub exposed an enabled prior-policy workflow during final reconciliation.");
  }
}

function observedStates(
  rows: WorkflowRow[],
  touched: Set<string>,
  definitions: KeeperHubWorkflowDefinition[],
): ObservedWorkflowState[] {
  return rows.filter((row) => touched.has(row.id) || definitions.some((definition) => findAllWorkflowsByRegistrationKey([row], definition).length > 0)).map((row) => {
    const registration = parseWorkflowRegistrationKey(row.description);
    const definition = definitions.find((candidate) => parseWorkflowRegistrationKey(candidate.description)?.action === registration?.action);
    return {
      workflowId: row.id,
      enabled: row.enabled,
      deletedAt: row.deletedAt,
      deactivatedAt: row.deactivatedAt,
      definitionMatches: Boolean(definition && workflowGraphMatchesDefinition(row, definition)),
    };
  });
}

function actionRank(definition: KeeperHubWorkflowDefinition): number {
  return parseWorkflowRegistrationKey(definition.description)?.action === "finalize" ? 0 : 1;
}

function definitionAction(definition: KeeperHubWorkflowDefinition): "open" | "finalize" {
  const action = parseWorkflowRegistrationKey(definition.description)?.action;
  if (!action) throw new Error("LastWish could not resolve a canonical workflow action.");
  return action;
}

function definitionActionFromRow(row: { description?: string }): "open" | "finalize" | "pair" {
  return parseWorkflowRegistrationKey(row.description)?.action ?? "pair";
}

function workflowId(response: Record<string, unknown>): string {
  const candidate = response.workflowId ?? response.id;
  if (typeof candidate !== "string" || candidate.length === 0) throw new Error("KeeperHub created a workflow without returning its identifier.");
  return candidate;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "KeeperHub workflow registration failed";
}
