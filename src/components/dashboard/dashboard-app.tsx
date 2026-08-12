"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

import { buildChainAuditEvents } from "@/lib/audit/chain-events";
import { readEventHistoryInWindows } from "@/lib/audit/event-indexer";
import { buildAuditTimeline, type ChainAuditEvent } from "@/lib/audit/timeline";
import { factoryAbi, vaultAbi } from "@/lib/contracts/abi";
import { AbortableRequestGeneration, isVerifiedVaultActionTarget, shouldApplyEvidenceResponse } from "@/lib/dashboard/async-guards";
import { buildWorkflowAuthorizationMessage } from "@/lib/keeperhub/authorization";
import { deriveAutomationHealth, type DiscoveredWorkflowRegistration } from "@/lib/keeperhub/evidence";
import { keeperHubRegistrationSuccessCopy } from "@/lib/keeperhub/registration-copy";
import { canAuthorizeKeeperHubRegistration, registrationActionStillCurrent, requestKeeperHubRegistrationSignature, type CurrentVaultEvidence, type RegistrationActionContext } from "@/lib/keeperhub/registration-gate";
import { readinessNextSteps, type KeeperHubReadiness } from "@/lib/keeperhub/readiness";
import { shouldApplyVaultSnapshot } from "@/lib/keeperhub/vault-snapshot";
import { buildPolicyArguments, type PolicyDraft } from "@/lib/succession/draft";
import { labelsFromDraft, mergeBeneficiaryLabels, parseBeneficiaryLabels } from "@/lib/succession/labels";
import { buildLifecycleSummary } from "@/lib/succession/status";
import type { Beneficiary, KeeperHubEvidence, VaultStatus } from "@/lib/succession/types";
import { preferredChain } from "@/lib/wallet/config";
import { assertSuccessfulReceipt } from "@/lib/wallet/transaction";
import {
  DashboardView,
  type DashboardAction,
  type AuditIndexCoverage,
  type DashboardRole,
  type WalletTransactionProgress,
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
  lastHeartbeat: bigint;
  pendingAt: bigint;
  deployedAtBlock: bigint;
  observedAt: bigint;
  observedBlockNumber: bigint;
  provenance: { kind: "factory_verified"; factory: Address; verifiedAtBlock: bigint };
  beneficiaries: LoadedBeneficiary[];
};

type Notice = { tone: "success" | "warning" | "danger"; text: string };
type RawVaultLog = Parameters<typeof buildChainAuditEvents>[0][number];
type AuditHistoryCacheEntry = { deployedAtBlock: bigint; indexedThroughBlock: bigint; logs: RawVaultLog[] };
type EvidenceRefresh = { state: "checking" | "refreshing" | "fresh" | "stale"; detail?: string };
type VaultResolution = { state: "empty" } | { state: "loading" | "ready" | "invalid" | "unavailable"; target: Address; detail?: string };
type VaultComposerKind = "fund" | "withdraw" | "update-policy";
type VaultComposer = {
  kind: VaultComposerKind;
  target: Address;
  actor: Address;
  policyVersion: bigint;
  selectionEpoch: number;
};
type ValueComposerSession = Omit<VaultComposer, "kind"> & { kind: "fund" | "withdraw" };
const factoryAddress = process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS;
const statusNames: VaultStatus[] = ["ACTIVE", "PENDING", "VETOED", "READY", "SETTLED"];
const auditIndexingUnavailableCopy = "Chain audit indexing is temporarily unavailable. The last complete event range remains visible.";

function matchingAuditHistory(
  cache: Map<string, AuditHistoryCacheEntry>,
  key: string,
  deployedAtBlock: bigint,
  targetBlock: bigint,
) {
  const history = cache.get(key);
  return history?.deployedAtBlock === deployedAtBlock && history.indexedThroughBlock <= targetBlock
    ? history
    : undefined;
}

