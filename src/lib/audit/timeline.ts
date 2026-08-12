import { formatEther } from "viem";

import type { Address, KeeperHubEvidence } from "@/lib/succession/types";

export type ChainAuditEvent = {
  id: string;
  type: "PolicyUpdated" | "Heartbeat" | "SettlementOpened" | "SettlementVetoed" | "SettlementFinalized" | "Claimed" | "Withdrawal" | "Deposit";
  timestamp: bigint;
  blockNumber: bigint;
  transactionHash: Address;
  actor?: Address;
  amountWei?: bigint;
  policyVersion?: bigint;
};

export type AuditTimelineItem = {
  id: string;
  source: "chain" | "keeperhub";
  title: string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger";
  timestamp?: bigint;
  transactionHash?: Address;
  workflowId?: string;
  executionId?: string;
  action?: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
};

const chainTitles: Record<ChainAuditEvent["type"], string> = {
  PolicyUpdated: "Policy updated",
  Heartbeat: "Owner heartbeat recorded",
  SettlementOpened: "Grace period opened",
  SettlementVetoed: "Guardian veto recorded",
  SettlementFinalized: "Beneficiary claims finalized",
  Claimed: "Beneficiary allocation claimed",
  Withdrawal: "Owner withdrawal recorded",
  Deposit: "Vault funded",
};

export function buildAuditTimeline(input: {
  chainEvents: ChainAuditEvent[];
  keeperHub: KeeperHubEvidence[];
}): AuditTimelineItem[] {
  const chainItems = input.chainEvents.map<AuditTimelineItem>((event) => ({
      id: event.id,
      source: "chain",
      title: chainTitles[event.type],
      detail: chainEventDetail(event),
      tone: event.type === "SettlementVetoed" ? "warning" : "neutral",
      timestamp: event.timestamp,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
    }));

  const keeperItems = input.keeperHub.map<AuditTimelineItem>((evidence) => {
    if (evidence.outcome === "NO_WRITE" && evidence.status === "verified") {
      return {
        id: `keeperhub-${evidence.executionId}`,
        source: "keeperhub",
        title: "Eligibility check completed",
        detail: `KeeperHub completed the workflow without an onchain write; the vault remained ${evidence.observedVaultStatus ?? "unchanged"}.`,
        tone: "neutral",
        workflowId: evidence.workflowId,
        executionId: evidence.executionId,
        timestamp: evidence.timestamp,
      };
    }
    if (evidence.status === "unknown" || evidence.observedVaultStatus === "RECOVERY_REQUIRED") {
      return {
        id: `keeperhub-${evidence.executionId}`,
        source: "keeperhub",
        title: "Execution needs reconciliation",
        detail: `KeeperHub receipt status: ${evidence.receiptStatus ?? "not reported"}. This outcome is not safe to retry automatically.`,
        tone: "danger",
        workflowId: evidence.workflowId,
        executionId: evidence.executionId,
        transactionHash: evidence.transactionHash,
        action: "Inspect the existing execution and transaction before attempting another write.",
        timestamp: evidence.timestamp,
        blockNumber: evidence.blockNumber,
        gasUsed: evidence.gasUsed,
      };
    }
    if (evidence.verified) {
      return {
        id: `keeperhub-${evidence.executionId}`,
        source: "keeperhub",
        title: "KeeperHub execution verified",
        detail: `Receipt succeeded and independent RPC state resolved to ${evidence.observedVaultStatus}.`,
        tone: "success",
        workflowId: evidence.workflowId,
        executionId: evidence.executionId,
        transactionHash: evidence.transactionHash,
        timestamp: evidence.timestamp,
        blockNumber: evidence.blockNumber,
        gasUsed: evidence.gasUsed,
      };
    }
    return {
      id: `keeperhub-${evidence.executionId}`,
      source: "keeperhub",
      title: evidence.status === "failed" ? "KeeperHub execution failed" : "KeeperHub execution in progress",
      detail: `Execution status: ${evidence.status}.`,
      tone: evidence.status === "failed" ? "danger" : "warning",
      workflowId: evidence.workflowId,
      executionId: evidence.executionId,
      transactionHash: evidence.transactionHash,
      timestamp: evidence.timestamp,
      blockNumber: evidence.blockNumber,
      gasUsed: evidence.gasUsed,
    };
  });

  return [...chainItems, ...keeperItems].sort((left, right) => {
    if (left.timestamp === undefined) return 1;
    if (right.timestamp === undefined) return -1;
    return Number(right.timestamp - left.timestamp);
  });
}

function chainEventDetail(event: ChainAuditEvent): string {
  const parts = [
    event.amountWei === undefined ? undefined : `${formatEther(event.amountWei)} ETH`,
    `confirmed in block ${event.blockNumber}`,
    event.actor ? `actor ${shorten(event.actor)}` : undefined,
  ].filter((part): part is string => part !== undefined);
  const detail = parts.join(" · ");
  return `${event.amountWei === undefined ? detail[0]?.toUpperCase() + detail.slice(1) : detail}.`;
}

function shorten(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
