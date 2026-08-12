import Link from "next/link";

import type { AuditTimelineItem } from "@/lib/audit/timeline";
import type { AutomationHealth, DiscoveredWorkflowRegistration } from "@/lib/keeperhub/evidence";
import type { LifecycleSummary } from "@/lib/succession/status";
import type { Address, VaultStatus } from "@/lib/succession/types";

export type DashboardRole = "owner" | "guardian" | "beneficiary" | "observer";
export type DashboardAction = "heartbeat" | "update-policy" | "withdraw" | "veto" | "claim" | "fund" | "register";
export type WalletTransactionProgress = { label: string; stage: "AWAITING_SIGNATURE" | "CONFIRMING"; transactionHash?: Address };

export type DashboardViewProps = {
  connection: "disconnected" | "wrong-network" | "connected";
  account?: string;
  chainName: string;
  role: DashboardRole;
  status: VaultStatus;
  vaultAddress?: string;
  balanceLabel: string;
  policyVersion: string;
  canRegisterAutomation: boolean;
  beneficiaries: Array<{ label: string; address: string; shareLabel: string; claimed: boolean }>;
  canClaim: boolean;
  auditItems: AuditTimelineItem[];
  pendingAction: DashboardAction | null;
  message: { tone: "success" | "warning" | "danger"; text: string } | null;
  automation?: AutomationHealth;
  evidenceCoverage?: { scope: "recent_keeperhub_window_only"; workflows: DiscoveredWorkflowRegistration[] };
  lifecycle?: LifecycleSummary;
  transactionProgress?: WalletTransactionProgress;
  onConnect(): void;
  onSwitchNetwork(): void;
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
          <p>Connect an injected EVM wallet to create a vault or inspect one you already know. LastWish does not use passwords or hold keys.</p>
          <button className="button" onClick={props.onConnect}>Connect wallet</button>
          <ul className="trust-list"><li>No seed phrase requested</li><li>No transaction until you review it</li><li>Base Sepolia testnet</li></ul>
        </section>
      </DashboardFrame>
    );
  }

  if (props.connection === "wrong-network") {
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

  return (
    <DashboardFrame>
      <header className="dashboard-titlebar">
        <div><p className="eyebrow">Vault command center</p><h1>Succession policy</h1></div>
        <div className="wallet-chip"><span className="live-dot" />{shorten(props.account)}<small>{props.role} · {props.chainName}</small></div>
      </header>

      {props.message && <div className={`notice ${props.message.tone}`} role="status">{props.message.text}</div>}
      {props.transactionProgress && <TransactionProgress progress={props.transactionProgress} chainName={props.chainName} />}
      {props.children}

      {props.vaultAddress ? (
        <>
          <section className="vault-overview">
            <div className="vault-state-card">
              <div className="card-head"><span>Current state</span><span className={`status-pill status-${props.status.toLowerCase()}`}>{props.status.replace("_", " ")}</span></div>
              <strong>{props.balanceLabel}</strong><small>Vault balance · read from {props.chainName}</small>
              <div className="address-line"><code>{shorten(props.vaultAddress, 10)}</code><span>Policy v{props.policyVersion}</span></div>
              {props.automation && <AutomationEvidence health={props.automation} coverage={props.evidenceCoverage} />}
            </div>
            <div className="quick-actions" aria-label="Available vault actions">
              {props.role === "owner" && props.status === "ACTIVE" && <>
                <ActionButton action="heartbeat" label="Record heartbeat" {...props} />
                <ActionButton action="update-policy" label="Update policy" {...props} />
                {props.lifecycle?.phase !== "OPEN_ELIGIBLE" && <ActionButton action="withdraw" label="Withdraw" {...props} />}
                <ActionButton action="fund" label="Fund vault" {...props} />
              </>}
              {props.role === "owner" && ["PENDING", "VETOED", "READY"].includes(props.status) && <ActionButton action="heartbeat" label="Reactivate vault" {...props} />}
              {props.role === "guardian" && props.status === "PENDING" && <ActionButton action="veto" label="Veto settlement" {...props} />}
              {props.status === "READY" && <p className="completed-action">KeeperHub can finalize now · owner may still reactivate</p>}
              {props.role === "beneficiary" && props.status === "SETTLED" && props.canClaim && <ActionButton action="claim" label="Claim allocation" {...props} />}
              {props.role === "beneficiary" && props.status === "SETTLED" && !props.canClaim && <p className="completed-action">Allocation already claimed ✓</p>}
              {props.role === "owner" && props.status !== "SETTLED" && props.canRegisterAutomation && <ActionButton action="register" label="Register KeeperHub" {...props} />}
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
              <div className="panel-heading"><div><p className="eyebrow">Evidence, not activity</p><h2>Audit trail</h2></div><span>{props.auditItems.length}</span></div>
              {props.auditItems.length === 0 ? <div className="empty-state"><span>◎</span><p>No indexed events yet. Confirmed contract events and KeeperHub receipts will appear here.</p></div> :
                <ol className="audit-list">{props.auditItems.map((item) => <li key={item.id} className={`tone-${item.tone}`}><span /><div><strong>{item.title}</strong><p>{item.detail}</p>{item.action && <p className="audit-action">{item.action}</p>}<div className="audit-meta"><small>{item.source}</small>{item.timestamp !== undefined && <time dateTime={new Date(Number(item.timestamp) * 1000).toISOString()}>{formatTimestamp(item.timestamp)}</time>}{item.blockNumber !== undefined && <span>Block {item.blockNumber.toString()}</span>}{item.gasUsed !== undefined && <span>{item.gasUsed.toLocaleString("en-US")} gas</span>}{item.workflowId && <code>{shortenIdentifier(item.workflowId)}</code>}{item.executionId && <code>{shortenIdentifier(item.executionId)}</code>}</div>{item.transactionHash && <a href={`${explorerBase(props.chainName)}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div></li>)}</ol>}
            </article>
          </section>
        </>
      ) : <section className="empty-vault"><p className="eyebrow">No vault loaded</p><h2>Create a policy or load an existing vault.</h2><p>Every value shown after loading comes from the connected chain.</p></section>}
    </DashboardFrame>
  );
}

function AutomationEvidence({
  health,
  coverage,
}: {
  health: AutomationHealth;
  coverage?: DashboardViewProps["evidenceCoverage"];
}) {
  const runsReturned = coverage?.workflows.reduce((total, workflow) => total + workflow.coverage.runsReturned, 0) ?? 0;
  const olderRunsMayExist = coverage?.workflows.some((workflow) => workflow.coverage.olderRunsMayExist) ?? false;
  return <div className={`automation-line automation-${health.state}`}>
    <span className="live-dot" />
    <div><strong>{health.state === "healthy" ? "KeeperHub automation is ready" : "KeeperHub automation needs repair"}</strong><small>{health.detail}</small>
      {coverage && <small>Recent KeeperHub window only: latest 50 non-purged runs per workflow; {runsReturned} returned.{olderRunsMayExist ? " Older runs may exist." : ""}</small>}
    </div>
  </div>;
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

function ActionButton({ action, label, pendingAction, transactionProgress, onAction }: DashboardViewProps & { action: DashboardAction; label: string }) {
  const pending = pendingAction === action;
  const pendingLabel = transactionProgress?.stage === "AWAITING_SIGNATURE" ? "Confirm in wallet…" : transactionProgress?.stage === "CONFIRMING" ? "Confirming onchain…" : "Working…";
  return <button disabled={pendingAction !== null} onClick={() => onAction(action)}>{pending ? pendingLabel : label}<span aria-hidden="true">→</span></button>;
}

function TransactionProgress({ progress, chainName }: { progress: WalletTransactionProgress; chainName: string }) {
  const confirming = progress.stage === "CONFIRMING";
  return <div className="transaction-progress" role="status" aria-live="polite">
    <span className="transaction-spinner" aria-hidden="true" />
    <div><strong>{confirming ? "Waiting for onchain confirmation" : `Confirm ${progress.label.toLowerCase()} in your wallet`}</strong><p>{confirming ? "The wallet submitted the transaction. Actions stay locked until the receipt is final." : "Review the network, contract, and values before signing. Rejecting the request leaves the vault unchanged."}</p></div>
    <ol aria-label="Transaction stages"><li className="active">1 · Wallet approval</li><li className={confirming ? "active" : ""}>2 · Onchain confirmation</li><li>3 · State refresh</li></ol>
    {progress.transactionHash && <a href={`${explorerBase(chainName)}/tx/${progress.transactionHash}`} target="_blank" rel="noreferrer">Track pending transaction ↗</a>}
  </div>;
}

function DashboardFrame({ children }: { children: React.ReactNode }) {
  return <div className="dashboard-shell"><header className="dashboard-nav"><Link className="wordmark" href="/"><span className="mark">LW</span>LastWish</Link><span>Testnet application</span></header><main className="dashboard-main">{children}</main></div>;
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

function shortenIdentifier(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-5)}` : value;
}
