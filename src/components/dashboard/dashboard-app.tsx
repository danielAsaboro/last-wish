"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatEther,
  getAddress,
  isAddress,
  parseEther,
  parseEventLogs,
  zeroAddress,
  type Address,
} from "viem";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import { buildAuditTimeline, type ChainAuditEvent } from "@/lib/audit/timeline";
import { factoryAbi, vaultAbi } from "@/lib/contracts/abi";
import { buildPolicyArguments, type PolicyDraft } from "@/lib/succession/draft";
import type { Beneficiary, KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";
import { preferredChain } from "@/lib/wallet/config";
import {
  DashboardView,
  type DashboardAction,
  type DashboardRole,
} from "./dashboard-view";

type LoadedBeneficiary = Beneficiary & { claimableWei: bigint };
type LoadedVault = {
  address: Address;
  owner: Address;
  guardian: Address;
  policyVersion: bigint;
  status: VaultStatus;
  balanceWei: bigint;
  heartbeatInterval: bigint;
  gracePeriod: bigint;
  beneficiaries: LoadedBeneficiary[];
};

type Notice = { tone: "success" | "warning" | "danger"; text: string };
type WorkflowRegistration = { workflowId: string; expectedStatus: "PENDING" | "SETTLED" };

const factoryAddress = process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
const statusNames: VaultStatus[] = ["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED"];

export function DashboardApp() {
  const { address: account, chainId, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: preferredChain.id });
  const [vaultAddress, setVaultAddress] = useState<Address>();
  const [vault, setVault] = useState<LoadedVault>();
  const [auditEvents, setAuditEvents] = useState<ChainAuditEvent[]>([]);
  const [keeperEvidence, setKeeperEvidence] = useState<KeeperHubEvidence[]>([]);
  const [workflowCount, setWorkflowCount] = useState(0);
  const [pendingAction, setPendingAction] = useState<DashboardAction | null>(null);
  const [composer, setComposer] = useState<"fund" | "withdraw" | "update-policy" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      const saved = window.localStorage.getItem(`lastwish:vault:${preferredChain.id}`);
      if (saved && isAddress(saved)) setVaultAddress(getAddress(saved));
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  const refreshVault = useCallback(async () => {
    if (!vaultAddress || !publicClient) return;
    try {
      const [owner, guardian, policyVersion, statusCode, beneficiaryCount, heartbeatInterval, gracePeriod, balance] = await Promise.all([
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "owner" }),
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "guardian" }),
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "policyVersion" }),
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "status" }),
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "beneficiaryCount" }),
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "heartbeatInterval" }),
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "gracePeriod" }),
        publicClient.getBalance({ address: vaultAddress }),
      ]);
      const addresses = await Promise.all(
        Array.from({ length: Number(beneficiaryCount) }, (_, index) =>
          publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "beneficiaryAt", args: [BigInt(index)] }),
        ),
      );
      const beneficiaries = await Promise.all(addresses.map(async (address, index) => {
        const [shareBps, claimableWei] = await Promise.all([
          publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "shareBps", args: [address] }),
          publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "claimable", args: [address] }),
        ]);
        return { address, label: `Beneficiary ${index + 1}`, shareBps: Number(shareBps), claimableWei };
      }));
      setVault({
        address: vaultAddress,
        owner,
        guardian,
        policyVersion,
        status: statusNames[Number(statusCode)] ?? "RECOVERY_REQUIRED",
        balanceWei: balance,
        heartbeatInterval,
        gracePeriod,
        beneficiaries,
      });
      window.localStorage.setItem(`lastwish:vault:${preferredChain.id}`, vaultAddress);

      const logs = await publicClient.getContractEvents({ address: vaultAddress, abi: vaultAbi, fromBlock: 0n });
      setAuditEvents(logs.flatMap((log, index) => {
        const type = mapEventName(log.eventName);
        if (!type) return [];
        const args = log.args as Record<string, unknown>;
        return [{
          id: `${log.transactionHash}-${log.logIndex ?? index}`,
          type,
          timestamp: log.blockNumber,
          transactionHash: log.transactionHash,
          amountWei: typeof args.amount === "bigint" ? args.amount : typeof args.balance === "bigint" ? args.balance : undefined,
        } satisfies ChainAuditEvent];
      }));
    } catch (error) {
      setVault(undefined);
      setNotice({ tone: "danger", text: `Could not read this vault on ${preferredChain.name}: ${errorMessage(error)}` });
    }
  }, [publicClient, vaultAddress]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refreshVault(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refreshVault]);

  useEffect(() => {
    if (vaultAddress || !account || !publicClient || !factoryAddress || !isAddress(factoryAddress)) return;
    const discovery = window.setTimeout(async () => {
      try {
        const existing = await publicClient.readContract({
          address: getAddress(factoryAddress),
          abi: factoryAbi,
          functionName: "vaultOf",
          args: [account],
        });
        if (existing !== zeroAddress) setVaultAddress(existing);
      } catch {
        // A missing or incompatible factory is surfaced only when the user tries to deploy.
      }
    }, 0);
    return () => window.clearTimeout(discovery);
  }, [account, publicClient, vaultAddress]);

  const refreshEvidence = useCallback(async (override?: WorkflowRegistration[]) => {
    if (!vaultAddress) return;
    const registrations = override ?? readWorkflowRegistrations(vaultAddress);
    setWorkflowCount(registrations.length);
    if (registrations.length === 0) { setKeeperEvidence([]); return; }
    try {
      const response = await fetch("/api/keeperhub/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: preferredChain.id, vault: vaultAddress, registrations }),
      });
      if (!response.ok) return;
      const body = await response.json() as { evidence?: Array<Omit<KeeperHubEvidence, "blockNumber" | "gasUsed"> & { blockNumber?: string; gasUsed?: string }> };
      setKeeperEvidence((body.evidence ?? []).map((item) => ({
        ...item,
        blockNumber: item.blockNumber === undefined ? undefined : BigInt(item.blockNumber),
        gasUsed: item.gasUsed === undefined ? undefined : BigInt(item.gasUsed),
      })));
    } catch {
      // Preserve the last reconciled evidence until a later read succeeds.
    }
  }, [vaultAddress]);

  useEffect(() => {
    if (!vaultAddress) return;
    const kickoff = window.setTimeout(() => void refreshEvidence(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void refreshEvidence(); }, 30_000);
    return () => { window.clearTimeout(kickoff); window.clearInterval(interval); };
  }, [refreshEvidence, vaultAddress]);

  const role = useMemo<DashboardRole>(() => {
    if (!account || !vault) return "observer";
    const normalized = account.toLowerCase();
    if (vault.owner.toLowerCase() === normalized) return "owner";
    if (vault.guardian.toLowerCase() === normalized) return "guardian";
    if (vault.beneficiaries.some((beneficiary) => beneficiary.address.toLowerCase() === normalized)) return "beneficiary";
    return "observer";
  }, [account, vault]);

  const connection = !isConnected ? "disconnected" : chainId !== preferredChain.id ? "wrong-network" : "connected";
  const auditItems = useMemo(() => buildAuditTimeline({ chainEvents: auditEvents, keeperHub: keeperEvidence }), [auditEvents, keeperEvidence]);

  async function executeSimpleAction(action: Exclude<DashboardAction, "fund" | "withdraw" | "update-policy" | "register">) {
    if (!walletClient || !vaultAddress || !publicClient) return;
    const functionName = { heartbeat: "heartbeat", veto: "vetoSettlement", finalize: "finalizeSettlement", claim: "claim" }[action] as "heartbeat" | "vetoSettlement" | "finalizeSettlement" | "claim";
    setPendingAction(action); setNotice(null);
    try {
      const hash = await walletClient.writeContract({ address: vaultAddress, abi: vaultAbi, functionName });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      setNotice({ tone: "success", text: `${labelForAction(action)} confirmed in block ${receipt.blockNumber}.` });
      await refreshVault();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally { setPendingAction(null); }
  }

  function handleAction(action: DashboardAction) {
    if (action === "fund" || action === "withdraw" || action === "update-policy") {
      setComposer(action); return;
    }
    if (action === "register") { void registerKeeperHub(); return; }
    void executeSimpleAction(action);
  }

  async function deployVault(draft: PolicyDraft) {
    if (!walletClient || !publicClient || !account) return;
    if (!factoryAddress || !isAddress(factoryAddress)) {
      setNotice({ tone: "danger", text: "Vault deployment is unavailable until NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS is configured." }); return;
    }
    setPendingAction("update-policy"); setNotice(null);
    try {
      const args = buildPolicyArguments(draft);
      const hash = await walletClient.writeContract({
        address: getAddress(factoryAddress), abi: factoryAbi, functionName: "createVault",
        args: [args.guardian, args.beneficiaryAddresses, args.shares, args.heartbeatSeconds, args.graceSeconds, args.testnetDemo],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const [created] = parseEventLogs({ abi: factoryAbi, eventName: "VaultCreated", logs: receipt.logs });
      if (!created) throw new Error("The factory receipt did not contain VaultCreated.");
      const address = created.args.vault;
      setVaultAddress(address);
      window.localStorage.setItem(`lastwish:vault:${preferredChain.id}`, address);
      setNotice({ tone: "success", text: `Vault ${address} deployed and confirmed in block ${receipt.blockNumber}.` });
    } catch (error) { setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); }
  }

  async function updatePolicy(draft: PolicyDraft) {
    if (!walletClient || !publicClient || !vaultAddress) return;
    setPendingAction("update-policy");
    try {
      const args = buildPolicyArguments(draft);
      const hash = await walletClient.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "updatePolicy", args: [args.guardian, args.beneficiaryAddresses, args.shares, args.heartbeatSeconds, args.graceSeconds, args.testnetDemo] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setComposer(null); setNotice({ tone: "success", text: `Policy update confirmed in block ${receipt.blockNumber}. The heartbeat clock reset.` });
      await refreshVault();
    } catch (error) { setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); }
  }

  async function transferValue(kind: "fund" | "withdraw", recipient: string, amount: string) {
    if (!walletClient || !publicClient || !vaultAddress || !isAddress(recipient)) return;
    setPendingAction(kind);
    try {
      const value = parseEther(amount);
      const hash = kind === "fund"
        ? await walletClient.sendTransaction({ to: vaultAddress, value })
        : await walletClient.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "withdraw", args: [getAddress(recipient), value] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setComposer(null); setNotice({ tone: "success", text: `${kind === "fund" ? "Funding" : "Withdrawal"} confirmed in block ${receipt.blockNumber}.` });
      await refreshVault();
    } catch (error) { setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); }
  }

  async function registerKeeperHub() {
    if (!vaultAddress) return;
    setPendingAction("register");
    try {
      const response = await fetch("/api/keeperhub/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chainId: preferredChain.id, vault: vaultAddress, scheduleCron: "*/5 * * * *" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "KeeperHub registration failed");
      const registrations: WorkflowRegistration[] = body.workflows.map((workflow: { workflowId: string; name: string }) => ({
        workflowId: workflow.workflowId,
        expectedStatus: workflow.name.includes("finalize") ? "SETTLED" : "PENDING",
      }));
      window.localStorage.setItem(`lastwish:workflows:${preferredChain.id}:${vaultAddress}`, JSON.stringify(registrations));
      setWorkflowCount(registrations.length);
      await refreshEvidence(registrations);
      setNotice({ tone: "success", text: `KeeperHub registered and preflighted ${registrations.length} scheduled workflows.` });
    } catch (error) { setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); }
  }

  return <DashboardView
    connection={connection}
    account={account}
    chainName={preferredChain.name}
    role={role}
    status={vault?.status ?? "ACTIVE"}
    vaultAddress={vaultAddress}
    balanceLabel={vault ? `${formatEther(vault.balanceWei)} ETH` : "—"}
    policyVersion={vault?.policyVersion.toString() ?? "—"}
    beneficiaries={(vault?.beneficiaries ?? []).map((beneficiary) => ({ label: beneficiary.label, address: beneficiary.address, shareLabel: `${beneficiary.shareBps / 100}%`, claimed: vault?.status === "SETTLED" && beneficiary.claimableWei === 0n }))}
    auditItems={auditItems}
    pendingAction={pendingAction}
    message={notice}
    automationLabel={workflowCount > 0 ? `${workflowCount} KeeperHub workflows · evidence refreshes every 30s` : "KeeperHub automation not registered"}
    onConnect={() => connectors[0] && connect({ connector: connectors[0] })}
    onSwitchNetwork={() => switchChain({ chainId: preferredChain.id })}
    onAction={handleAction}
  >
    <VaultWorkspace
      account={account}
      vault={vault}
      vaultAddress={vaultAddress}
      setVaultAddress={setVaultAddress}
      pending={pendingAction !== null}
      composer={composer}
      closeComposer={() => setComposer(null)}
      deployVault={deployVault}
      updatePolicy={updatePolicy}
      transferValue={transferValue}
    />
  </DashboardView>;
}

