import type { Address } from "viem";

import type { AutomationHealth } from "./evidence";
import type { KeeperHubReadinessStatus } from "./readiness";

export type CurrentVaultEvidence = "unknown" | "refreshing" | "fresh" | "stale_with_success";

export type RegistrationGateInput = {
  activeOwner: boolean;
  vaultSnapshotMatches: boolean;
  readiness: KeeperHubReadinessStatus;
  currentVaultEvidence: CurrentVaultEvidence;
  automation: AutomationHealth["state"];
};

export type RegistrationActionContext = RegistrationGateInput & {
  actionEpoch: number;
  account: Address;
  chainId: number;
  activeVault: Address;
  snapshotVault: Address;
  policyVersion: bigint;
  selectionEpoch: number;
  evidenceGeneration: number;
};

export function canAuthorizeKeeperHubRegistration(input: RegistrationGateInput): boolean {
  return input.activeOwner && input.vaultSnapshotMatches && input.readiness === "ready" && input.currentVaultEvidence === "fresh" && input.automation !== "healthy";
}

export async function requestKeeperHubRegistrationSignature<T>(
  input: RegistrationActionContext,
  getCurrent: () => RegistrationActionContext | undefined,
  signMessage: () => Promise<T>,
): Promise<T | undefined> {
  if (!canAuthorizeKeeperHubRegistration(input)) return undefined;
  const signature = await signMessage();
  return registrationActionStillCurrent(input, getCurrent()) ? signature : undefined;
}

export function registrationActionStillCurrent(
  initial: RegistrationActionContext,
  current: RegistrationActionContext | undefined,
): boolean {
  return Boolean(current &&
    canAuthorizeKeeperHubRegistration(current) &&
    initial.actionEpoch === current.actionEpoch &&
    initial.selectionEpoch === current.selectionEpoch &&
    initial.evidenceGeneration === current.evidenceGeneration &&
    initial.chainId === current.chainId &&
    initial.policyVersion === current.policyVersion &&
    same(initial.account, current.account) &&
    same(initial.activeVault, current.activeVault) &&
    same(initial.snapshotVault, current.snapshotVault));
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
