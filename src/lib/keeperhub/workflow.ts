import { z } from "zod";

import type { Address } from "@/lib/succession/types";

const inputSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  scheduleCron: z.string().trim().min(9).max(100),
  policyVersion: z.coerce.bigint().positive(),
});

const eligibilityAbi = JSON.stringify([
  {
    type: "function",
    name: "canOpenSettlementForPolicy",
    stateMutability: "view",
    inputs: [{ name: "expectedPolicyVersion", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "canFinalizeSettlementForPolicy",
    stateMutability: "view",
    inputs: [{ name: "expectedPolicyVersion", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "openSettlementForPolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "expectedPolicyVersion", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeSettlementForPolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "expectedPolicyVersion", type: "uint256" }],
    outputs: [],
  },
]);

type WorkflowAction = "open" | "finalize";
type Node = {
  id: string;
  type: "trigger" | "action" | "condition";
  data: { label: string; config: Record<string, string> };
};

export type KeeperHubWorkflowDefinition = {
  name: string;
  description: string;
  enabled: boolean;
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
};

export function findWorkflowByRegistrationKey<T extends { description?: string }>(
  workflows: T[],
  definition: KeeperHubWorkflowDefinition,
): T | undefined {
  const key = definition.description.match(/Registration key: (lastwish:\S+)$/)?.[1];
  return key ? workflows.find((workflow) => workflow.description?.includes(`Registration key: ${key}`)) : undefined;
}

export function findWorkflowsByRegistrationKey<T extends { description?: string }>(
  workflows: T[],
  definition: KeeperHubWorkflowDefinition,
): T[] {
  const key = definition.description.match(/Registration key: (lastwish:\S+)$/)?.[1];
  return key ? workflows.filter((workflow) => workflow.description?.includes(`Registration key: ${key}`)) : [];
}

export function selectCanonicalWorkflow<T extends { id: string; createdAt?: string }>(workflows: T[]): T | undefined {
  return [...workflows].sort((left, right) =>
    (left.createdAt ?? "9999").localeCompare(right.createdAt ?? "9999") || left.id.localeCompare(right.id),
  )[0];
}

export function isWorkflowForVault(
  workflow: { description?: string },
  chainId: number,
  vault: Address,
): boolean {
  return workflow.description?.includes(`Registration key: lastwish:${chainId}:${vault.toLowerCase()}:`) === true;
}

export function findObsoleteVaultWorkflows<T extends { description?: string }>(
  workflows: T[],
  chainId: number,
  vault: Address,
  currentDefinitions: KeeperHubWorkflowDefinition[],
): T[] {
  return workflows.filter((workflow) =>
    isWorkflowForVault(workflow, chainId, vault) &&
    !currentDefinitions.some((definition) => findWorkflowByRegistrationKey([workflow], definition)),
  );
}

export function buildVaultWorkflows(rawInput: {
  chainId: 84532 | 11155111;
  vault: Address;
  scheduleCron: string;
  policyVersion: bigint;
}): KeeperHubWorkflowDefinition[] {
  const input = inputSchema.parse(rawInput);
  return [buildWorkflow("open", input), buildWorkflow("finalize", input)];
}

function buildWorkflow(
  action: WorkflowAction,
  input: z.infer<typeof inputSchema>,
): KeeperHubWorkflowDefinition {
  const isOpen = action === "open";
  const eligibilityFunction = isOpen ? "canOpenSettlementForPolicy" : "canFinalizeSettlementForPolicy";
  const writeFunction = isOpen ? "openSettlementForPolicy" : "finalizeSettlementForPolicy";
  const shortAddress = `${input.vault.slice(0, 8)}…${input.vault.slice(-4)}`;
  const sharedContractConfig = {
    network: String(input.chainId),
    web3Connection: "default",
    contractAddress: input.vault,
    abi: eligibilityAbi,
    functionArgs: JSON.stringify([input.policyVersion.toString()]),
  };

  return {
    name: `LastWish · ${action} · ${shortAddress}`,
    description: `Reads ${eligibilityFunction} onchain and only then asks KeeperHub to execute ${writeFunction}. Registration key: lastwish:${input.chainId}:${input.vault.toLowerCase()}:${input.policyVersion}:${action}`,
    enabled: true,
    nodes: [
      {
        id: "schedule",
        type: "trigger",
        data: {
          label: "Scheduled policy check",
          config: {
            triggerType: "Schedule",
            scheduleCron: input.scheduleCron,
            scheduleTimezone: "UTC",
          },
        },
      },
      {
        id: "check",
        type: "action",
        data: {
          label: "Check eligibility",
          config: {
            actionType: "web3/read-contract",
            ...sharedContractConfig,
            abiFunction: eligibilityFunction,
          },
        },
      },
      {
        id: "eligible",
        type: "condition",
        data: {
          label: "Eligible onchain?",
          config: {
            conditionType: "value-comparison",
            input: "{{@check:Check eligibility.result}}",
            operator: "==",
            value: "true",
          },
        },
      },
      {
        id: "execute",
        type: "action",
        data: {
          label: isOpen ? "Open grace period" : "Finalize settlement",
          config: {
            actionType: "web3/write-contract",
            ...sharedContractConfig,
            abiFunction: writeFunction,
          },
        },
      },
    ],
    edges: [
      { id: "schedule-check", source: "schedule", target: "check" },
      { id: "check-condition", source: "check", target: "eligible" },
      { id: "condition-execute", source: "eligible", target: "execute", sourceHandle: "true" },
    ],
  };
}
