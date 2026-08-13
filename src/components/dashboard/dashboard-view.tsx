import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import type { AuditTimelineItem } from "@/lib/audit/timeline";
import type { VerificationStatus } from "@/lib/audit/completeness";
import type { AutomationHealth, DiscoveredWorkflowRegistration } from "@/lib/keeperhub/evidence";
import type { CurrentVaultEvidence } from "@/lib/keeperhub/registration-gate";
import type { KeeperHubReadiness } from "@/lib/keeperhub/readiness";
import type { LifecycleSummary } from "@/lib/succession/status";
import type { Address, VaultStatus } from "@/lib/succession/types";

export type DashboardRole = "owner" | "guardian" | "beneficiary" | "observer";
export type DashboardAction = "heartbeat" | "update-policy" | "withdraw" | "veto" | "claim" | "fund" | "register";
export type WalletTransactionProgress = { label: string; stage: "AWAITING_SIGNATURE" | "CONFIRMING"; target?: Address; transactionHash?: Address };
export type WalletTransactionRecovery = { label: string; target: Address; transactionHash: Address; reconciling: boolean };
export type AuditIndexCoverage =
  | { state: "idle" }
  | { state: "indexing"; targetBlock: bigint; lastCompleteBlock?: bigint }
  | { state: "fresh"; indexedThroughBlock: bigint }
  | { state: "stale"; targetBlock: bigint; lastCompleteBlock?: bigint };

export type DashboardViewProps = {
  connection: "disconnected" | "wrong-network" | "connected";
  account?: string;
  chainName: string;
  role: DashboardRole;
  status: VaultStatus;
  vaultAddress?: string;
  vaultResolution?: "empty" | "loading" | "ready" | "invalid" | "unavailable";
  vaultResolutionDetail?: string;
  balanceLabel: string;
  policyVersion: string;
  canRegisterAutomation: boolean;
  walletAvailability?: "checking" | "available" | "unavailable";
  readiness?: KeeperHubReadiness;
  evidenceRefresh?: { state: "checking" | "refreshing" | "fresh" | "stale"; detail?: string };
  currentVaultEvidence?: CurrentVaultEvidence;
  beneficiaries: Array<{ label: string; address: string; shareLabel: string; claimed: boolean }>;
  canClaim: boolean;
  auditItems: AuditTimelineItem[];
  auditIndexCoverage: AuditIndexCoverage;
  verificationStatus?: VerificationStatus;
  pendingAction: DashboardAction | null;
  message: { tone: "success" | "warning" | "danger"; text: string } | null;
  automation?: AutomationHealth;
  evidenceCoverage?: { scope: "recent_keeperhub_window_only"; workflows: DiscoveredWorkflowRegistration[] };
  lifecycle?: LifecycleSummary;
  transactionProgress?: WalletTransactionProgress;
  walletRecovery?: WalletTransactionRecovery;
  walletWritesBlocked?: boolean;
  onConnect(): void;
  onSwitchNetwork(): void;
  onRefreshEvidence?(): void;
  onRefreshReadiness?(): void;
  onReconcileWalletTransaction?(): void;
  onExportAudit?(): void;
  onCopyInspectionLink?(): void;
  onAction(action: DashboardAction): void;
  children?: React.ReactNode;
};