export function DashboardApp() {
  const { address: account, chainId, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: preferredChain.id });
  const [vaultAddress, setVaultAddress] = useState<Address>();
  const [vault, setVault] = useState<LoadedVault>();
  const [vaultResolution, setVaultResolution] = useState<VaultResolution>({ state: "empty" });
  const [auditEvents, setAuditEvents] = useState<ChainAuditEvent[]>([]);
  const [auditIndexCoverage, setAuditIndexCoverage] = useState<AuditIndexCoverage>({ state: "idle" });
  const [keeperEvidence, setKeeperEvidence] = useState<KeeperHubEvidence[]>([]);
  const [discoveredWorkflows, setDiscoveredWorkflows] = useState<DiscoveredWorkflowRegistration[]>([]);
  const [executionEvidenceScope, setExecutionEvidenceScope] = useState<"recent_keeperhub_window_only">("recent_keeperhub_window_only");
  const [readiness, setReadiness] = useState<KeeperHubReadiness>({ status: "checking", nextStep: readinessNextSteps.checking });
  const [evidenceRefresh, setEvidenceRefresh] = useState<EvidenceRefresh>({ state: "checking" });
  const [lastSuccessfulEvidence, setLastSuccessfulEvidence] = useState<{ vault: Address; policyVersion: bigint }>();
  const [walletAvailability, setWalletAvailability] = useState<"checking" | "available" | "unavailable">("checking");
  const [pendingAction, setPendingAction] = useState<DashboardAction | null>(null);
  const [composer, setComposer] = useState<VaultComposer | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [transactionProgress, setTransactionProgress] = useState<WalletTransactionProgress>();
  const blockTimestampCache = useRef(new Map<bigint, bigint>());
  const auditHistoryCache = useRef(new Map<string, AuditHistoryCacheEntry>());
  const activeVaultRef = useRef<Address | undefined>(undefined);
  const vaultRef = useRef<LoadedVault | undefined>(undefined);
  const vaultRequestGuard = useRef(new AbortableRequestGeneration());
  const evidenceRequestGuard = useRef(new AbortableRequestGeneration());
  const selectionEpoch = useRef(0);
  const actionEpoch = useRef(0);
  const evidenceGeneration = useRef(0);
  const accountRef = useRef(account);
  const chainIdRef = useRef(chainId);
  const readinessRef = useRef(readiness);
  const currentVaultEvidenceRef = useRef<CurrentVaultEvidence>("unknown");
  const automationHealthRef = useRef(deriveAutomationHealth([]));
  const lastSuccessfulEvidenceRef = useRef<{ vault: Address; policyVersion: bigint } | undefined>(undefined);

  useLayoutEffect(() => {
    if (accountRef.current?.toLowerCase() !== account?.toLowerCase() || chainIdRef.current !== chainId) actionEpoch.current += 1;
    accountRef.current = account;
    chainIdRef.current = chainId;
  }, [account, chainId]);

  const resetAutomationEvidence = useCallback(() => {
    setKeeperEvidence([]);
    setDiscoveredWorkflows([]);
    setExecutionEvidenceScope("recent_keeperhub_window_only");
    setLastSuccessfulEvidence(undefined);
    lastSuccessfulEvidenceRef.current = undefined;
    setEvidenceRefresh({ state: "checking" });
    evidenceRequestGuard.current.invalidate();
    evidenceGeneration.current += 1;
    actionEpoch.current += 1;
  }, []);

  const activateVault = useCallback((address: Address) => {
    if (activeVaultRef.current?.toLowerCase() === address.toLowerCase()) return;
    selectionEpoch.current += 1;
    actionEpoch.current += 1;
    vaultRequestGuard.current.invalidate();
    evidenceRequestGuard.current.invalidate();
    activeVaultRef.current = address;
    setVault(undefined);
    vaultRef.current = undefined;
    setVaultResolution({ state: "loading", target: address });
    setAuditEvents([]);
    setAuditIndexCoverage({ state: "idle" });
    setComposer(null);
    setNotice(null);
    resetAutomationEvidence();
    setVaultAddress(address);
  }, [resetAutomationEvidence]);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      const saved = window.localStorage.getItem(`lastwish:vault:${preferredChain.id}`);
      if (saved && isAddress(saved)) activateVault(getAddress(saved));
    }, 0);
    return () => window.clearTimeout(restore);
  }, [activateVault]);

  useEffect(() => {
    let cancelled = false;
    const injectedConnector = connectors.find((connector) => connector.type === "injected");
    if (!injectedConnector) {
      const unavailable = window.setTimeout(() => { if (!cancelled) setWalletAvailability("unavailable"); }, 0);
      return () => { cancelled = true; window.clearTimeout(unavailable); };
    }
    void injectedConnector?.getProvider().then(
      (provider) => { if (!cancelled) setWalletAvailability(provider ? "available" : "unavailable"); },
      () => { if (!cancelled) setWalletAvailability("unavailable"); },
    );
    return () => { cancelled = true; };
  }, [connectors]);

  const refreshVault = useCallback(async () => {
    if (!vaultAddress || !publicClient) return;
    const requestedVault = vaultAddress;
    const token = vaultRequestGuard.current.begin({ vault: requestedVault });
    let requestedBlockNumber: bigint | undefined;
    try {
      const snapshotBlock = await publicClient.getBlock({ blockTag: "latest" });
      const blockNumber = snapshotBlock.number;
      requestedBlockNumber = blockNumber;
      const [owner, guardian, policyVersion, statusCode, beneficiaryCount, heartbeatInterval, gracePeriod, lastHeartbeat, pendingAt, deployedAtBlock, balance] = await Promise.all([
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "owner", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "guardian", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "policyVersion", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "status", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "beneficiaryCount", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "heartbeatInterval", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "gracePeriod", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "lastHeartbeat", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "pendingAt", blockNumber }),
        publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "deployedAtBlock", blockNumber }),
        publicClient.getBalance({ address: requestedVault, blockNumber }),
      ]);
      const addresses = await Promise.all(
        Array.from({ length: Number(beneficiaryCount) }, (_, index) =>
          publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "beneficiaryAt", args: [BigInt(index)], blockNumber }),
        ),
      );
      if (!factoryAddress || !isAddress(factoryAddress)) {
        throw new Error("The trusted LastWish factory is not configured.");
      }
      const registeredVault = await publicClient.readContract({
        address: getAddress(factoryAddress),
        abi: factoryAbi,
        functionName: "vaultOf",
        args: [owner],
        blockNumber,
      });
      if (registeredVault.toLowerCase() !== requestedVault.toLowerCase()) {
        throw new Error("This address is not a vault created by the configured LastWish factory.");
      }
      const chainBeneficiaries = await Promise.all(addresses.map(async (address) => {
        const [shareBps, claimableWei] = await Promise.all([
          publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "shareBps", args: [address], blockNumber }),
          publicClient.readContract({ address: requestedVault, abi: vaultAbi, functionName: "claimable", args: [address], blockNumber }),
        ]);
        return { address, shareBps: Number(shareBps), claimableWei };
      }));
      const labelKey = `lastwish:labels:${preferredChain.id}:${requestedVault}`;
      const beneficiaries = mergeBeneficiaryLabels(chainBeneficiaries, parseBeneficiaryLabels(window.localStorage.getItem(labelKey)));
      if (!shouldApplyVaultSnapshot(requestedVault, activeVaultRef.current) || !vaultRequestGuard.current.isCurrent(token)) return;
      const loadedVault: LoadedVault = {
        address: requestedVault,
        owner,
        guardian,
        policyVersion,
        status: statusNames[Number(statusCode)] ?? "RECOVERY_REQUIRED",
        balanceWei: balance,
        heartbeatInterval,
        gracePeriod,
        lastHeartbeat,
        pendingAt,
        deployedAtBlock,
        observedAt: snapshotBlock.timestamp,
        observedBlockNumber: blockNumber,
        provenance: { kind: "factory_verified", factory: getAddress(factoryAddress), verifiedAtBlock: blockNumber },
        beneficiaries,
      };
      const policyChanged = vaultRef.current !== undefined && vaultRef.current.policyVersion !== loadedVault.policyVersion;
      if (policyChanged) {
        resetAutomationEvidence();
        setComposer(null);
      }
      vaultRef.current = loadedVault;
      setVault(loadedVault);
      setVaultResolution({ state: "ready", target: requestedVault });
      window.localStorage.setItem(`lastwish:vault:${preferredChain.id}`, requestedVault);

      const auditCacheKey = `${preferredChain.id}:${requestedVault.toLowerCase()}`;
      const cachedHistory = auditHistoryCache.current.get(auditCacheKey);
      const reusableHistory = matchingAuditHistory(auditHistoryCache.current, auditCacheKey, deployedAtBlock, blockNumber);
      const rebuildingHistory = cachedHistory !== undefined && reusableHistory === undefined;
      setAuditIndexCoverage({
        state: "indexing",
        targetBlock: blockNumber,
        ...(reusableHistory ? { lastCompleteBlock: reusableHistory.indexedThroughBlock } : {}),
      });
      try {
        const fromBlock = reusableHistory ? reusableHistory.indexedThroughBlock + 1n : deployedAtBlock;
        const newLogs = await readEventHistoryInWindows<RawVaultLog>({
          fromBlock,
          toBlock: blockNumber,
          readRange: (rangeStart, rangeEnd) => publicClient.getContractEvents({
            address: requestedVault,
            abi: vaultAbi,
            fromBlock: rangeStart,
            toBlock: rangeEnd,
          }),
        });
        const candidateLogs = [...(reusableHistory?.logs ?? []), ...newLogs];
        const candidateTimestamps = new Map(blockTimestampCache.current);
        const blockNumbers = [...new Set(candidateLogs.map((log) => log.blockNumber).filter((block): block is bigint => block !== null && block !== undefined))];
        const missingBlocks = blockNumbers.filter((blockNumber) => rebuildingHistory || !blockTimestampCache.current.has(blockNumber));
        const blocks = await Promise.all(missingBlocks.map((blockNumber) => publicClient.getBlock({ blockNumber })));
        for (const block of blocks) candidateTimestamps.set(block.number, block.timestamp);
        const candidateEvents = buildChainAuditEvents(candidateLogs, candidateTimestamps);
        if (!shouldApplyVaultSnapshot(requestedVault, activeVaultRef.current) || !vaultRequestGuard.current.isCurrent(token)) return;
        for (const block of blocks) blockTimestampCache.current.set(block.number, block.timestamp);
        auditHistoryCache.current.set(auditCacheKey, { deployedAtBlock, indexedThroughBlock: blockNumber, logs: candidateLogs });
        setAuditEvents(candidateEvents);
        setAuditIndexCoverage({ state: "fresh", indexedThroughBlock: blockNumber });
        setNotice((current) => current?.text === auditIndexingUnavailableCopy ? null : current);
      } catch {
        if (!shouldApplyVaultSnapshot(requestedVault, activeVaultRef.current) || !vaultRequestGuard.current.isCurrent(token)) return;
        setAuditEvents(reusableHistory ? buildChainAuditEvents(reusableHistory.logs, blockTimestampCache.current) : []);
        setAuditIndexCoverage({
          state: "stale",
          targetBlock: blockNumber,
          ...(reusableHistory ? { lastCompleteBlock: reusableHistory.indexedThroughBlock } : {}),
        });
        setNotice({ tone: "warning", text: auditIndexingUnavailableCopy });
      }
    } catch (error) {
      if (!vaultRequestGuard.current.isCurrent(token) || !shouldApplyVaultSnapshot(requestedVault, activeVaultRef.current)) return;
      const current = vaultRef.current;
      if (current && isVerifiedVaultActionTarget(requestedVault, current, factoryAddress)) {
        const targetBlock = requestedBlockNumber ?? current.observedBlockNumber;
        const auditCacheKey = `${preferredChain.id}:${requestedVault.toLowerCase()}`;
        const reusableHistory = matchingAuditHistory(auditHistoryCache.current, auditCacheKey, current.deployedAtBlock, targetBlock);
        setVaultResolution({ state: "ready", target: requestedVault });
        setAuditEvents(reusableHistory ? buildChainAuditEvents(reusableHistory.logs, blockTimestampCache.current) : []);
        setAuditIndexCoverage({
          state: "stale",
          targetBlock,
          ...(reusableHistory ? { lastCompleteBlock: reusableHistory.indexedThroughBlock } : {}),
        });
        setNotice({ tone: "warning", text: `The latest vault refresh was unavailable; retaining the last factory-verified snapshot: ${errorMessage(error)}` });
      } else {
        setVault(undefined);
        vaultRef.current = undefined;
        setVaultResolution({ state: "invalid", target: requestedVault, detail: errorMessage(error) });
        setNotice({ tone: "danger", text: `Could not verify this address as a factory-proven LastWish vault on ${preferredChain.name}: ${errorMessage(error)}` });
      }
    }
  }, [publicClient, resetAutomationEvidence, vaultAddress]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refreshVault(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void refreshVault(); }, 30_000);
    return () => { window.clearTimeout(kickoff); window.clearInterval(interval); };
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
        if (existing !== zeroAddress) activateVault(existing);
      } catch {
        // A missing or incompatible factory is surfaced only when the user tries to deploy.
      }
    }, 0);
    return () => window.clearTimeout(discovery);
  }, [account, activateVault, publicClient, vaultAddress]);

  const refreshEvidence = useCallback(async () => {
    const snapshot = vaultRef.current;
    if (!vaultAddress || !snapshot || !isVerifiedVaultActionTarget(vaultAddress, snapshot, factoryAddress)) return;
    const requestedVault = vaultAddress;
    const requestedPolicyVersion = snapshot.policyVersion;
    const token = evidenceRequestGuard.current.begin({ vault: requestedVault, policyVersion: requestedPolicyVersion });
    evidenceGeneration.current = token.generation;
    actionEpoch.current += 1;
    setEvidenceRefresh({ state: "refreshing" });
    try {
      const response = await fetch("/api/keeperhub/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: preferredChain.id, vault: requestedVault }),
        signal: token.signal,
      });
      if (!response.ok) throw new Error("KeeperHub evidence refresh was unavailable.");
      const body = await response.json() as {
        workflows?: DiscoveredWorkflowRegistration[];
        chainId?: number;
        vault?: string;
        policyVersion?: string;
        executionEvidenceScope?: "recent_keeperhub_window_only";
        evidence?: Array<Omit<KeeperHubEvidence, "blockNumber" | "gasUsed" | "timestamp"> & { blockNumber?: string; gasUsed?: string; timestamp?: string }>;
      };
      const responsePolicyVersion = body.policyVersion && /^\d+$/.test(body.policyVersion) ? BigInt(body.policyVersion) : undefined;
      if (!Array.isArray(body.workflows) || !Array.isArray(body.evidence)) {
        throw new Error("KeeperHub returned invalid evidence data.");
      }
      if (!shouldApplyEvidenceResponse(token, evidenceRequestGuard.current, {
        requestedChainId: preferredChain.id,
        activeVault: activeVaultRef.current,
        currentPolicyVersion: vaultRef.current?.policyVersion,
        responseChainId: body.chainId,
        responseVault: body.vault,
        responsePolicyVersion,
      })) {
        if (token.signal.aborted || !evidenceRequestGuard.current.isCurrent(token)) return;
        throw new Error("KeeperHub evidence did not match the active vault and policy.");
      }
      setDiscoveredWorkflows(body.workflows);
      setExecutionEvidenceScope(body.executionEvidenceScope ?? "recent_keeperhub_window_only");
      setKeeperEvidence(body.evidence.map((item) => ({
        ...item,
        blockNumber: item.blockNumber === undefined ? undefined : BigInt(item.blockNumber),
        gasUsed: item.gasUsed === undefined ? undefined : BigInt(item.gasUsed),
        timestamp: item.timestamp === undefined ? undefined : BigInt(item.timestamp),
      })));
      const successfulContext = { vault: requestedVault, policyVersion: requestedPolicyVersion };
      lastSuccessfulEvidenceRef.current = successfulContext;
      setLastSuccessfulEvidence(successfulContext);
      setEvidenceRefresh({ state: "fresh", detail: "Evidence refreshed from KeeperHub's recent provider window." });
    } catch (error) {
      if (isAbortError(error) || token.signal.aborted || !evidenceRequestGuard.current.isCurrent(token) || activeVaultRef.current?.toLowerCase() !== requestedVault.toLowerCase()) return;
      const priorSuccess = lastSuccessfulEvidenceRef.current;
      const hasPriorSuccess = priorSuccess?.vault.toLowerCase() === requestedVault.toLowerCase() && priorSuccess.policyVersion === requestedPolicyVersion;
      setEvidenceRefresh(hasPriorSuccess
        ? { state: "stale", detail: "Evidence refresh failed. Showing the last reconciled evidence; refresh is read-only and will not rebroadcast a transaction." }
        : { state: "stale", detail: "Evidence could not be reconciled yet. Registration remains unavailable until a successful current-vault refresh." });
    }
  }, [vaultAddress]);

  const refreshReadiness = useCallback(async () => {
    actionEpoch.current += 1;
    const checking: KeeperHubReadiness = { status: "checking", nextStep: readinessNextSteps.checking };
    readinessRef.current = checking;
    setReadiness(checking);
    try {
      const response = await fetch(`/api/keeperhub/readiness?chainId=${preferredChain.id}`);
      const body = await response.json() as Partial<KeeperHubReadiness>;
      if (!response.ok || !isReadiness(body)) throw new Error("Invalid readiness response");
      readinessRef.current = body;
      setReadiness(body);
    } catch {
      const unavailable: KeeperHubReadiness = { status: "preflight_unavailable", nextStep: readinessNextSteps.preflight_unavailable };
      readinessRef.current = unavailable;
      setReadiness(unavailable);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refreshReadiness(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refreshReadiness]);

  useEffect(() => {
    if (!vaultAddress || vaultResolution.state !== "ready" || vault?.policyVersion === undefined) return;
    const kickoff = window.setTimeout(() => void refreshEvidence(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void refreshEvidence(); }, 30_000);
    return () => { window.clearTimeout(kickoff); window.clearInterval(interval); };
  }, [refreshEvidence, vaultAddress, vault?.policyVersion, vaultResolution.state]);

  const role = useMemo<DashboardRole>(() => {
    if (!account || !vault || !vaultAddress || !shouldApplyVaultSnapshot(vault.address, vaultAddress)) return "observer";
    const normalized = account.toLowerCase();
    if (vault.owner.toLowerCase() === normalized) return "owner";
    if (vault.guardian.toLowerCase() === normalized) return "guardian";
    if (vault.beneficiaries.some((beneficiary) => beneficiary.address.toLowerCase() === normalized)) return "beneficiary";
    return "observer";
  }, [account, vault, vaultAddress]);

  const connection = !isConnected ? "disconnected" : chainId !== preferredChain.id ? "wrong-network" : "connected";
  const auditItems = useMemo(() => buildAuditTimeline({ chainEvents: auditEvents, keeperHub: keeperEvidence }), [auditEvents, keeperEvidence]);
  const lifecycle = useMemo(() => vault ? buildLifecycleSummary(vault, vault.observedAt) : undefined, [vault]);
  const automationHealth = useMemo(() => deriveAutomationHealth(discoveredWorkflows), [discoveredWorkflows]);
  const currentVaultEvidence = useMemo<CurrentVaultEvidence>(() => {
    const hasCurrentSuccess = Boolean(vaultAddress && vault && lastSuccessfulEvidence?.vault.toLowerCase() === vaultAddress.toLowerCase() && lastSuccessfulEvidence.policyVersion === vault.policyVersion);
    if (!hasCurrentSuccess) return evidenceRefresh.state === "refreshing" ? "refreshing" : "unknown";
    if (evidenceRefresh.state === "fresh") return "fresh";
    if (evidenceRefresh.state === "refreshing") return "refreshing";
    if (evidenceRefresh.state === "stale") return "stale_with_success";
    return "unknown";
  }, [evidenceRefresh.state, lastSuccessfulEvidence, vault, vaultAddress]);
  useLayoutEffect(() => {
    currentVaultEvidenceRef.current = currentVaultEvidence;
    automationHealthRef.current = automationHealth;
  }, [automationHealth, currentVaultEvidence]);
  const vaultSnapshotMatches = isVerifiedVaultActionTarget(vaultAddress, vault, factoryAddress);
  const canRegisterAutomation = canAuthorizeKeeperHubRegistration({
    activeOwner: role === "owner",
    vaultSnapshotMatches,
    readiness: readiness.status,
    currentVaultEvidence,
    automation: automationHealth.state,
  });

  function currentVerifiedVault(expectedTarget?: Address, expectedPolicyVersion?: bigint): LoadedVault | undefined {
    const activeVault = activeVaultRef.current;
    const snapshot = vaultRef.current;
    if (!isVerifiedVaultActionTarget(activeVault, snapshot, factoryAddress)) return undefined;
    if (expectedTarget && activeVault?.toLowerCase() !== expectedTarget.toLowerCase()) return undefined;
    if (expectedPolicyVersion !== undefined && snapshot?.policyVersion !== expectedPolicyVersion) return undefined;
    return snapshot;
  }

  function currentRegistrationContext(): RegistrationActionContext | undefined {
    const currentAccount = accountRef.current;
    const currentChainId = chainIdRef.current;
    const activeVault = activeVaultRef.current;
    const snapshot = currentVerifiedVault();
    if (!currentAccount || currentChainId !== preferredChain.id || !activeVault || !snapshot || snapshot.status === "SETTLED") return undefined;
    const activeOwner = snapshot.owner.toLowerCase() === currentAccount.toLowerCase();
    const snapshotMatches = isVerifiedVaultActionTarget(activeVault, snapshot, factoryAddress);
    return {
      actionEpoch: actionEpoch.current,
      selectionEpoch: selectionEpoch.current,
      evidenceGeneration: evidenceGeneration.current,
      account: currentAccount,
      chainId: currentChainId,
      activeVault,
      snapshotVault: snapshot.address,
      policyVersion: snapshot.policyVersion,
      activeOwner,
      vaultSnapshotMatches: snapshotMatches,
      readiness: readinessRef.current.status,
      currentVaultEvidence: currentVaultEvidenceRef.current,
      automation: automationHealthRef.current.state,
    };
  }

  async function executeSimpleAction(action: Exclude<DashboardAction, "fund" | "withdraw" | "update-policy" | "register">) {
    const target = currentVerifiedVault();
    if (!walletClient || !target || !publicClient) {
      setNotice({ tone: "warning", text: "Wait for factory provenance verification before submitting a vault transaction." });
      return;
    }
    const functionName = { heartbeat: "heartbeat", veto: "vetoSettlement", claim: "claim" }[action] as "heartbeat" | "vetoSettlement" | "claim";
    setPendingAction(action); setNotice(null);
    setTransactionProgress({ label: labelForAction(action), stage: "AWAITING_SIGNATURE", target: target.address });
    try {
      const hash = await walletClient.writeContract({ address: target.address, abi: vaultAbi, functionName });
      if (currentVerifiedVault(target.address)) setTransactionProgress({ label: labelForAction(action), stage: "CONFIRMING", target: target.address, transactionHash: hash });
      const receipt = assertSuccessfulReceipt(await publicClient.waitForTransactionReceipt({ hash }));
      if (currentVerifiedVault(target.address)) setNotice({ tone: "success", text: `${labelForAction(action)} confirmed in block ${receipt.blockNumber}.` });
      await refreshVault();
    } catch (error) {
      if (currentVerifiedVault(target.address)) setNotice({ tone: "danger", text: errorMessage(error) });
    } finally { setPendingAction(null); setTransactionProgress(undefined); }
  }

  function handleAction(action: DashboardAction) {
    if (action === "fund" || action === "withdraw" || action === "update-policy") {
      const target = currentVerifiedVault();
      if (!target || !account || chainId !== preferredChain.id) {
        setNotice({ tone: "warning", text: "Wait for factory provenance verification before opening a vault transaction." });
        return;
      }
      setComposer({ kind: action, target: target.address, actor: account, policyVersion: target.policyVersion, selectionEpoch: selectionEpoch.current });
      return;
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
    setTransactionProgress({ label: "Deploy vault", stage: "AWAITING_SIGNATURE", target: getAddress(factoryAddress) });
    try {
      const args = buildPolicyArguments(draft);
      const hash = await walletClient.writeContract({
        address: getAddress(factoryAddress), abi: factoryAbi, functionName: "createVault",
        args: [args.guardian, args.beneficiaryAddresses, args.shares, args.heartbeatSeconds, args.graceSeconds, args.testnetDemo],
      });
      setTransactionProgress({ label: "Deploy vault", stage: "CONFIRMING", target: getAddress(factoryAddress), transactionHash: hash });
      const receipt = assertSuccessfulReceipt(await publicClient.waitForTransactionReceipt({ hash }));
      const [created] = parseEventLogs({ abi: factoryAbi, eventName: "VaultCreated", logs: receipt.logs });
      if (!created) throw new Error("The factory receipt did not contain VaultCreated.");
      const address = created.args.vault;
      activateVault(address);
      window.localStorage.setItem(`lastwish:vault:${preferredChain.id}`, address);
      window.localStorage.setItem(`lastwish:labels:${preferredChain.id}:${address}`, JSON.stringify(labelsFromDraft(draft.beneficiaries)));
      setNotice({ tone: "success", text: `Vault ${address} deployed and confirmed in block ${receipt.blockNumber}.` });
    } catch (error) { setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); setTransactionProgress(undefined); }
  }

  async function updatePolicy(targetAddress: Address, expectedPolicyVersion: bigint, draft: PolicyDraft) {
    const target = currentVerifiedVault(targetAddress, expectedPolicyVersion);
    if (!walletClient || !publicClient || !target) {
      setNotice({ tone: "warning", text: "The policy target changed. Reopen the editor from the verified vault." });
      return;
    }
    setPendingAction("update-policy");
    setTransactionProgress({ label: "Update policy", stage: "AWAITING_SIGNATURE", target: target.address });
    try {
      const args = buildPolicyArguments(draft);
      const hash = await walletClient.writeContract({ address: target.address, abi: vaultAbi, functionName: "updatePolicy", args: [args.guardian, args.beneficiaryAddresses, args.shares, args.heartbeatSeconds, args.graceSeconds, args.testnetDemo] });
      if (currentVerifiedVault(target.address, target.policyVersion)) setTransactionProgress({ label: "Update policy", stage: "CONFIRMING", target: target.address, transactionHash: hash });
      const receipt = assertSuccessfulReceipt(await publicClient.waitForTransactionReceipt({ hash }));
      window.localStorage.setItem(`lastwish:labels:${preferredChain.id}:${target.address}`, JSON.stringify(labelsFromDraft(draft.beneficiaries)));
      if (currentVerifiedVault(target.address)) {
        resetAutomationEvidence();
        setComposer(null);
        setNotice({ tone: "success", text: `Policy update confirmed in block ${receipt.blockNumber}. The heartbeat clock reset.` });
      }
      await refreshVault();
    } catch (error) { if (currentVerifiedVault(target.address)) setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); setTransactionProgress(undefined); }
  }

  async function transferValue(kind: "fund" | "withdraw", targetAddress: Address, expectedPolicyVersion: bigint, recipient: string, amount: string) {
    const target = currentVerifiedVault(targetAddress, expectedPolicyVersion);
    if (!walletClient || !publicClient || !target || !isAddress(recipient)) {
      setNotice({ tone: "warning", text: "The transaction target is no longer the verified active vault. Reopen the composer." });
      return;
    }
    setPendingAction(kind);
    const transactionLabel = kind === "fund" ? "Fund vault" : "Withdraw funds";
    setTransactionProgress({ label: transactionLabel, stage: "AWAITING_SIGNATURE", target: target.address });
    try {
      const value = parseEther(amount);
      const hash = kind === "fund"
        ? await walletClient.sendTransaction({ to: target.address, value })
        : await walletClient.writeContract({ address: target.address, abi: vaultAbi, functionName: "withdraw", args: [getAddress(recipient), value] });
      if (currentVerifiedVault(target.address, target.policyVersion)) setTransactionProgress({ label: transactionLabel, stage: "CONFIRMING", target: target.address, transactionHash: hash });
      const receipt = assertSuccessfulReceipt(await publicClient.waitForTransactionReceipt({ hash }));
      if (currentVerifiedVault(target.address)) {
        setComposer(null);
        setNotice({ tone: "success", text: `${kind === "fund" ? "Funding" : "Withdrawal"} confirmed in block ${receipt.blockNumber}.` });
      }
      await refreshVault();
    } catch (error) { if (currentVerifiedVault(target.address)) setNotice({ tone: "danger", text: errorMessage(error) }); }
    finally { setPendingAction(null); setTransactionProgress(undefined); }
  }

  async function registerKeeperHub() {
    actionEpoch.current += 1;
    const registration = currentRegistrationContext();
    if (!walletClient || !registration || !canAuthorizeKeeperHubRegistration(registration)) {
      setNotice({
        tone: "warning",
        text: readinessRef.current.status !== "ready"
          ? readinessRef.current.nextStep
          : "Reconcile current-vault KeeperHub evidence before authorizing a repair signature.",
      });
      return;
    }
    setPendingAction("register");
    try {
      const scheduleCron = "*/5 * * * *";
      const expiresAt = Math.floor(Date.now() / 1_000) + 300;
      setTransactionProgress({ label: "Authorize KeeperHub setup", stage: "AWAITING_SIGNATURE", target: registration.activeVault });
      const signature = await requestKeeperHubRegistrationSignature(registration, currentRegistrationContext, () => walletClient.signMessage({
        account: registration.account,
        message: buildWorkflowAuthorizationMessage({
          chainId: preferredChain.id,
          vault: registration.activeVault,
          policyVersion: registration.policyVersion,
          scheduleCron,
          expiresAt,
        }),
      }));
      if (!signature || !registrationActionStillCurrent(registration, currentRegistrationContext())) return;
      if (expiresAt <= Math.floor(Date.now() / 1_000)) {
        setNotice({ tone: "warning", text: "The KeeperHub authorization expired while the wallet was open. Review and sign again." });
        return;
      }
      setTransactionProgress(undefined);
      if (!registrationActionStillCurrent(registration, currentRegistrationContext())) return;
      const response = await fetch("/api/keeperhub/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: preferredChain.id,
          vault: registration.activeVault,
          scheduleCron,
          policyVersion: registration.policyVersion.toString(),
          expiresAt,
          signer: registration.account,
          signature,
        }),
      });
      const body = await response.json();
      if (!registrationActionStillCurrent(registration, currentRegistrationContext())) return;
      if (!response.ok) throw new Error(body.error ?? "KeeperHub registration failed");
      setNotice({ tone: "success", text: keeperHubRegistrationSuccessCopy(body.workflows) });
      await refreshEvidence();
    } catch (error) {
      if (registrationActionStillCurrent(registration, currentRegistrationContext())) setNotice({ tone: "danger", text: errorMessage(error) });
    }
    finally { setPendingAction(null); setTransactionProgress(undefined); }
  }

  return <DashboardView
    connection={connection}
    account={account}
    chainName={preferredChain.name}
    role={role}
    status={vault?.status ?? "RECOVERY_REQUIRED"}
    vaultAddress={vaultAddress}
    vaultResolution={vaultResolution.state}
    vaultResolutionDetail={vaultResolution.state === "empty" ? undefined : vaultResolution.detail}
    balanceLabel={vault ? `${formatEther(vault.balanceWei)} ETH` : "—"}
    policyVersion={vault?.policyVersion.toString() ?? "—"}
    canRegisterAutomation={canRegisterAutomation}
    walletAvailability={walletAvailability}
    readiness={readiness}
    beneficiaries={(vault?.beneficiaries ?? []).map((beneficiary) => ({ label: beneficiary.label, address: beneficiary.address, shareLabel: `${beneficiary.shareBps / 100}%`, claimed: vault?.status === "SETTLED" && beneficiary.claimableWei === 0n }))}
    canClaim={Boolean(account && vault?.beneficiaries.some((beneficiary) => beneficiary.address.toLowerCase() === account.toLowerCase() && beneficiary.claimableWei > 0n))}
    auditItems={auditItems}
    auditIndexCoverage={auditIndexCoverage}
    pendingAction={pendingAction}
    message={notice}
    automation={automationHealth}
    evidenceCoverage={{ scope: executionEvidenceScope, workflows: discoveredWorkflows }}
    evidenceRefresh={evidenceRefresh}
    currentVaultEvidence={currentVaultEvidence}
    lifecycle={lifecycle}
    transactionProgress={transactionProgress}
    onConnect={() => {
      const connector = connectors.find((candidate) => candidate.type === "injected");
      if (!connector) { setNotice({ tone: "danger", text: "No compatible injected EVM wallet is available. Install one and refresh this page." }); return; }
      void connectAsync({ connector }).catch((error) => setNotice({ tone: "danger", text: `Wallet connection was not completed: ${errorMessage(error)}` }));
    }}
    onSwitchNetwork={() => switchChain({ chainId: preferredChain.id })}
    onRefreshEvidence={() => void refreshEvidence()}
    onRefreshReadiness={() => void refreshReadiness()}
    onAction={handleAction}
  >
    <VaultWorkspace
      account={account}
      vault={vault}
      vaultAddress={vaultAddress}
      setVaultAddress={activateVault}
      configuredFactory={factoryAddress}
      pending={pendingAction !== null}
      composer={composer}
      closeComposer={() => setComposer(null)}
      deployVault={deployVault}
      updatePolicy={updatePolicy}
      transferValue={transferValue}
    />
  </DashboardView>;
}

