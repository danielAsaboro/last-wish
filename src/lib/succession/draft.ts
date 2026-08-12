import { getAddress, isAddress } from "viem";

import type { Address } from "./types";

export type PolicyDraft = {
  owner: string;
  guardian: string;
  beneficiaries: Array<{ label: string; address: string; shareBps: number }>;
  heartbeatDays: number;
  graceDays: number;
  testnetDemo: boolean;
};

export function buildPolicyArguments(draft: PolicyDraft) {
  if (!isAddress(draft.owner) || !isAddress(draft.guardian)) {
    throw new Error("Owner and guardian must be valid EVM addresses.");
  }
  if (draft.owner.toLowerCase() === draft.guardian.toLowerCase()) {
    throw new Error("Guardian must be different from the owner.");
  }
  if (draft.beneficiaries.length === 0) throw new Error("Add at least one beneficiary.");
  const addresses = draft.beneficiaries.map((beneficiary) => {
    if (!isAddress(beneficiary.address)) throw new Error(`${beneficiary.label || "Beneficiary"} needs a valid EVM address.`);
    return getAddress(beneficiary.address) as Address;
  });
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error("Beneficiary addresses must be unique.");
  }
  const shares = draft.beneficiaries.map((beneficiary) => beneficiary.shareBps);
  if (shares.some((share) => !Number.isInteger(share) || share <= 0) || shares.reduce((sum, share) => sum + share, 0) !== 10_000) {
    throw new Error("Beneficiary shares must be positive integers totaling exactly 10,000 basis points.");
  }
  if (!Number.isInteger(draft.heartbeatDays) || draft.heartbeatDays < 1 || !Number.isInteger(draft.graceDays) || draft.graceDays < 1) {
    throw new Error("Heartbeat and grace periods must each be at least one day in the dashboard.");
  }

  return {
    guardian: getAddress(draft.guardian) as Address,
    beneficiaryAddresses: addresses,
    shares,
    heartbeatSeconds: BigInt(draft.heartbeatDays * 86_400),
    graceSeconds: BigInt(draft.graceDays * 86_400),
    testnetDemo: draft.testnetDemo,
  };
}
