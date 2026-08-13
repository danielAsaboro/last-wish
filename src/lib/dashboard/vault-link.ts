import { getAddress, isAddress, type Address } from "viem";

export type VaultLinkRead =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "valid"; address: Address };

export function readVaultLinkFromUrl(input: string): VaultLinkRead {
  try {
    const url = new URL(input);
    if (!url.searchParams.has("vault")) return { state: "absent" };
    const value = url.searchParams.get("vault");
    return value && isAddress(value)
      ? { state: "valid", address: getAddress(value) }
      : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

export function readVaultAddressFromUrl(input: string): Address | undefined {
  const result = readVaultLinkFromUrl(input);
  return result.state === "valid" ? result.address : undefined;
}

export function buildVaultInspectionUrl(currentUrl: string, vault: Address): string {
  const url = new URL(currentUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("vault", getAddress(vault));
  return url.toString();
}

export function replaceVaultInUrl(
  currentUrl: string,
  vault: Address,
  history: Pick<History, "state" | "replaceState">,
) {
  const url = new URL(buildVaultInspectionUrl(currentUrl, vault));
  history.replaceState(history.state, "", `${url.pathname}${url.search}`);
}