export function VaultWorkspace(props: {
  account?: Address;
  vault?: LoadedVault;
  vaultAddress?: Address;
  setVaultAddress(address: Address): void;
  configuredFactory?: string;
  pending: boolean;
  composer: VaultComposer | null;
  closeComposer(): void;
  deployVault(draft: PolicyDraft): Promise<void>;
  updatePolicy(target: Address, expectedPolicyVersion: bigint, draft: PolicyDraft): Promise<void>;
  transferValue(kind: "fund" | "withdraw", target: Address, expectedPolicyVersion: bigint, recipient: string, amount: string): Promise<void>;
}) {
  const [loadAddress, setLoadAddress] = useState("");
  const verifiedTarget = props.composer &&
    props.account?.toLowerCase() === props.composer.actor.toLowerCase() &&
    props.composer.selectionEpoch >= 0 &&
    props.vault?.policyVersion === props.composer.policyVersion &&
    props.vault.address.toLowerCase() === props.composer.target.toLowerCase() &&
    isVerifiedVaultActionTarget(props.vaultAddress, props.vault, props.configuredFactory)
      ? props.composer
      : null;
  return <>
    <section className="vault-loader">
      <div><strong>{props.vaultAddress ? "Inspect another vault" : "Have a vault address?"}</strong><span>Chain reads verify ownership and state.</span></div>
      <form onSubmit={(event) => { event.preventDefault(); if (!props.pending && isAddress(loadAddress)) props.setVaultAddress(getAddress(loadAddress)); }}>
        <input aria-label="Vault address" placeholder="0x…" value={loadAddress} disabled={props.pending} onChange={(event) => setLoadAddress(event.target.value)} />
        <button disabled={props.pending || !isAddress(loadAddress)}>Load vault</button>
      </form>
    </section>
    {!props.vaultAddress && props.account && <PolicyEditor key={props.account} owner={props.account} mode="create" pending={props.pending} onSubmit={props.deployVault} />}
    {verifiedTarget?.kind === "update-policy" && props.vault && <div className="composer" key={composerKey(verifiedTarget)}>
      <button type="button" className="close-button" onClick={props.closeComposer}>Close</button>
      <p>Transaction target <code>{verifiedTarget.target}</code></p>
      <PolicyEditor owner={props.vault.owner} mode="update" pending={props.pending} initial={props.vault} onSubmit={(draft) => props.updatePolicy(verifiedTarget.target, verifiedTarget.policyVersion, draft)} />
    </div>}
    {isValueComposer(verifiedTarget) && props.account && <ValueComposer
      key={composerKey(verifiedTarget)}
      account={props.account}
      composer={verifiedTarget}
      pending={props.pending}
      closeComposer={props.closeComposer}
      transferValue={props.transferValue}
    />}
  </>;
}

