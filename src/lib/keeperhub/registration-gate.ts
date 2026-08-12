import type { AutomationHealth } from "./evidence";
import type { KeeperHubReadinessStatus } from "./readiness";

export type CurrentVaultEvidence = "unknown" | "refreshing" | "fresh" | "stale_with_success";

export function canAuthorizeKeeperHubRegistration(input: {
  activeOwner: boolean;
  vaultSnapshotMatches: boolean;
  readiness: KeeperHubReadinessStatus;
  currentVaultEvidence: CurrentVaultEvidence;
  automation: AutomationHealth["state"];
}): boolean {
  return input.activeOwner && input.vaultSnapshotMatches && input.readiness === "ready" && input.currentVaultEvidence === "fresh" && input.automation !== "healthy";
}

export async function requestKeeperHubRegistrationSignature<T>(
  input: Parameters<typeof canAuthorizeKeeperHubRegistration>[0],
  signMessage: () => Promise<T>,
): Promise<T | undefined> {
  return canAuthorizeKeeperHubRegistration(input) ? signMessage() : undefined;
}
