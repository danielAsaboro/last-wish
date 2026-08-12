import type { Address } from "viem";

import { vaultAbi } from "@/lib/contracts/abi";
import type { VaultStatus } from "@/lib/succession/types";

type StatusReader = {
  readContract(args: {
    address: Address;
    abi: typeof vaultAbi;
    functionName: "status";
    blockNumber: bigint;
  }): Promise<unknown>;
};

const statusNames: VaultStatus[] = ["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED"];

export async function readVaultStatusAtBlock(
  client: StatusReader,
  vault: Address,
  blockNumber: bigint,
): Promise<VaultStatus> {
  const status = await client.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "status",
    blockNumber,
  });
  return statusNames[Number(status)] ?? "RECOVERY_REQUIRED";
}