function ValueComposer(props: {
  account: Address;
  composer: ValueComposerSession;
  pending: boolean;
  closeComposer(): void;
  transferValue(kind: "fund" | "withdraw", target: Address, expectedPolicyVersion: bigint, recipient: string, amount: string): Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState<string>(props.account);
  return <section className="composer compact-composer">
    <button type="button" className="close-button" onClick={props.closeComposer}>Close</button>
    <p className="eyebrow">Wallet transaction</p><h2>{props.composer.kind === "fund" ? "Fund vault" : "Withdraw while active"}</h2>
    <p>Transaction target <code>{props.composer.target}</code></p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (props.pending) return;
      void props.transferValue(
        props.composer.kind,
        props.composer.target,
        props.composer.policyVersion,
        props.composer.kind === "fund" ? props.composer.target : recipient,
        amount,
      );
    }}>
      {props.composer.kind === "withdraw" && <label>Recipient<input value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>}
      <label>Amount in ETH<input inputMode="decimal" placeholder="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <button className="button" disabled={props.pending || !amount || (props.composer.kind === "withdraw" && !isAddress(recipient))}>Review in wallet</button>
    </form>
  </section>;
}

function composerKey(composer: VaultComposer): string {
  return `${composer.selectionEpoch}:${composer.target.toLowerCase()}:${composer.policyVersion}:${composer.kind}`;
}

