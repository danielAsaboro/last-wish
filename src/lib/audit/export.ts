import type { DiscoveredWorkflowRegistration } from "@/lib/keeperhub/evidence";
import type { Address, KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";

import type { ChainAuditEvent } from "./timeline";
import { deriveEvidenceCompleteness } from "./completeness";

type AuditCoverage =
  | { state: "idle" }
  | { state: "indexing"; targetBlock: bigint; lastCompleteBlock?: bigint }
  | { state: "fresh"; indexedThroughBlock: bigint }
  | { state: "stale"; targetBlock: bigint; lastCompleteBlock?: bigint };

type ExportVault = {
  address: Address;
  owner: Address;
  guardian: Address;
  status: VaultStatus;
  balanceWei: bigint;
  policyVersion: bigint;
  heartbeatInterval: bigint;
  gracePeriod: bigint;
  lastHeartbeat: bigint;
  pendingAt: bigint;
  observedAt: bigint;
  observedBlockNumber: bigint;
  deployedAtBlock?: bigint;
  provenance: { kind: "factory_verified"; factory: Address; verifiedAtBlock: bigint };
  beneficiaries: Array<{ address: Address; label: string; shareBps: number; claimableWei: bigint }>;
};

export type AuditExportInput = {
  chain: { id: number; name: string };
  vault: ExportVault;
  chainEvents: ChainAuditEvent[];
  auditIndexCoverage: AuditCoverage;
  keeperHub: {
    scope: "recent_keeperhub_window_only";
    reconciliation: {
      refreshState: "checking" | "refreshing" | "fresh" | "stale";
      currentVaultEvidence: "unknown" | "refreshing" | "fresh" | "stale_with_success";
      automationState: "healthy" | "recovery_required";
    };
    workflows: DiscoveredWorkflowRegistration[];
    evidence: KeeperHubEvidence[];
  };
  walletRecovery?: { action: string; label: string; target: Address; transactionHash: Address };
};

export function buildAuditExportManifest(input: AuditExportInput, generatedAt: string) {
  const walletRecovery = input.walletRecovery?.target.toLowerCase() === input.vault.address.toLowerCase()
    ? {
        scope: "exported_vault" as const,
        action: input.walletRecovery.action,
        label: input.walletRecovery.label,
        target: input.walletRecovery.target,
        transactionHash: input.walletRecovery.transactionHash,
      }
    : undefined;
  const evidenceCompleteness = deriveEvidenceCompleteness({
    provenanceVerified: input.vault.provenance.kind === "factory_verified",
    auditCoverage: input.auditIndexCoverage,
    refreshState: input.keeperHub.reconciliation.refreshState,
    currentVaultEvidence: input.keeperHub.reconciliation.currentVaultEvidence,
    automationState: input.keeperHub.reconciliation.automationState,
    keeperHubEvidence: input.keeperHub.evidence,
    workflows: input.keeperHub.workflows,
    walletRecovery,
  });
  return {
    schema: "lastwish.audit.v1" as const,
    generatedAt,
    generatedAtSource: "client_clock" as const,
    environment: "testnet" as const,
    notice: "Point-in-time testnet evidence. Verify transaction receipts and current contract state independently before relying on this file.",
    evidenceCompleteness,
    chain: input.chain,
    vault: {
      address: input.vault.address,
      owner: input.vault.owner,
      guardian: input.vault.guardian,
      status: input.vault.status,
      balanceWei: decimal(input.vault.balanceWei),
      policyVersion: decimal(input.vault.policyVersion),
      heartbeatInterval: decimal(input.vault.heartbeatInterval),
      gracePeriod: decimal(input.vault.gracePeriod),
      lastHeartbeat: decimal(input.vault.lastHeartbeat),
      pendingAt: decimal(input.vault.pendingAt),
      observedAt: decimal(input.vault.observedAt),
      observedBlockNumber: decimal(input.vault.observedBlockNumber),
      deployedAtBlock: optionalDecimal(input.vault.deployedAtBlock),
      provenance: {
        ...input.vault.provenance,
        verifiedAtBlock: decimal(input.vault.provenance.verifiedAtBlock),
      },
      beneficiaries: input.vault.beneficiaries.map((beneficiary) => ({
        address: beneficiary.address,
        displayLabel: beneficiary.label,
        displayLabelSource: "local_display_metadata" as const,
        shareBps: beneficiary.shareBps,
        claimableWei: decimal(beneficiary.claimableWei),
      })),
    },
    chainEvidence: {
      coverage: stringifyCoverage(input.auditIndexCoverage),
      events: input.chainEvents.map((event) => ({
        ...event,
        timestamp: decimal(event.timestamp),
        blockNumber: decimal(event.blockNumber),
        amountWei: optionalDecimal(event.amountWei),
        policyVersion: optionalDecimal(event.policyVersion),
        heartbeatInterval: optionalDecimal(event.heartbeatInterval),
        gracePeriod: optionalDecimal(event.gracePeriod),
      })),
    },
    keeperHubEvidence: {
      scope: input.keeperHub.scope,
      reconciliation: input.keeperHub.reconciliation,
      coverageNotice: "The KeeperHub API exposes only the latest 50 non-purged runs per workflow and does not provide pagination.",
      workflows: input.keeperHub.workflows,
      runs: input.keeperHub.evidence.map((evidence) => ({
        ...evidence,
        blockNumber: optionalDecimal(evidence.blockNumber),
        gasUsed: optionalDecimal(evidence.gasUsed),
        timestamp: optionalDecimal(evidence.timestamp),
        policyVersion: optionalDecimal(evidence.policyVersion),
      })),
    },
    walletRecovery,
  };
}

export function serializeAuditExport(manifest: ReturnType<typeof buildAuditExportManifest>) {
  return JSON.stringify(manifest, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
}

export function downloadAuditExport(manifest: ReturnType<typeof buildAuditExportManifest>) {
  const blob = new Blob([serializeAuditExport(manifest)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = auditExportFilename(manifest.chain.id, manifest.vault.address, manifest.generatedAt);
  link.click();
  URL.revokeObjectURL(url);
}

function auditExportFilename(chainId: number, vault: Address, generatedAt: string) {
  const timestamp = generatedAt.replaceAll(":", "-");
  return `lastwish-audit-${chainId}-${vault}-${timestamp}.json`;
}

function stringifyCoverage(coverage: AuditCoverage) {
  if (coverage.state === "idle") return coverage;
  if (coverage.state === "fresh") return { ...coverage, indexedThroughBlock: decimal(coverage.indexedThroughBlock) };
  return {
    ...coverage,
    targetBlock: decimal(coverage.targetBlock),
    lastCompleteBlock: optionalDecimal(coverage.lastCompleteBlock),
  };
}

function decimal(value: bigint) {
  return value.toString();
}

function optionalDecimal(value: bigint | undefined) {
  return value?.toString();
}
