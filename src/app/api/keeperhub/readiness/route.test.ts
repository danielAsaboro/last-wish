import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keeperHub = vi.hoisted(() => ({
  getChains: vi.fn(),
  listIntegrations: vi.fn(),
}));
const rpc = vi.hoisted(() => ({ getCode: vi.fn(), readContract: vi.fn() }));

vi.mock("@/lib/keeperhub/server", () => ({ keeperHubClientFromEnv: () => keeperHub }));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn(() => rpc) };
});

import { GET } from "./route";

describe("GET /api/keeperhub/readiness", () => {
  beforeEach(() => {
    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    vi.stubEnv("NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS", "0x1111111111111111111111111111111111111111");
    vi.stubEnv("BASE_SEPOLIA_RPC_URL", "https://rpc.example.test");
    keeperHub.getChains.mockReset();
    keeperHub.listIntegrations.mockReset();
    rpc.getCode.mockReset();
    rpc.readContract.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports ready only when the requested enabled testnet and safe Web3 wallet summary are observed", async () => {
    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }]);
    keeperHub.listIntegrations.mockResolvedValue([{ id: "web3_org", name: "Organization wallet", type: "web3", address: "0x2222222222222222222222222222222222222222", isManaged: true }]);
    rpc.getCode.mockResolvedValue("0x60016000");
    rpc.readContract.mockResolvedValue("0x0000000000000000000000000000000000000000");

    const response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      nextStep: "The selected network and organization wallet are available. Review and sign registration when you are ready.",
    });
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "vaultOf", args: ["0x0000000000000000000000000000000000000000"] }));
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

  it("requires a nonzero factory and chain-specific RPC configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS", "0x0000000000000000000000000000000000000000");
    let response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toMatchObject({ status: "unconfigured" });

    vi.stubEnv("NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS", "0x1111111111111111111111111111111111111111");
    vi.stubEnv("BASE_SEPOLIA_RPC_URL", "");
    response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toMatchObject({ status: "unconfigured" });
  });

  it("treats absent bytecode or an incompatible factory read as an unavailable preflight", async () => {
    keeperHub.getChains.mockResolvedValue([{ chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true }]);
    keeperHub.listIntegrations.mockResolvedValue([{ id: "web3_org", name: "Organization wallet", type: "web3", address: "0x2222222222222222222222222222222222222222" }]);
    rpc.getCode.mockResolvedValue("0x");
    let response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toMatchObject({ status: "preflight_unavailable" });

    rpc.getCode.mockResolvedValue("0x60016000");
    rpc.readContract.mockRejectedValue(new Error("missing vaultOf"));
    response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=84532"));
    await expect(response.json()).resolves.toMatchObject({ status: "preflight_unavailable" });
  });

  it("accepts a requested Sepolia chain when Base Sepolia is also enabled", async () => {
    vi.stubEnv("SEPOLIA_RPC_URL", "https://sepolia-rpc.example.test");
    keeperHub.getChains.mockResolvedValue([
      { chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true },
      { chainId: 11155111, name: "Sepolia", isEnabled: true, isTestnet: true },
    ]);
    keeperHub.listIntegrations.mockResolvedValue([{ id: "web3_org", name: "Organization wallet", type: "web3", address: "0x2222222222222222222222222222222222222222" }]);
    rpc.getCode.mockResolvedValue("0x60016000");
    rpc.readContract.mockResolvedValue("0x0000000000000000000000000000000000000000");

    const response = await GET(new Request("http://localhost/api/keeperhub/readiness?chainId=11155111"));
    await expect(response.json()).resolves.toMatchObject({ status: "ready" });
  });
});