function VaultWorkspace(props: {
  account?: Address;
  vault?: LoadedVault;
  vaultAddress?: Address;
  setVaultAddress(address: Address): void;
  pending: boolean;
  composer: "fund" | "withdraw" | "update-policy" | null;
  closeComposer(): void;
  deployVault(draft: PolicyDraft): Promise<void>;
  updatePolicy(draft: PolicyDraft): Promise<void>;
  transferValue(kind: "fund" | "withdraw", recipient: string, amount: string): Promise<void>;
}) {
  const [loadAddress, setLoadAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(props.account ?? "");
  return <>
    <section className="vault-loader">
      <div><strong>{props.vaultAddress ? "Inspect another vault" : "Have a vault address?"}</strong><span>Chain reads verify ownership and state.</span></div>
      <form onSubmit={(event) => { event.preventDefault(); if (isAddress(loadAddress)) props.setVaultAddress(getAddress(loadAddress)); }}>
        <input aria-label="Vault address" placeholder="0x…" value={loadAddress} onChange={(event) => setLoadAddress(event.target.value)} />
        <button disabled={!isAddress(loadAddress)}>Load vault</button>
      </form>
    </section>
    {!props.vaultAddress && props.account && <PolicyEditor owner={props.account} mode="create" pending={props.pending} onSubmit={props.deployVault} />}
    {props.composer === "update-policy" && props.vault && <div className="composer"><button className="close-button" onClick={props.closeComposer}>Close</button><PolicyEditor owner={props.vault.owner} mode="update" pending={props.pending} initial={props.vault} onSubmit={props.updatePolicy} /></div>}
    {(props.composer === "fund" || props.composer === "withdraw") && props.account && <section className="composer compact-composer">
      <button className="close-button" onClick={props.closeComposer}>Close</button>
      <p className="eyebrow">Wallet transaction</p><h2>{props.composer === "fund" ? "Fund vault" : "Withdraw while active"}</h2>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (props.composer !== "fund" && props.composer !== "withdraw") return;
        void props.transferValue(props.composer, props.composer === "fund" ? props.vaultAddress! : recipient, amount);
      }}>
        {props.composer === "withdraw" && <label>Recipient<input value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>}
        <label>Amount in ETH<input inputMode="decimal" placeholder="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <button className="button" disabled={props.pending || !amount || (props.composer === "withdraw" && !isAddress(recipient))}>Review in wallet</button>
      </form>
    </section>}
  </>;
}

