export type Address = `0x${string}`;

export type Beneficiary = {
  address: Address;
  label: string;
  shareBps: number;
};

export type SuccessionPolicy = {
  owner: Address;
  guardian: Address;
  beneficiaries: Beneficiary[];
  heartbeatIntervalSeconds: number;
  gracePeriodSeconds: number;
  version: number;
};

export type PolicyValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] };
