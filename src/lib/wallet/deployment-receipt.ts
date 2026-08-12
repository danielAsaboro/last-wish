import type { Address } from "viem";

export function selectCreatedVault(
  events: Array<{ address: Address; args: { owner?: Address; vault?: Address } }>,
  trustedFactory: Address,
  expectedOwner: Address,
): Address | undefined {
  return events.find((event) =>
    event.address.toLowerCase() === trustedFactory.toLowerCase() &&
    event.args.owner?.toLowerCase() === expectedOwner.toLowerCase() &&
    event.args.vault,
  )?.args.vault;
}
