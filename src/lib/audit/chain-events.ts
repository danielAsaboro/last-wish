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

const actorKeys = ["sender", "owner", "caller", "guardian", "recipient", "beneficiary"] as const;

export function buildChainAuditEvents(logs: RawVaultLog[], blockTimestamps: Map<bigint, bigint>): ChainAuditEvent[] {
  return logs.flatMap((log, index) => {
    const type = log.eventName ? eventTypes[log.eventName] : undefined;
    if (!type || log.blockNumber === null || log.blockNumber === undefined || !log.transactionHash) return [];
    const timestamp = blockTimestamps.get(log.blockNumber);
    if (timestamp === undefined) return [];
    const args = log.args ?? {};
    const actor = actorKeys.map((key) => args[key]).find(isAddressValue);
    return [{
      id: `${log.transactionHash}-${log.logIndex ?? index}`,
      type,
      timestamp,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      actor,
      amountWei: typeof args.amount === "bigint" ? args.amount : typeof args.balance === "bigint" ? args.balance : undefined,
      policyVersion: typeof args.policyVersion === "bigint" ? args.policyVersion : undefined,
    }];
  });
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}
