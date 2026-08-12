import { z } from "zod";
import { createPublicClient, getAddress, http, verifyMessage } from "viem";

import { baseSepolia, sepolia } from "@/lib/chains";
import { factoryAbi, vaultAbi } from "@/lib/contracts/abi";
import { buildWorkflowAuthorizationMessage, validateWorkflowAuthorizationWindow, withWorkflowRegistrationLock } from "@/lib/keeperhub/authorization";
import { selectRequestedExecutionChain } from "@/lib/keeperhub/client";
import { registerVaultWorkflowPair } from "@/lib/keeperhub/registration";
import { publicWorkflowRegistrationFailure } from "@/lib/keeperhub/registration-response";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { buildVaultWorkflows, parseWorkflowRegistrationKey } from "@/lib/keeperhub/workflow";

const scheduleCron = "*/5 * * * *";
const requestSchema = z.object({
  chainId: z.union([z.literal(84532), z.literal(11155111)]),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  scheduleCron: z.literal(scheduleCron),
  policyVersion: z.coerce.bigint().positive(),
  expiresAt: z.number().int().positive(),
  signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid KeeperHub workflow request", issues: parsed.error.issues }, { status: 400 });
  if (!process.env.KEEPERHUB_API_KEY) {
    return Response.json({ configured: false, error: "KeeperHub automation is unavailable because KEEPERHUB_API_KEY is not configured." }, { status: 503 });
  }
  const configuredFactory = process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
  if (!configuredFactory || !/^0x[a-fA-F0-9]{40}$/.test(configuredFactory)) {
    return Response.json({ configured: false, error: "KeeperHub registration requires a configured trusted LastWish factory." }, { status: 503 });
  }

  const client = keeperHubClientFromEnv();
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

    let selected;
    try {
      selected = selectRequestedExecutionChain(await client.getChains(), parsed.data.chainId);
    } catch {
      return Response.json({ error: "The requested wallet chain is not an enabled supported KeeperHub testnet." }, { status: 409 });
    }

    const definitions = buildVaultWorkflows({ ...parsed.data, vault });
    const lockKey = `${parsed.data.chainId}:${vault.toLowerCase()}:${policyVersion}`;
    const result = await withWorkflowRegistrationLock(lockKey, () => registerVaultWorkflowPair(client, {
      chainId: parsed.data.chainId,
      vault,
      definitions,
      readPolicyGuard: async (definition) => {
        const registration = parseWorkflowRegistrationKey(definition.description);
        if (!registration) throw new Error("LastWish could not resolve the canonical workflow registration key.");
        return rpc.readContract({
          address: vault,
          abi: vaultAbi,
          functionName: registration.action === "open" ? "canOpenSettlementForPolicy" : "canFinalizeSettlementForPolicy",
          args: [policyVersion],
        });
      },
    }));
    return Response.json({ configured: true, chain: selected, ...result }, { status: 201 });
  } catch (error) {
    return Response.json({
      configured: true,
      ...publicWorkflowRegistrationFailure(error),
    }, { status: 502 });
  }
}
