import { createPublicClient, http, isAddress, zeroAddress } from "viem";
import { z } from "zod";

import { readinessNextSteps, type KeeperHubReadiness } from "@/lib/keeperhub/readiness";
import { baseSepolia, sepolia } from "@/lib/chains";
import { factoryAbi } from "@/lib/contracts/abi";
import { selectRequestedExecutionChain } from "@/lib/keeperhub/client";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";

const chainIdSchema = z.union([z.literal(84532), z.literal(11155111)]);

export async function GET(request: Request) {
  const chainId = chainIdSchema.safeParse(Number(new URL(request.url).searchParams.get("chainId")));
  if (!chainId.success) {
    return Response.json({ error: "A supported requested chainId is required." }, { status: 400 });
  }

  const configuredFactory = process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
  const rpcUrl = chainId.data === baseSepolia.id ? process.env.BASE_SEPOLIA_RPC_URL : process.env.SEPOLIA_RPC_URL;
  if (!process.env.KEEPERHUB_API_KEY || !configuredFactory || !isAddress(configuredFactory) || configuredFactory.toLowerCase() === zeroAddress || !rpcUrl) {
    return readinessResponse("unconfigured");
  }

  try {
    const keeperHub = keeperHubClientFromEnv();
    const chains = await keeperHub.getChains();
    try {
      selectRequestedExecutionChain(chains, chainId.data);
    } catch {
      return readinessResponse("chain_unsupported");
    }

    const integrations = await keeperHub.listIntegrations();
    const web3Wallet = integrations.find((integration) => integration.type === "web3" && isAddress(integration.address ?? ""));
    if (!web3Wallet) return readinessResponse("wallet_integration_missing");

    const rpc = createPublicClient({ chain: chainId.data === baseSepolia.id ? baseSepolia : sepolia, transport: http(rpcUrl) });
    const factory = configuredFactory as `0x${string}`;
    const bytecode = await rpc.getCode({ address: factory });
    if (!bytecode || bytecode === "0x") throw new Error("The configured factory has no deployed bytecode.");
    await rpc.readContract({ address: factory, abi: factoryAbi, functionName: "vaultOf", args: [zeroAddress] });

    return readinessResponse("ready");
  } catch {
    return readinessResponse("preflight_unavailable");
  }
}

function readinessResponse(status: Exclude<KeeperHubReadiness["status"], "checking">) {
  return Response.json({ status, nextStep: readinessNextSteps[status] });
}
