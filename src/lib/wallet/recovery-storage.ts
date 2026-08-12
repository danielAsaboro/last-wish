import { isAddress, isHash, type Address, type Hash } from "viem";

import { parseBeneficiaryLabels, type BeneficiaryLabels } from "@/lib/succession/labels";

export const walletRecoveryActions = ["heartbeat", "veto", "claim", "fund", "withdraw", "update-policy", "deploy"] as const;
export type StoredWalletRecoveryAction = typeof walletRecoveryActions[number];

export type StoredWalletRecovery = {
  chainId: number;
  action: StoredWalletRecoveryAction;
  label: string;
  target: Address;
  transactionHash: Hash;
  actor?: Address;
  labels?: BeneficiaryLabels;
};

export function parseStoredWalletRecovery(raw: string | null, expectedChainId: number): StoredWalletRecovery | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.chainId !== expectedChainId || !walletRecoveryActions.includes(value.action as StoredWalletRecoveryAction)) return undefined;
    if (typeof value.label !== "string" || value.label.length < 1 || value.label.length > 80) return undefined;
    if (typeof value.target !== "string" || !isAddress(value.target) || typeof value.transactionHash !== "string" || !isHash(value.transactionHash)) return undefined;
    if (value.actor !== undefined && (typeof value.actor !== "string" || !isAddress(value.actor))) return undefined;
    const labels = value.labels === undefined ? undefined : parseBeneficiaryLabels(JSON.stringify(value.labels));
    return {
      chainId: expectedChainId,
      action: value.action as StoredWalletRecoveryAction,
      label: value.label,
      target: value.target,
      transactionHash: value.transactionHash,
      ...(value.actor ? { actor: value.actor as Address } : {}),
      ...(labels && Object.keys(labels).length > 0 ? { labels } : {}),
    };
  } catch {
    return undefined;
  }
}
