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

export type VaultStatus =
  | "ACTIVE"
  | "PENDING"
  | "VETOED"
  | "READY"
  | "SETTLED"
  | "RECOVERY_REQUIRED";

export type VaultSnapshot = {
  address: Address;
  owner: Address;
  guardian: Address;
  beneficiaries: Beneficiary[];
  balanceWei: bigint;
  policyVersion: bigint;
  lastHeartbeat: bigint;
  heartbeatInterval: bigint;
  gracePeriod: bigint;
  pendingAt: bigint;
  vetoed: boolean;
  settled: boolean;
  status: VaultStatus;
};

export type KeeperHubEvidence = {
  workflowId: string;
  executionId: string;
  status: "pending" | "running" | "verified" | "failed" | "unknown";
  transactionHash?: Address;
  transactionLink?: string;
  verified: boolean;
  receiptStatus?: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
  observedVaultStatus?: VaultStatus;
  outcome?: "TRANSACTION" | "NO_WRITE";
};
