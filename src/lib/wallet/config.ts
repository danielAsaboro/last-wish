import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";

import { baseSepolia, sepolia } from "@/lib/chains";

export const supportedChains = [baseSepolia, sepolia] as const;
export const preferredChain = Number(process.env.NEXT_PUBLIC_CHAIN_ID) === sepolia.id ? sepolia : baseSepolia;

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: [injected()],
  ssr: true,
  transports: {
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
  },
});
