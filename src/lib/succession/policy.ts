import type { Address, PolicyValidation, SuccessionPolicy } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MINIMUM_TIMING_SECONDS = 60 * 60;

export function validatePolicy(policy: SuccessionPolicy): PolicyValidation {
  const errors: string[] = [];
  const addresses = policy.beneficiaries.map(({ address }) => address.toLowerCase());
  const shareTotal = policy.beneficiaries.reduce(
    (total, beneficiary) => total + beneficiary.shareBps,
    0,
  );

  if (shareTotal !== 10_000) {
    errors.push("Beneficiary shares must total exactly 10,000 basis points.");
  }

  if (addresses.some((address) => address === ZERO_ADDRESS)) {
    errors.push("Beneficiary addresses cannot be the zero address.");
  }

  if (new Set(addresses).size !== addresses.length) {
    errors.push("Beneficiary addresses must be unique.");
  }

  if (policy.heartbeatIntervalSeconds < MINIMUM_TIMING_SECONDS) {
    errors.push("Heartbeat interval must be at least one hour.");
  }

  if (policy.gracePeriodSeconds < MINIMUM_TIMING_SECONDS) {
    errors.push("Grace period must be at least one hour.");
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export function policyHashInput(policy: SuccessionPolicy) {
  return {
    owner: normalizeAddress(policy.owner),
    guardian: normalizeAddress(policy.guardian),
    beneficiaries: policy.beneficiaries.map(({ address, shareBps }) => ({
      address: normalizeAddress(address),
      shareBps,
    })),
    heartbeatIntervalSeconds: policy.heartbeatIntervalSeconds,
    gracePeriodSeconds: policy.gracePeriodSeconds,
    version: policy.version,
  };
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase() as Address;
}
