import type { Address } from "@/lib/succession/types";

import type { ChainAuditEvent } from "./timeline";

type RawVaultLog = {
  eventName?: string;
  blockNumber?: bigint | null;
  transactionHash?: Address | null;
  logIndex?: number | null;
  args?: Record<string, unknown>;
};

const eventTypes: Record<string, ChainAuditEvent["type"]> = {
  Deposit: "Deposit",
  Heartbeat: "Heartbeat",
  PolicyUpdated: "PolicyUpdated",
  SettlementOpened: "SettlementOpened",
  SettlementVetoedByGuardian: "SettlementVetoed",
  SettlementFinalized: "SettlementFinalized",
  Withdrawal: "Withdrawal",
  Claimed: "Claimed",
};

const actorKeyByEvent: Record<string, string> = {
  Deposit: "sender",
  Heartbeat: "owner",
  PolicyUpdated: "actor",
  SettlementOpened: "caller",
  SettlementVetoedByGuardian: "guardian",
  SettlementFinalized: "caller",
  Withdrawal: "actor",
  Claimed: "beneficiary",
};

export function buildChainAuditEvents(logs: RawVaultLog[], blockTimestamps: Map<bigint, bigint>): ChainAuditEvent[] {
  return logs.flatMap((log, index) => {
    const type = log.eventName ? eventTypes[log.eventName] : undefined;
    if (!type || log.blockNumber === null || log.blockNumber === undefined || !log.transactionHash) return [];
    const timestamp = blockTimestamps.get(log.blockNumber);
    if (timestamp === undefined) return [];
    const args = log.args ?? {};
    const actorValue = log.eventName ? args[actorKeyByEvent[log.eventName]] : undefined;
    const actor = isAddressValue(actorValue) ? actorValue : undefined;
    const policyTerms = log.eventName === "PolicyUpdated" ? readPolicyTerms(args) : undefined;
    return [{
      id: `${log.transactionHash}-${log.logIndex ?? index}`,
      type,
      timestamp,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      actor,
      amountWei: typeof args.amount === "bigint" ? args.amount : typeof args.balance === "bigint" ? args.balance : undefined,
      policyVersion: typeof args.policyVersion === "bigint" ? args.policyVersion : undefined,
      ...policyTerms,
    }];
  });
}

function readPolicyTerms(args: Record<string, unknown>): Pick<ChainAuditEvent, "guardian" | "heartbeatInterval" | "gracePeriod" | "allocations"> | undefined {
  const beneficiaries = Array.isArray(args.beneficiaries) ? args.beneficiaries : undefined;
  const shares = Array.isArray(args.shares) ? args.shares : undefined;
  const uniqueBeneficiaries = beneficiaries?.every(isAddressValue)
    ? new Set(beneficiaries.map((beneficiary) => beneficiary.toLowerCase()))
    : undefined;
  if (
    !isAddressValue(args.guardian) ||
    typeof args.heartbeatInterval !== "bigint" ||
    typeof args.gracePeriod !== "bigint" ||
    args.heartbeatInterval <= 0n ||
    args.gracePeriod <= 0n ||
    !beneficiaries ||
    !shares ||
    beneficiaries.length === 0 ||
    beneficiaries.length > 10 ||
    beneficiaries.length !== shares.length ||
    !uniqueBeneficiaries ||
    uniqueBeneficiaries.size !== beneficiaries.length ||
    uniqueBeneficiaries.has("0x0000000000000000000000000000000000000000") ||
    !shares.every((share) => typeof share === "number" && Number.isInteger(share) && share > 0) ||
    shares.reduce<number>((total, share) => total + (share as number), 0) !== 10_000
  ) return undefined;
  return {
    guardian: args.guardian,
    heartbeatInterval: args.heartbeatInterval,
    gracePeriod: args.gracePeriod,
    allocations: beneficiaries.map((beneficiary, index) => ({ beneficiary, shareBps: shares[index] as number })),
  };
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}
