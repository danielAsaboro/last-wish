import { isAddress } from "viem";
import { z } from "zod";

import { readinessNextSteps, type KeeperHubReadiness } from "@/lib/keeperhub/readiness";
import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";

const chainIdSchema = z.union([z.literal(84532), z.literal(11155111)]);

export async function GET(request: Request) {
  const chainId = chainIdSchema.safeParse(Number(new URL(request.url).searchParams.get("chainId")));
  if (!chainId.success) {
    return Response.json({ error: "A supported requested chainId is required." }, { status: 400 });
  }

  if (!process.env.KEEPERHUB_API_KEY || !isAddress(process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS ?? "")) {
    return readinessResponse("unconfigured");
  }

  try {
    const keeperHub = keeperHubClientFromEnv();
    const chains = await keeperHub.getChains();
    const selectedChain = chains.find((chain) => chain.chainId === chainId.data && chain.isEnabled && chain.isTestnet);
    if (!selectedChain) return readinessResponse("chain_unsupported");

    const integrations = await keeperHub.listIntegrations();
    const web3Wallet = integrations.find((integration) => integration.type === "web3" && isAddress(integration.address ?? ""));
    if (!web3Wallet) return readinessResponse("wallet_integration_missing");

    return readinessResponse("ready");
  } catch {
    return readinessResponse("preflight_unavailable");
  }
}

function readinessResponse(status: Exclude<KeeperHubReadiness["status"], "checking">) {
  return Response.json({ status, nextStep: readinessNextSteps[status] });
}
