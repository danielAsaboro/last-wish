import { keeperHubClientFromEnv } from "@/lib/keeperhub/server";
import { selectExecutionChain } from "@/lib/keeperhub/client";

export async function GET() {
  if (!process.env.KEEPERHUB_API_KEY) {
    return Response.json({ configured: false, chains: [] }, { status: 503 });
  }
  try {
    const chains = await keeperHubClientFromEnv().getChains();
    return Response.json({ configured: true, chains, selected: selectExecutionChain(chains) });
  } catch (error) {
    return Response.json(
      { configured: true, error: error instanceof Error ? error.message : "KeeperHub chain preflight failed" },
      { status: 502 },
    );
  }
}
