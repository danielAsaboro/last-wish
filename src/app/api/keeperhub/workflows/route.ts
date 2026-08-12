import { z } from "zod";
import type { Address } from "viem";

import { selectExecutionChain } from "@/lib/keeperhub/client";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { buildVaultWorkflows } from "@/lib/keeperhub/workflow";

const requestSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  scheduleCron: z.string().trim().min(9).max(100).default("*/5 * * * *"),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid KeeperHub workflow request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!process.env.KEEPERHUB_API_KEY) {
    return Response.json(
      {
        configured: false,
        error: "KeeperHub automation is unavailable because KEEPERHUB_API_KEY is not configured.",
      },
      { status: 503 },
    );
  }

  const client = keeperHubClientFromEnv();
  const registered: Array<{ workflowId: string; name: string; simulation: unknown }> = [];
  try {
    const selected = selectExecutionChain(await client.getChains());
    if (selected.chainId !== parsed.data.chainId) {
      return Response.json(
        { error: `KeeperHub selected ${selected.name}; switch the wallet to chain ${selected.chainId} before registration.` },
        { status: 409 },
      );
    }

    for (const definition of buildVaultWorkflows({ ...parsed.data, vault: parsed.data.vault as Address })) {
      const created = await client.createWorkflow({ ...definition, enabled: false });
      const workflowId = getWorkflowId(created);
      const simulation = await client.simulateWorkflow(workflowId);
      if (simulationIndicatesFailure(simulation)) {
        throw new Error(`KeeperHub preflight rejected ${definition.name}; the workflow remains disabled.`);
      }
      await client.updateWorkflow(workflowId, { enabled: true });
      registered.push({ workflowId, name: definition.name, simulation });
    }
    return Response.json({ configured: true, chain: selected, workflows: registered }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "KeeperHub workflow registration failed",
        registered,
        recoveryRequired: registered.length > 0,
      },
      { status: 502 },
    );
  }
}

function getWorkflowId(response: Record<string, unknown>): string {
  const candidate = response.workflowId ?? response.id;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("KeeperHub created a workflow without returning its identifier.");
  }
  return candidate;
}

function simulationIndicatesFailure(simulation: Record<string, unknown>): boolean {
  return simulation.success === false || simulation.wouldRevert === true || simulation.status === "failed";
}