function PolicyEditor({ owner, mode, pending, initial, onSubmit }: { owner: Address; mode: "create" | "update"; pending: boolean; initial?: LoadedVault; onSubmit(draft: PolicyDraft): Promise<void> }) {
  const [step, setStep] = useState(1);
  const [guardian, setGuardian] = useState(initial?.guardian ?? "");
  const [beneficiaries, setBeneficiaries] = useState<Array<{ label: string; address: string; shareBps: number }>>(
    initial?.beneficiaries.map(({ label, address, shareBps }) => ({ label, address, shareBps })) ?? [
      { label: "", address: "", shareBps: 5000 }, { label: "", address: "", shareBps: 5000 },
    ],
  );
  const [heartbeatDays, setHeartbeatDays] = useState(initial ? Number(initial.heartbeatInterval / 86_400n) : 30);
  const [graceDays, setGraceDays] = useState(initial ? Number(initial.gracePeriod / 86_400n) : 14);
  const [notes, setNotes] = useState("");
  const [copilotState, setCopilotState] = useState<"idle" | "loading" | "unavailable" | "ready">("idle");
  const [error, setError] = useState("");

  const draft = { owner, guardian, beneficiaries, heartbeatDays, graceDays, testnetDemo: false };
  function validate() { try { buildPolicyArguments(draft); setError(""); return true; } catch (caught) { setError(errorMessage(caught)); return false; } }
  async function askCopilot() {
    setCopilotState("loading"); setError("");
    try {
      if (!beneficiaries.every((beneficiary) => isAddress(beneficiary.address) && beneficiary.label)) throw new Error("Add beneficiary names and valid addresses before asking Copilot.");
      const response = await fetch("/api/ai/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beneficiaries: beneficiaries.map(({ label, address }) => ({ label, address })), notes }) });
      const body = await response.json();
      if (!response.ok) { setCopilotState(response.status === 503 ? "unavailable" : "idle"); throw new Error(body.error); }
      setBeneficiaries(body.draft.beneficiaries); setHeartbeatDays(body.draft.heartbeatDays); setGraceDays(body.draft.graceDays); setCopilotState("ready");
    } catch (caught) { setError(errorMessage(caught)); }
  }

  return <section className="policy-editor">
    <div className="wizard-head"><div><p className="eyebrow">{mode === "create" ? "New vault" : "New policy version"}</p><h2>{step === 1 ? "Who should the vault recognize?" : step === 2 ? "Set timing and review." : "Review the signed values."}</h2></div><span>Step {step} / 3</span></div>
    {error && <div className="notice danger" role="alert">{error}</div>}
    {step === 1 && <div className="form-stack">
      <label>Guardian address <span>Can veto, never redirect</span><input value={guardian} onChange={(event) => setGuardian(event.target.value)} placeholder="0x…" /></label>
      <div className="beneficiary-editor"><div className="form-label">Beneficiaries <span>Shares must total 100%</span></div>
        {beneficiaries.map((beneficiary, index) => <div className="beneficiary-row" key={index}>
          <input aria-label={`Beneficiary ${index + 1} label`} placeholder="Name or label" value={beneficiary.label} onChange={(event) => setBeneficiaries(beneficiaries.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} />
          <input aria-label={`Beneficiary ${index + 1} address`} placeholder="0x…" value={beneficiary.address} onChange={(event) => setBeneficiaries(beneficiaries.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} />
          <label><input aria-label={`Beneficiary ${index + 1} share`} type="number" min="0.01" max="100" step="0.01" value={beneficiary.shareBps / 100} onChange={(event) => setBeneficiaries(beneficiaries.map((item, itemIndex) => itemIndex === index ? { ...item, shareBps: Math.round(Number(event.target.value) * 100) } : item))} />%</label>
          {beneficiaries.length > 1 && <button aria-label={`Remove beneficiary ${index + 1}`} onClick={() => setBeneficiaries(beneficiaries.filter((_, itemIndex) => itemIndex !== index))}>×</button>}
        </div>)}
        <button className="add-row" onClick={() => setBeneficiaries([...beneficiaries, { label: "", address: "", shareBps: 0 }])}>+ Add beneficiary</button>
      </div>
    </div>}
    {step === 2 && <div className="timing-grid">
      <label>Heartbeat interval <input type="number" min="1" value={heartbeatDays} onChange={(event) => setHeartbeatDays(Number(event.target.value))} /><span>days</span><small>How long before automation may open grace.</small></label>
      <label>Guardian grace period <input type="number" min="1" value={graceDays} onChange={(event) => setGraceDays(Number(event.target.value))} /><span>days</span><small>Time to reactivate or veto before finalization.</small></label>
      <div className="copilot-box"><div><p className="eyebrow">AI SDK 7 Policy Copilot</p><strong>Draft parameters, never transactions.</strong><p>Describe priorities. Supplied addresses remain fixed and every draft is validated before wallet review.</p></div>
        <textarea aria-label="Policy Copilot notes" placeholder="Example: keep a conservative review window and explain the trade-off…" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <button disabled={!notes || copilotState === "loading"} onClick={() => void askCopilot()}>{copilotState === "loading" ? "Drafting…" : copilotState === "unavailable" ? "Copilot unavailable" : "Draft with Copilot"}</button>
      </div>
    </div>}
    {step === 3 && <div className="review-grid">
      <div><span>Guardian</span><code>{guardian}</code></div><div><span>Heartbeat</span><strong>{heartbeatDays} days</strong></div><div><span>Grace</span><strong>{graceDays} days</strong></div>
      {beneficiaries.map((beneficiary) => <div key={beneficiary.address}><span>{beneficiary.label}</span><code>{beneficiary.address}</code><strong>{beneficiary.shareBps / 100}%</strong></div>)}
      <p>No legal determination or model decision is included. Your wallet will display a contract call containing these exact values.</p>
    </div>}
    <div className="wizard-actions">{step > 1 && <button onClick={() => setStep(step - 1)}>Back</button>}<span />{step < 3 ? <button className="button" onClick={() => { if (step === 1 && !validate()) return; setStep(step + 1); }}>Continue</button> : <button className="button" disabled={pending} onClick={() => { if (validate()) void onSubmit(draft); }}>{pending ? "Waiting for wallet…" : mode === "create" ? "Deploy vault" : "Update policy"}</button>}</div>
  </section>;
}

function mapEventName(name: string): ChainAuditEvent["type"] | undefined {
  return ({ Deposit: "Deposit", Heartbeat: "Heartbeat", PolicyUpdated: "PolicyUpdated", SettlementOpened: "SettlementOpened", SettlementVetoedByGuardian: "SettlementVetoed", SettlementFinalized: "SettlementFinalized", Withdrawal: "Withdrawal", Claimed: "Claimed" } as Record<string, ChainAuditEvent["type"]>)[name];
}
function errorMessage(error: unknown) { if (typeof error === "object" && error && "shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage; return error instanceof Error ? error.message : "The operation failed."; }
function labelForAction(action: string) { return ({ heartbeat: "Heartbeat", veto: "Guardian veto", finalize: "Settlement finalization", claim: "Beneficiary claim" } as Record<string, string>)[action] ?? action; }

function readWorkflowRegistrations(vault: Address): WorkflowRegistration[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`lastwish:workflows:${preferredChain.id}:${vault}`) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      if (typeof item === "string") return [{ workflowId: item, expectedStatus: index === 1 ? "SETTLED" : "PENDING" } as WorkflowRegistration];
      if (typeof item !== "object" || item === null) return [];
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.workflowId !== "string" || (candidate.expectedStatus !== "PENDING" && candidate.expectedStatus !== "SETTLED")) return [];
      return [{ workflowId: candidate.workflowId, expectedStatus: candidate.expectedStatus } as WorkflowRegistration];
    });
  } catch {
    return [];
  }
}