export function DashboardView(props: DashboardViewProps) {
  if (props.connection === "disconnected") {
    return (
      <DashboardFrame>
        <section className="connect-panel">
          <p className="eyebrow">Start with proof of control</p>
          <h1>Your wallet is your account.</h1>
          <p>Connect an injected EVM wallet to create or manage a vault. You can also inspect a known vault below without connecting. LastWish does not use passwords or hold keys.</p>
          {props.message && <div className={`notice ${props.message.tone}`} role="status">{props.message.text}</div>}
          {props.walletAvailability === "unavailable" ? <>
            <button className="button" disabled>Connect wallet</button>
            <p>No compatible injected EVM wallet was detected. Install one, then refresh this page.</p>
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install an EVM wallet ↗</a>
          </> : <button className="button" onClick={props.onConnect}>Connect wallet</button>}
          <ul className="trust-list"><li>No seed phrase requested</li><li>No transaction until you review it</li><li>Base Sepolia testnet</li></ul>
        </section>
        {props.children}
      </DashboardFrame>
    );
  }

  if (props.connection === "wrong-network" && !props.vaultAddress) {
    return (
      <DashboardFrame>
        <section className="connect-panel warning-panel">
          <p className="eyebrow">Network check</p>
          <h1>Switch networks before continuing.</h1>
          <p>Vault reads and wallet writes must refer to the same chain. This prevents an address on one network being mistaken for another.</p>
          <button className="button" onClick={props.onSwitchNetwork}>Switch to {props.chainName}</button>
        </section>
      </DashboardFrame>
    );
  }

  const vaultResolution = props.vaultResolution ?? (props.vaultAddress ? "ready" : "empty");
  const viewRole: DashboardRole = props.connection === "wrong-network" ? "observer" : props.role;

  return (
    <DashboardFrame>
      <header className="dashboard-titlebar">
        <div><p className="eyebrow">Vault command center</p><h1>Succession policy</h1></div>
        <div className="wallet-chip"><span className="live-dot" />{shorten(props.account)}<small>{viewRole} · {props.chainName}</small></div>
      </header>

      {props.connection === "wrong-network" ? <section className="observer-banner warning-panel">
        <div><p className="eyebrow">Wallet network mismatch</p><strong>Read-only inspection remains available.</strong><span>These vault reads come from {props.chainName}. Switch your wallet before any role-authorized action can appear.</span></div>
        <div className="observer-actions"><button type="button" onClick={props.onSwitchNetwork}>Switch to {props.chainName}</button></div>
      </section> : !props.account && <section className="observer-banner">
        <div><p className="eyebrow">Read-only inspection</p><strong>No wallet is connected.</strong><span>Vault state, contract events, and reconciled evidence remain available. Connect only when you need a role-authorized action.</span></div>
        <div className="observer-actions">
          <button type="button" disabled={props.walletAvailability === "unavailable"} onClick={props.onConnect}>Connect wallet to act</button>
          {props.walletAvailability === "unavailable" && <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install an EVM wallet ↗</a>}
        </div>
      </section>}

      {props.message && <div className={`notice ${props.message.tone}`} role="status">{props.message.text}</div>}
      {props.transactionProgress && <TransactionProgress progress={props.transactionProgress} chainName={props.chainName} />}
      {props.walletRecovery && <WalletRecoveryCard recovery={props.walletRecovery} chainName={props.chainName} onReconcile={props.onReconcileWalletTransaction} />}
      {props.children}

      {vaultResolution === "loading" && props.vaultAddress ? <VaultResolutionState
        title="Verifying vault provenance"
        detail={`Reading the contract and configured LastWish factory on ${props.chainName}. No transaction is available until verification succeeds.`}
        address={props.vaultAddress}
      /> : vaultResolution === "invalid" && props.vaultAddress ? <VaultResolutionState
        title="Vault could not be verified"
        detail="This address is not a factory-proven LastWish vault. No vault transaction is available."
        address={props.vaultAddress}
        error={props.vaultResolutionDetail}
      /> : vaultResolution === "unavailable" && props.vaultAddress ? <VaultResolutionState
        title="Vault verification is unavailable"
        detail="The selected address could not be verified against the chain and configured factory. Retry when chain access is restored."
        address={props.vaultAddress}
        error={props.vaultResolutionDetail}
      /> : vaultResolution === "ready" && props.vaultAddress ? (
        <>
          <section className="vault-overview">
            <div className="vault-state-card">
              <div className="card-head"><span>Current state</span><span className={`status-pill status-${props.status.toLowerCase()}`}>{props.status.replace("_", " ")}</span></div>
              <strong>{props.balanceLabel}</strong><small>Vault balance · read from {props.chainName}</small>
              <div className="address-line"><code>{shorten(props.vaultAddress, 10)}</code><span>Policy v{props.policyVersion}</span>{props.onCopyInspectionLink && <button type="button" onClick={props.onCopyInspectionLink}>Copy inspection link</button>}</div>
              {props.automation && <AutomationEvidence health={props.automation} readiness={props.readiness} coverage={props.evidenceCoverage} evidenceRefresh={props.evidenceRefresh} currentVaultEvidence={props.currentVaultEvidence} onRefreshEvidence={props.onRefreshEvidence} onRefreshReadiness={props.onRefreshReadiness} />}
            </div>
            <div className="quick-actions" aria-label="Available vault actions">
              {viewRole === "owner" && props.status === "ACTIVE" && <>
                <ActionButton action="heartbeat" label="Record heartbeat" {...props} />
                <ActionButton action="update-policy" label="Update policy" {...props} />
                {props.lifecycle?.phase !== "OPEN_ELIGIBLE" && <ActionButton action="withdraw" label="Withdraw" {...props} />}
                <ActionButton action="fund" label="Fund vault" {...props} />
              </>}
              {viewRole === "owner" && ["PENDING", "VETOED", "READY"].includes(props.status) && <ActionButton action="heartbeat" label="Reactivate vault" {...props} />}
              {viewRole === "guardian" && props.status === "PENDING" && <ActionButton action="veto" label="Veto settlement" {...props} />}
              {props.status === "READY" && <p className="completed-action">KeeperHub can finalize now · owner may still reactivate</p>}
              {viewRole === "beneficiary" && props.status === "SETTLED" && props.canClaim && <ActionButton action="claim" label="Claim allocation" {...props} />}
              {viewRole === "beneficiary" && props.status === "SETTLED" && !props.canClaim && <p className="completed-action">Allocation already claimed ✓</p>}
              {viewRole === "owner" && props.status !== "SETTLED" && props.canRegisterAutomation && props.readiness?.status === "ready" && <ActionButton action="register" label="Register KeeperHub" {...props} />}
            </div>
          </section>

          {props.lifecycle && <LifecycleCard lifecycle={props.lifecycle} />}

          <section className="dashboard-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Fixed allocation</p><h2>Beneficiaries</h2></div><span>{props.beneficiaries.length}</span></div>
              <div className="beneficiary-list">
                {props.beneficiaries.map((beneficiary) => <div key={beneficiary.address}>
                  <span className="avatar">{beneficiary.label.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{beneficiary.label}</strong><code>{shorten(beneficiary.address)}</code></div>
                  <b>{beneficiary.shareLabel}</b>
                </div>)}
              </div>
            </article>

            <article className="panel audit-panel">
              <div className="panel-heading"><div><p className="eyebrow">Evidence, not activity</p><h2>Audit trail</h2></div><div className="audit-heading-actions"><span>{props.auditItems.length}</span>{props.onExportAudit && <button type="button" onClick={props.onExportAudit}>Export audit JSON</button>}</div></div>
              {props.verificationStatus && <VerificationStatusCard verification={props.verificationStatus} />}
              <AuditCoverage coverage={props.auditIndexCoverage} />
              {props.auditItems.length === 0 ? <div className="empty-state"><span>◎</span><p>{auditEmptyCopy(props.auditIndexCoverage)}</p></div> :
                <ol className="audit-list">{props.auditItems.map((item) => <AuditTimelineRow key={item.id} item={item} chainName={props.chainName} />)}</ol>}
            </article>
          </section>
        </>
      ) : <section className="empty-vault"><p className="eyebrow">No vault loaded</p><h2>Create a policy or load an existing vault.</h2><p>Every value shown after loading comes from the connected chain.</p></section>}
    </DashboardFrame>
  );
}

function VerificationStatusCard({ verification }: { verification: VerificationStatus }) {
  const verified = verification.checks.filter((check) => check.status === "verified").length;
  const title = verification.status === "verified"
    ? "Verification status: all current checks verified"
    : verification.status === "recovery_required" ? "Verification status: reconciliation required" : "Verification status: checks incomplete";
  return <details className={`verification-status verification-${verification.status}`} open={verification.status === "recovery_required"}>
    <summary><span><strong>{title}</strong><small>{verified} of {verification.checks.length} current checks verified</small></span></summary>
    <ul>{verification.checks.map((check) => <li key={check.id} className={`check-${check.status}`}><span aria-hidden="true">{check.status === "verified" ? "✓" : check.status === "action_required" ? "!" : "·"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></li>)}</ul>
  </details>;
}

function AuditCoverage({ coverage }: { coverage: AuditIndexCoverage }) {
  if (coverage.state === "idle") {
    return <div className="audit-coverage coverage-idle"><span aria-hidden="true" /><div><strong>Chain history indexing is idle</strong><small>Waiting for a verified vault snapshot.</small></div></div>;
  }
  if (coverage.state === "indexing") {
    return <div className="audit-coverage coverage-indexing" aria-live="polite"><span aria-hidden="true" /><div>
      <strong>Indexing confirmed contract events through block {coverage.targetBlock.toString()}</strong>
      {coverage.lastCompleteBlock !== undefined && <small>Last complete through block {coverage.lastCompleteBlock.toString()}.</small>}
    </div></div>;
  }
  if (coverage.state === "fresh") {
    return <div className="audit-coverage coverage-fresh"><span aria-hidden="true" /><div><strong>Chain history indexed through block {coverage.indexedThroughBlock.toString()}</strong></div></div>;
  }
  return <div className="audit-coverage coverage-stale"><span aria-hidden="true" /><div>
    <strong>Chain history is stale</strong>
    <small>{coverage.lastCompleteBlock === undefined
      ? `Target block ${coverage.targetBlock.toString()}. No complete chain event range is available.`
      : `Last complete through block ${coverage.lastCompleteBlock.toString()}. Target block ${coverage.targetBlock.toString()}.`}</small>
  </div></div>;
}

function auditEmptyCopy(coverage: AuditIndexCoverage) {
  if (coverage.state === "indexing") return "Confirmed contract events will appear when the current indexing pass completes.";
  if (coverage.state === "stale" && coverage.lastCompleteBlock === undefined) return "No complete chain event range is available. KeeperHub evidence remains independently reconciled.";
  return "No indexed events yet. Confirmed contract events and KeeperHub receipts will appear here.";
}

function AuditTimelineRow({ item, chainName }: { item: AuditTimelineItem; chainName: string }) {
  const hasKeeperHubIdentity = item.source === "keeperhub" && (item.workflowId || item.executionId);
  const hasPolicyTerms = item.source === "chain" && item.guardian && item.heartbeatInterval !== undefined && item.gracePeriod !== undefined && item.allocations && item.allocations.length > 0;

  return <li className={`tone-${item.tone}`}><span /><div>
    <strong>{item.title}</strong>
    <p>{item.detail}</p>
    {item.action && <p className="audit-action">{item.action}</p>}
    <div className="audit-meta">
      <small>{item.source}</small>
      {item.timestamp !== undefined && <time dateTime={new Date(Number(item.timestamp) * 1000).toISOString()}>{formatTimestamp(item.timestamp)}</time>}
      {item.blockNumber !== undefined && <span>Block {item.blockNumber.toString()}</span>}
      {item.gasUsed !== undefined && <span>{item.gasUsed.toLocaleString("en-US")} gas</span>}
      {item.policyVersion !== undefined && <span>Policy v{item.policyVersion.toString()}</span>}
      {item.workflowAction && <span>{workflowActionLabel(item.workflowAction)}</span>}
      {item.workflowId && <code>{shortenIdentifier(item.workflowId)}</code>}
      {item.executionId && <code>{shortenIdentifier(item.executionId)}</code>}
    </div>
    {hasKeeperHubIdentity && <details className="evidence-inspector">
      <summary>Inspect KeeperHub evidence</summary>
      <dl className="evidence-inspector-ledger">
        {item.workflowId && <div><dt>Workflow ID</dt><dd><code>{item.workflowId}</code></dd></div>}
        {item.executionId && <div><dt>Execution ID</dt><dd><code>{item.executionId}</code></dd></div>}
        {item.policyVersion !== undefined && <div><dt>Policy version</dt><dd>{item.policyVersion.toString()}</dd></div>}
        {item.workflowAction && <div><dt>Workflow action</dt><dd>{workflowActionLabel(item.workflowAction)}</dd></div>}
        {item.receiptStatus && <div><dt>Receipt status</dt><dd>{item.receiptStatus}</dd></div>}
        {item.observedVaultStatus && <div><dt>Observed vault status</dt><dd>{item.observedVaultStatus}</dd></div>}
        {item.outcome && <div><dt>Outcome</dt><dd>{item.outcome}</dd></div>}
      </dl>
    </details>}
    {hasPolicyTerms && <details className="evidence-inspector">
      <summary>Inspect policy terms</summary>
      <dl className="evidence-inspector-ledger">
        <div><dt>Guardian</dt><dd><code>{item.guardian}</code></dd></div>
        <div><dt>Heartbeat interval</dt><dd>{formatDuration(item.heartbeatInterval!)}</dd></div>
        <div><dt>Grace period</dt><dd>{formatDuration(item.gracePeriod!)}</dd></div>
        {item.allocations!.map((allocation, index) => <div key={`${allocation.beneficiary}-${index}`}>
          <dt>Allocation {index + 1}</dt>
          <dd>{`${allocation.beneficiary} · ${formatShare(allocation.shareBps)}`}</dd>
        </div>)}
      </dl>
    </details>}
    {item.transactionHash && <a href={`${explorerBase(chainName)}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
  </div></li>;
}

function workflowActionLabel(action: "open" | "finalize") {
  return action === "open" ? "Open settlement" : "Finalize settlement";
}

function AutomationEvidence({
  health,
  readiness,
  coverage,
  evidenceRefresh,
  currentVaultEvidence,
  onRefreshEvidence,
  onRefreshReadiness,
}: {
  health: AutomationHealth;
  readiness?: KeeperHubReadiness;
  coverage?: DashboardViewProps["evidenceCoverage"];
  evidenceRefresh?: DashboardViewProps["evidenceRefresh"];
  currentVaultEvidence?: CurrentVaultEvidence;
  onRefreshEvidence?: DashboardViewProps["onRefreshEvidence"];
  onRefreshReadiness?: DashboardViewProps["onRefreshReadiness"];
}) {
  const runsReturned = coverage?.workflows.reduce((total, workflow) => total + workflow.coverage.runsReturned, 0) ?? 0;
  const olderRunsMayExist = coverage?.workflows.some((workflow) => workflow.coverage.olderRunsMayExist) ?? false;
  const copy = automationCopy(health, readiness, coverage?.workflows.length ?? 0, currentVaultEvidence, evidenceRefresh?.state);
  return <div className={`automation-line automation-${copy.state}`}>
    <span className="live-dot" />
    <div><strong>{copy.title}</strong><small>{copy.detail}</small>
      {coverage && <small>Recent KeeperHub window only: latest 50 non-purged runs per workflow; {runsReturned} returned.{olderRunsMayExist ? " Older runs may exist." : ""}</small>}
      {onRefreshEvidence && <button type="button" onClick={onRefreshEvidence} disabled={evidenceRefresh?.state === "refreshing"}>Refresh evidence</button>}
      {onRefreshReadiness && <button type="button" onClick={onRefreshReadiness} disabled={readiness?.status === "checking"}>Refresh readiness</button>}
      {evidenceRefresh?.detail && <small role="status">{evidenceRefresh.detail}</small>}
    </div>
  </div>;
}

function automationCopy(
  health: AutomationHealth,
  readiness: KeeperHubReadiness | undefined,
  workflowCount: number,
  currentVaultEvidence?: CurrentVaultEvidence,
  evidenceRefresh?: NonNullable<DashboardViewProps["evidenceRefresh"]>["state"],
) {
  if (readiness?.status === "checking") return { state: "checking", title: "Checking KeeperHub automation readiness", detail: readiness.nextStep };
  if (readiness?.status === "unconfigured") return { state: "unconfigured", title: "KeeperHub setup is not configured", detail: readiness.nextStep };
  if (readiness?.status === "chain_unsupported") return { state: "chain_unsupported", title: "KeeperHub does not support this selected chain", detail: readiness.nextStep };
  if (readiness?.status === "wallet_integration_missing") return { state: "wallet_integration_missing", title: "KeeperHub organization wallet integration is missing", detail: readiness.nextStep };
  if (readiness?.status === "preflight_unavailable") return { state: "preflight_unavailable", title: "KeeperHub readiness is unavailable", detail: readiness.nextStep };
  if (currentVaultEvidence === "unknown") return {
    state: "checking",
    title: evidenceRefresh === "stale" ? "KeeperHub evidence is unavailable" : "Checking current-vault KeeperHub evidence",
    detail: evidenceRefresh === "stale" ? "Registration remains unavailable until a successful current-vault reconciliation." : "Automation health is unknown until evidence reconciliation succeeds.",
  };
  if (currentVaultEvidence === "refreshing") return { state: "checking", title: "Refreshing current-vault KeeperHub evidence", detail: "Registration remains unavailable until this read-only reconciliation completes." };
  if (currentVaultEvidence === "stale_with_success") return { state: "stale", title: "KeeperHub evidence is stale", detail: "The prior reconciliation is retained, but registration remains unavailable until evidence is fresh." };
  if (readiness?.status === "ready" && health.state !== "healthy" && workflowCount === 0) return { state: "ready_to_register", title: "Ready to register KeeperHub automation", detail: readiness.nextStep };
  if (health.state === "healthy") return { state: "healthy", title: "KeeperHub automation is healthy", detail: health.detail };
  if (!readiness && workflowCount === 0) return { state: "not_registered", title: "KeeperHub automation is not registered", detail: health.detail };
  return { state: "recovery_required", title: readiness ? "KeeperHub automation requires recovery" : "KeeperHub automation is not registered", detail: health.detail };
}

function LifecycleCard({ lifecycle }: { lifecycle: LifecycleSummary }) {
  const steps = ["Heartbeat", "Grace period", "Settlement"];
  return <section className={`lifecycle-card phase-${lifecycle.phase.toLowerCase()}`}>
    <div className="lifecycle-copy">
      <p className="eyebrow">Onchain policy clock</p>
      <h2>{lifecycle.title}</h2>
      <p>{lifecycle.detail}</p>
      {lifecycle.deadline !== undefined && <time dateTime={new Date(Number(lifecycle.deadline) * 1000).toISOString()}>{formatDeadline(lifecycle.deadline)}</time>}
    </div>
    <div className="lifecycle-track">
      <div className="progress-track" role="progressbar" aria-label="Current policy window progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={lifecycle.progressBps / 100}>
        <span style={{ width: `${lifecycle.progressBps / 100}%` }} />
      </div>
      <ol>{steps.map((step, index) => <li key={step} className={index < lifecycle.currentStep ? "complete" : index === lifecycle.currentStep ? "current" : "upcoming"} aria-current={index === lifecycle.currentStep ? "step" : "false"}><span>{index + 1}</span>{step}</li>)}</ol>
    </div>
  </section>;
}

function ActionButton({ action, label, pendingAction, transactionProgress, walletWritesBlocked, onAction }: DashboardViewProps & { action: DashboardAction; label: string }) {
  const pending = pendingAction === action;
  const pendingLabel = transactionProgress?.stage === "AWAITING_SIGNATURE" ? "Confirm in wallet…" : transactionProgress?.stage === "CONFIRMING" ? "Confirming onchain…" : "Working…";
  return <button disabled={pendingAction !== null || walletWritesBlocked} onClick={() => onAction(action)}>{pending ? pendingLabel : label}<span aria-hidden="true">→</span></button>;
}

function TransactionProgress({ progress, chainName }: { progress: WalletTransactionProgress; chainName: string }) {
  const confirming = progress.stage === "CONFIRMING";
  return <div className="transaction-progress" role="status" aria-live="polite">
    <span className="transaction-spinner" aria-hidden="true" />
    <div><strong>{confirming ? "Waiting for onchain confirmation" : `Confirm ${progress.label.toLowerCase()} in your wallet`}</strong><p>{confirming ? "The wallet submitted the transaction. Actions stay locked until the receipt is final." : "Review the network, contract, and values before signing. Rejecting the request leaves the vault unchanged."}</p>{progress.target && <p>Transaction target <code>{progress.target}</code></p>}</div>
    <ol aria-label="Transaction stages"><li className="active">1 · Wallet approval</li><li className={confirming ? "active" : ""}>2 · Onchain confirmation</li><li>3 · State refresh</li></ol>
    {progress.transactionHash && <a href={`${explorerBase(chainName)}/tx/${progress.transactionHash}`} target="_blank" rel="noreferrer">Track pending transaction ↗</a>}
  </div>;
}

function WalletRecoveryCard({ recovery, chainName, onReconcile }: { recovery: WalletTransactionRecovery; chainName: string; onReconcile?: () => void }) {
  return <section className="transaction-recovery" role="alert">
    <div><p className="eyebrow">Submitted hash retained</p><h2>Transaction needs reconciliation</h2></div>
    <p>The wallet returned a hash, but LastWish could not verify a terminal receipt. Do not submit another vault transaction for this target until the existing hash is reconciled.</p>
    <dl><div><dt>Action</dt><dd>{recovery.label}</dd></div><div><dt>Target</dt><dd><code>{recovery.target}</code></dd></div><div><dt>Transaction</dt><dd><code>{recovery.transactionHash}</code></dd></div></dl>
    <div className="transaction-recovery-actions">
      <a href={`${explorerBase(chainName)}/tx/${recovery.transactionHash}`} target="_blank" rel="noreferrer">Inspect submitted transaction ↗</a>
      {onReconcile && <button type="button" disabled={recovery.reconciling} onClick={onReconcile}>{recovery.reconciling ? "Checking receipt…" : "Check receipt again"}</button>}
    </div>
  </section>;
}

function VaultResolutionState({ title, detail, address, error }: { title: string; detail: string; address: string; error?: string }) {
  return <section className="empty-vault">
    <p className="eyebrow">Vault verification</p>
    <h2>{title}</h2>
    <p>{detail}</p>
    <code>{address}</code>
    {error && <p>{error}</p>}
  </section>;
}

function DashboardFrame({ children }: { children: React.ReactNode }) {
  return <div className="dashboard-shell"><header className="dashboard-nav"><Link className="wordmark" href="/" aria-label="LastWish home"><BrandMark tone="inverse" />LastWish</Link><span>Testnet application</span></header><main className="dashboard-main">{children}</main></div>;
}

function shorten(value?: string, size = 6) {
  if (!value) return "Not connected";
  return `${value.slice(0, size)}…${value.slice(-4)}`;
}

function explorerBase(chainName: string) {
  return chainName.toLowerCase().includes("base") ? "https://sepolia.basescan.org" : "https://sepolia.etherscan.io";
}

function formatDeadline(timestamp: bigint) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(Number(timestamp) * 1000)) + " UTC";
}

function formatTimestamp(timestamp: bigint) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(Number(timestamp) * 1000)) + " UTC";
}

function formatDuration(seconds: bigint) {
  const units = [
    { seconds: 86_400n, label: "day" },
    { seconds: 3_600n, label: "hour" },
    { seconds: 60n, label: "minute" },
  ];
  const unit = units.find((candidate) => seconds % candidate.seconds === 0n);
  const value = unit ? seconds / unit.seconds : seconds;
  const label = unit?.label ?? "second";
  return `${value} ${label}${value === 1n ? "" : "s"}`;
}

function formatShare(shareBps: number) {
  return `${shareBps / 100}%`;
}

function shortenIdentifier(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-5)}` : value;
}
