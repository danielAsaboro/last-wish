import { z } from "zod";

import type { Address } from "@/lib/succession/types";

const inputSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  scheduleCron: z.string().trim().min(9).max(100),
});

const eligibilityAbi = JSON.stringify([
  {
    type: "function",
    name: "canOpenSettlement",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "canFinalizeSettlement",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "openSettlement",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeSettlement",
    stateMutability: "nonpayable",
    inputs: [],
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

export function buildVaultWorkflows(rawInput: {
  chainId: 84532 | 11155111;
  vault: Address;
  scheduleCron: string;
}): KeeperHubWorkflowDefinition[] {
  const input = inputSchema.parse(rawInput);
  return [buildWorkflow("open", input), buildWorkflow("finalize", input)];
}

function buildWorkflow(
  action: WorkflowAction,
  input: z.infer<typeof inputSchema>,
): KeeperHubWorkflowDefinition {
  const isOpen = action === "open";
  const eligibilityFunction = isOpen ? "canOpenSettlement" : "canFinalizeSettlement";
  const writeFunction = isOpen ? "openSettlement" : "finalizeSettlement";
  const shortAddress = `${input.vault.slice(0, 8)}…${input.vault.slice(-4)}`;
  const sharedContractConfig = {
    network: String(input.chainId),
    web3Connection: "default",
    contractAddress: input.vault,
    abi: eligibilityAbi,
    functionArgs: "[]",
  };

  return {
    name: `LastWish · ${action} · ${shortAddress}`,
    description: `Reads ${eligibilityFunction} onchain and only then asks KeeperHub to execute ${writeFunction}.`,
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
