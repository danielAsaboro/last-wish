import Link from "next/link";

import type { AuditTimelineItem } from "@/lib/audit/timeline";
import type { VaultStatus } from "@/lib/succession/types";

export type DashboardRole = "owner" | "guardian" | "beneficiary" | "observer";
export type DashboardAction = "heartbeat" | "update-policy" | "withdraw" | "veto" | "finalize" | "claim" | "fund" | "register";

export type DashboardViewProps = {
  connection: "disconnected" | "wrong-network" | "connected";
  account?: string;
  chainName: string;
  role: DashboardRole;
  status: VaultStatus;
  vaultAddress?: string;
  balanceLabel: string;
  policyVersion: string;
  beneficiaries: Array<{ label: string; address: string; shareLabel: string; claimed: boolean }>;
  auditItems: AuditTimelineItem[];
  pendingAction: DashboardAction | null;
  message: { tone: "success" | "warning" | "danger"; text: string } | null;
  automationLabel?: string;
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
      {props.children}

      {props.vaultAddress ? (
        <>
          <section className="vault-overview">
            <div className="vault-state-card">
              <div className="card-head"><span>Current state</span><span className={`status-pill status-${props.status.toLowerCase()}`}>{props.status.replace("_", " ")}</span></div>
              <strong>{props.balanceLabel}</strong><small>Vault balance · read from {props.chainName}</small>
              <div className="address-line"><code>{shorten(props.vaultAddress, 10)}</code><span>Policy v{props.policyVersion}</span></div>
              {props.automationLabel && <div className="automation-line"><span className="live-dot" />{props.automationLabel}</div>}
            </div>
            <div className="quick-actions" aria-label="Available vault actions">
              {props.role === "owner" && props.status === "ACTIVE" && <>
                <ActionButton action="heartbeat" label="Record heartbeat" {...props} />
                <ActionButton action="update-policy" label="Update policy" {...props} />
                <ActionButton action="withdraw" label="Withdraw" {...props} />
                <ActionButton action="fund" label="Fund vault" {...props} />
              </>}
              {props.role === "owner" && ["PENDING", "VETOED"].includes(props.status) && <ActionButton action="heartbeat" label="Reactivate vault" {...props} />}
              {props.role === "guardian" && ["PENDING", "READY"].includes(props.status) && <ActionButton action="veto" label="Veto settlement" {...props} />}
              {props.status === "READY" && <ActionButton action="finalize" label="Finalize through wallet" {...props} />}
              {props.role === "beneficiary" && props.status === "SETTLED" && <ActionButton action="claim" label="Claim allocation" {...props} />}
              <ActionButton action="register" label="Register KeeperHub" {...props} />
            </div>
          </section>

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
                <ol className="audit-list">{props.auditItems.map((item) => <li key={item.id} className={`tone-${item.tone}`}><span /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.source}{item.executionId ? ` · ${item.executionId}` : ""}</small>{item.transactionHash && <a href={`${explorerBase(props.chainName)}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div></li>)}</ol>}
            </article>
          </section>
        </>
      ) : <section className="empty-vault"><p className="eyebrow">No vault loaded</p><h2>Create a policy or load an existing vault.</h2><p>Every value shown after loading comes from the connected chain.</p></section>}
    </DashboardFrame>
  );
}

function ActionButton({ action, label, pendingAction, onAction }: DashboardViewProps & { action: DashboardAction; label: string }) {
  const pending = pendingAction === action;
  return <button disabled={pendingAction !== null} onClick={() => onAction(action)}>{pending ? "Waiting for wallet…" : label}<span aria-hidden="true">→</span></button>;
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