function isValueComposer(composer: VaultComposer | null): composer is ValueComposerSession {
  return composer?.kind === "fund" || composer?.kind === "withdraw";
}

export function PolicyEditor({ owner, mode, pending, initial, onSubmit }: { owner: Address; mode: "create" | "update"; pending: boolean; initial?: LoadedVault; onSubmit(draft: PolicyDraft): Promise<void> | void }) {
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
  const [copilotExplanation, setCopilotExplanation] = useState("");
  const [error, setError] = useState("");
  const copilotRequestGeneration = useRef(0);

  const draft = { owner, guardian, beneficiaries, heartbeatDays, graceDays, testnetDemo: false };
  function validate() { try { buildPolicyArguments(draft); setError(""); return true; } catch (caught) { setError(errorMessage(caught)); return false; } }
  async function askCopilot() {
    const requestGeneration = ++copilotRequestGeneration.current;
    setCopilotState("loading"); setCopilotExplanation(""); setError("");
    try {
      if (!beneficiaries.every((beneficiary) => isAddress(beneficiary.address) && beneficiary.label)) throw new Error("Add beneficiary names and valid addresses before asking Copilot.");
      const response = await fetch("/api/ai/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beneficiaries: beneficiaries.map(({ label, address }) => ({ label, address })), notes }) });
      const body = await response.json();
      if (requestGeneration !== copilotRequestGeneration.current) return;
      if (!response.ok) { setCopilotState(response.status === 503 ? "unavailable" : "idle"); setError(body.error); return; }
      setBeneficiaries(body.draft.beneficiaries); setHeartbeatDays(body.draft.heartbeatDays); setGraceDays(body.draft.graceDays); setCopilotExplanation(body.draft.explanation); setCopilotState("ready");
    } catch (caught) { if (requestGeneration === copilotRequestGeneration.current) { setCopilotState("idle"); setError(errorMessage(caught)); } }
  }
  function invalidateCopilotDraft() { copilotRequestGeneration.current += 1; setCopilotState("idle"); setCopilotExplanation(""); }

  return <section className="policy-editor">
    <div className="wizard-head"><div><p className="eyebrow">{mode === "create" ? "New vault" : "New policy version"}</p><h2>{step === 1 ? "Who should the vault recognize?" : step === 2 ? "Set timing and review." : "Review the signed values."}</h2></div><span>Step {step} / 3</span></div>
    {error && <div className="notice danger" role="alert">{error}</div>}
    {step === 1 && <div className="form-stack">
      <label>Guardian address <span>Can veto, never redirect</span><input value={guardian} onChange={(event) => { invalidateCopilotDraft(); setGuardian(event.target.value); }} placeholder="0x…" /></label>
      <div className="beneficiary-editor"><div className="form-label">Beneficiaries <span>Shares must total 100%</span></div>
        {beneficiaries.map((beneficiary, index) => <div className="beneficiary-row" key={index}>
          <input aria-label={`Beneficiary ${index + 1} label`} maxLength={60} placeholder="Name or label" value={beneficiary.label} onChange={(event) => { invalidateCopilotDraft(); setBeneficiaries(beneficiaries.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item)); }} />
          <input aria-label={`Beneficiary ${index + 1} address`} placeholder="0x…" value={beneficiary.address} onChange={(event) => { invalidateCopilotDraft(); setBeneficiaries(beneficiaries.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item)); }} />
          <label><input aria-label={`Beneficiary ${index + 1} share`} type="number" min="0.01" max="100" step="0.01" value={beneficiary.shareBps / 100} onChange={(event) => { invalidateCopilotDraft(); setBeneficiaries(beneficiaries.map((item, itemIndex) => itemIndex === index ? { ...item, shareBps: Math.round(Number(event.target.value) * 100) } : item)); }} />%</label>
          {beneficiaries.length > 1 && <button aria-label={`Remove beneficiary ${index + 1}`} onClick={() => { invalidateCopilotDraft(); setBeneficiaries(beneficiaries.filter((_, itemIndex) => itemIndex !== index)); }}>×</button>}
        </div>)}
        <button className="add-row" disabled={beneficiaries.length >= 10} onClick={() => { invalidateCopilotDraft(); setBeneficiaries([...beneficiaries, { label: "", address: "", shareBps: 0 }]); }}>{beneficiaries.length >= 10 ? "10 beneficiary limit" : "+ Add beneficiary"}</button>
      </div>
    </div>}
    {step === 2 && <div className="timing-grid">
      <label>Heartbeat interval <input type="number" min="1" max="3650" value={heartbeatDays} onChange={(event) => { invalidateCopilotDraft(); setHeartbeatDays(Number(event.target.value)); }} /><span>days</span><small>How long before automation may open grace.</small></label>
      <label>Guardian grace period <input type="number" min="1" max="3650" value={graceDays} onChange={(event) => { invalidateCopilotDraft(); setGraceDays(Number(event.target.value)); }} /><span>days</span><small>Time to reactivate or veto before finalization.</small></label>
      <div className="copilot-box"><div><p className="eyebrow">AI SDK 7 Policy Copilot</p><strong>Draft parameters, never transactions.</strong><p>Describe priorities. Supplied addresses remain fixed and every draft is validated before wallet review.</p></div>
        <textarea aria-label="Policy Copilot notes" placeholder="Example: keep a conservative review window and explain the trade-off…" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <button disabled={!notes || copilotState === "loading"} onClick={() => void askCopilot()}>{copilotState === "loading" ? "Drafting…" : copilotState === "unavailable" ? "Copilot unavailable" : "Draft with Copilot"}</button>
        {copilotExplanation && <aside className="copilot-rationale"><strong>AI-generated draft rationale</strong><p>{copilotExplanation}</p><small>Unsigned suggestion · review every value before asking your wallet to submit.</small></aside>}
      </div>
    </div>}
    {step === 3 && <div className="review-grid">
      <div><span>Guardian</span><code>{guardian}</code></div><div><span>Heartbeat</span><strong>{heartbeatDays} days</strong></div><div><span>Grace</span><strong>{graceDays} days</strong></div>
      {beneficiaries.map((beneficiary) => <div key={beneficiary.address}><span>{beneficiary.label}</span><code>{beneficiary.address}</code><strong>{beneficiary.shareBps / 100}%</strong></div>)}
      {copilotExplanation && <div className="copilot-review"><span>AI-generated draft rationale</span><p>{copilotExplanation}</p><small>Unsigned suggestion · the contract call uses only the reviewed values above.</small></div>}
      <p>No legal determination or model decision is included. Your wallet will display a contract call containing these exact values.</p>
    </div>}
    <div className="wizard-actions">{step > 1 && <button onClick={() => setStep(step - 1)}>Back</button>}<span />{step < 3 ? <button className="button" onClick={() => { if (step === 1 && !validate()) return; setStep(step + 1); }}>Continue</button> : <button className="button" disabled={pending} onClick={() => { if (validate()) void onSubmit(draft); }}>{pending ? "Waiting for wallet…" : mode === "create" ? "Deploy vault" : "Update policy"}</button>}</div>
  </section>;
}

function errorMessage(error: unknown) { if (typeof error === "object" && error && "shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage; return error instanceof Error ? error.message : "The operation failed."; }
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
function labelForAction(action: string) { return ({ heartbeat: "Heartbeat", veto: "Guardian veto", claim: "Beneficiary claim" } as Record<string, string>)[action] ?? action; }

function isReadiness(value: Partial<KeeperHubReadiness>): value is KeeperHubReadiness {
  return typeof value.nextStep === "string" && ["unconfigured", "chain_unsupported", "wallet_integration_missing", "ready", "preflight_unavailable"].includes(value.status ?? "");
}
