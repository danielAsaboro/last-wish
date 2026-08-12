import { z } from "zod";
import { createPublicClient, getAddress, http, verifyMessage, type Address } from "viem";

import { baseSepolia, sepolia } from "@/lib/chains";
import { factoryAbi, vaultAbi } from "@/lib/contracts/abi";
import { buildWorkflowAuthorizationMessage, validateWorkflowAuthorizationWindow, withWorkflowRegistrationLock } from "@/lib/keeperhub/authorization";
import { selectExecutionChain } from "@/lib/keeperhub/client";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { buildVaultWorkflows, findObsoleteVaultWorkflows, findWorkflowByRegistrationKey, findWorkflowsByRegistrationKey, selectCanonicalWorkflow } from "@/lib/keeperhub/workflow";

const requestSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  scheduleCron: z.string().trim().min(9).max(100).default("*/5 * * * *"),
  policyVersion: z.coerce.bigint().positive(),
  expiresAt: z.number().int().positive(),
  signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
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
  const configuredFactory = process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
  if (!configuredFactory || !/^0x[a-fA-F0-9]{40}$/.test(configuredFactory)) {
    return Response.json({ configured: false, error: "KeeperHub registration requires a configured trusted LastWish factory." }, { status: 503 });
  }

  const client = keeperHubClientFromEnv();
  const registered: Array<{ workflowId: string; name: string; simulation: unknown }> = [];
  const retiredWorkflowIds: string[] = [];
  try {
    const chain = parsed.data.chainId === baseSepolia.id ? baseSepolia : sepolia;
    const rpcUrl = parsed.data.chainId === baseSepolia.id ? process.env.BASE_SEPOLIA_RPC_URL : process.env.SEPOLIA_RPC_URL;
    const rpc = createPublicClient({ chain, transport: http(rpcUrl) });
    const vault = getAddress(parsed.data.vault);
    const signer = getAddress(parsed.data.signer);
    const factory = getAddress(configuredFactory);
    try {
      validateWorkflowAuthorizationWindow(parsed.data.expiresAt, Math.floor(Date.now() / 1_000));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid workflow authorization window." }, { status: 403 });
    }
    const [owner, policyVersion] = await Promise.all([
      rpc.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
      rpc.readContract({ address: vault, abi: vaultAbi, functionName: "policyVersion" }),
    ]);
    if (owner.toLowerCase() !== signer.toLowerCase() || policyVersion !== parsed.data.policyVersion) {
      return Response.json({ error: "Workflow registration must be authorized by the current vault owner and policy version." }, { status: 403 });
    }
    const factoryVault = await rpc.readContract({ address: factory, abi: factoryAbi, functionName: "vaultOf", args: [owner] });
    if (factoryVault.toLowerCase() !== vault.toLowerCase()) {
      return Response.json({ error: "Workflow registration is limited to vaults created by the configured LastWish factory." }, { status: 403 });
    }
    const authorized = await verifyMessage({
      address: signer,
      message: buildWorkflowAuthorizationMessage({ ...parsed.data, vault }),
      signature: parsed.data.signature as `0x${string}`,
    }).catch(() => false);
    if (!authorized) return Response.json({ error: "Invalid workflow registration signature." }, { status: 403 });

    const selected = selectExecutionChain(await client.getChains());
    if (selected.chainId !== parsed.data.chainId) {
      return Response.json(
        { error: `KeeperHub selected ${selected.name}; switch the wallet to chain ${selected.chainId} before registration.` },
        { status: 409 },
      );
    }

    const definitions = buildVaultWorkflows({ ...parsed.data, vault: parsed.data.vault as Address });
    const lockKey = `${parsed.data.chainId}:${vault.toLowerCase()}:${policyVersion}`;
    await withWorkflowRegistrationLock(lockKey, async () => {
      const existingWorkflows = await client.listWorkflows();
      for (const obsolete of findObsoleteVaultWorkflows(existingWorkflows, parsed.data.chainId, vault, definitions)) {
        await client.updateWorkflow(obsolete.id, { enabled: false });
        retiredWorkflowIds.push(obsolete.id);
      }
      for (const definition of definitions) {
        const existing = findWorkflowByRegistrationKey(existingWorkflows, definition);
        const candidateId = existing?.id ?? getWorkflowId(await client.createWorkflow({ ...definition, enabled: false }));
        if (existing) await client.updateWorkflow(candidateId, { ...definition, enabled: false });

        const copies = findWorkflowsByRegistrationKey(await client.listWorkflows(), definition);
        const canonical = selectCanonicalWorkflow(copies) ?? { id: candidateId };
        for (const copy of copies) await client.updateWorkflow(copy.id, { enabled: false });
        await client.updateWorkflow(canonical.id, { ...definition, enabled: false });
        const simulation = await client.simulateWorkflow(canonical.id);
        let finalSimulation = simulation;
        if (simulationIndicatesFailure(simulation)) {
          throw new Error(`KeeperHub preflight rejected ${definition.name}; every matching workflow remains disabled.`);
        }
        await client.updateWorkflow(canonical.id, { enabled: true });

        const reconciledCopies = findWorkflowsByRegistrationKey(await client.listWorkflows(), definition);
        const reconciledCanonical = selectCanonicalWorkflow(reconciledCopies) ?? canonical;
        for (const duplicate of reconciledCopies) {
          if (duplicate.id !== reconciledCanonical.id) await client.updateWorkflow(duplicate.id, { enabled: false });
        }
        if (reconciledCanonical.id !== canonical.id) {
          await client.updateWorkflow(canonical.id, { enabled: false });
          await client.updateWorkflow(reconciledCanonical.id, { ...definition, enabled: false });
          const reconciledSimulation = await client.simulateWorkflow(reconciledCanonical.id);
          if (simulationIndicatesFailure(reconciledSimulation)) {
            throw new Error(`KeeperHub preflight rejected ${definition.name}; every matching workflow remains disabled.`);
          }
          await client.updateWorkflow(reconciledCanonical.id, { enabled: true });
          finalSimulation = reconciledSimulation;
        }
        registered.push({ workflowId: reconciledCanonical.id, name: definition.name, simulation: finalSimulation });
      }
    });
    return Response.json({ configured: true, chain: selected, workflows: registered, retiredWorkflowIds }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "KeeperHub workflow registration failed",
        registered,
        retiredWorkflowIds,
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
