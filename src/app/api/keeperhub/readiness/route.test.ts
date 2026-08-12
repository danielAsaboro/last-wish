import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keeperHub = vi.hoisted(() => ({
  getChains: vi.fn(),
  listIntegrations: vi.fn(),
}));

vi.mock("@/lib/keeperhub/server", () => ({ keeperHubClientFromEnv: () => keeperHub }));

import { GET } from "./route";

describe("GET /api/keeperhub/readiness", () => {
  beforeEach(() => {
    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    vi.stubEnv("NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS", "0x1111111111111111111111111111111111111111");
    keeperHub.getChains.mockReset();
    keeperHub.listIntegrations.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports ready only when the requested enabled testnet and safe Web3 wallet summary are observed", async () => {
    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }]);
    keeperHub.listIntegrations.mockResolvedValue([{ id: "web3_org", name: "Organization wallet", type: "web3", address: "0x2222222222222222222222222222222222222222", isManaged: true }]);

    const response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      nextStep: "The selected network and organization wallet are available. Review and sign registration when you are ready.",
    });
  });

  it("returns factual unconfigured, unsupported-chain, wallet-missing, and unavailable preflight states without credentials", async () => {
    vi.stubEnv("KEEPERHUB_API_KEY", "");
    let response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toEqual({
      status: "unconfigured",
      nextStep: "Configure the server-side KeeperHub API key and trusted LastWish factory address, then refresh readiness.",
    });

    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: false, isTestnet: true }]);
    response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toMatchObject({ status: "chain_unsupported" });

    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }]);
    keeperHub.listIntegrations.mockResolvedValue([{ id: "rpc", name: "RPC", type: "rpc", address: null }]);
    response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toMatchObject({ status: "wallet_integration_missing" });

    keeperHub.listIntegrations.mockRejectedValue(new Error("Upstream unavailable"));
    response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toEqual({
      status: "preflight_unavailable",
      nextStep: "KeeperHub readiness could not be checked. Inspect KeeperHub availability and refresh; do not sign until it is ready.",
    });
  });
});
