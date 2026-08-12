import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardView, type DashboardViewProps } from "./dashboard-view";

const baseProps: DashboardViewProps = {
  connection: "connected",
  account: "0x1111111111111111111111111111111111111111",
  chainName: "Base Sepolia",
  role: "owner",
  status: "ACTIVE",
  vaultAddress: "0x2222222222222222222222222222222222222222",
  balanceLabel: "0.24 ETH",
  policyVersion: "3",
  canRegisterAutomation: true,
  readiness: { status: "ready", nextStep: "The selected network and organization wallet are available. Review and sign registration when you are ready." },
  beneficiaries: [
    { label: "Ada", address: "0x3333333333333333333333333333333333333333", shareLabel: "60%", claimed: false },
    { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareLabel: "40%", claimed: false },
  ],
  canClaim: true,
  auditItems: [],
  auditIndexCoverage: { state: "idle" },
  pendingAction: null,
  message: null,
  lifecycle: {
    phase: "HEARTBEAT_ACTIVE",
    title: "Heartbeat window is active",
    detail: "The owner can reset the clock before KeeperHub is allowed to open grace.",
    deadline: 1_800_000_000n,
    progressBps: 5_000,
    currentStep: 0,
  },
  onConnect: vi.fn(),
  onSwitchNetwork: vi.fn(),
  onAction: vi.fn(),
};

describe("DashboardView", () => {
  it("gives a disconnected user one clear first action", () => {
    render(<DashboardView {...baseProps} connection="disconnected" account={undefined} role="observer" vaultAddress={undefined} />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.getByText(/your wallet is your account/i)).toBeInTheDocument();
  });

  it("explains how to install a compatible EVM wallet when no injected provider exists", () => {
    render(<DashboardView {...baseProps} connection="disconnected" account={undefined} role="observer" vaultAddress={undefined} walletAvailability="unavailable" />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeDisabled();
    expect(screen.getByText(/no compatible injected evm wallet was detected/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /install an evm wallet/i })).toHaveAttribute("href", "https://metamask.io/download/");
  });

  it("shows the factual readiness state and only exposes registration when readiness is ready", () => {
    const { rerender } = render(<DashboardView {...baseProps}
      readiness={{ status: "unconfigured", nextStep: "Configure the server-side KeeperHub API key and trusted LastWish factory address, then refresh readiness." }}
      automation={{ state: "recovery_required", detail: "The current open workflow is missing." }}
    />);
    expect(screen.getByText(/keeperhub setup is not configured/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /register keeperhub/i })).not.toBeInTheDocument();

    rerender(<DashboardView {...baseProps}
      readiness={{ status: "ready", nextStep: "The selected network and organization wallet are available. Review and sign registration when you are ready." }}
      automation={{ state: "recovery_required", detail: "The current open workflow is missing." }}
    />);
    expect(screen.getByText(/ready to register keeperhub automation/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register keeperhub/i })).toBeInTheDocument();
  });

  it("labels checking, unavailable, and unregistered automation without inventing readiness", () => {
    const automation = { state: "recovery_required" as const, detail: "The current open workflow is missing." };
    const { rerender } = render(<DashboardView {...baseProps} readiness={{ status: "checking", nextStep: "Checking the selected network and organization wallet before any registration signature." }} automation={automation} />);
    expect(screen.getByText(/checking keeperhub automation readiness/i)).toBeInTheDocument();

    rerender(<DashboardView {...baseProps} readiness={{ status: "preflight_unavailable", nextStep: "KeeperHub readiness could not be checked. Inspect KeeperHub availability and refresh; do not sign until it is ready." }} automation={automation} />);
    expect(screen.getByText(/keeperhub readiness is unavailable/i)).toBeInTheDocument();

    rerender(<DashboardView {...baseProps} readiness={undefined} automation={automation} />);
    expect(screen.getByText(/automation is not registered/i)).toBeInTheDocument();
  });

  it("keeps previously reconciled evidence visible and labels a failed refresh as stale", () => {
    const onRefreshEvidence = vi.fn();
    const onRefreshReadiness = vi.fn();
    render(<DashboardView {...baseProps}
      automation={{ state: "healthy", detail: "Enabled current open and finalize workflows are registered." }}
      evidenceRefresh={{ state: "stale", detail: "Evidence refresh failed. Showing the last reconciled evidence; retrying would not rebroadcast a transaction." }}
      onRefreshEvidence={onRefreshEvidence}
      onRefreshReadiness={onRefreshReadiness}
    />);
    fireEvent.click(screen.getByRole("button", { name: /refresh evidence/i }));
    expect(onRefreshEvidence).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /refresh readiness/i }));
    expect(onRefreshReadiness).toHaveBeenCalledOnce();
    expect(screen.getByText(/showing the last reconciled evidence/i)).toBeInTheDocument();
  });

  it("blocks writes on the wrong network", () => {
    render(<DashboardView {...baseProps} connection="wrong-network" />);
    expect(screen.getByRole("button", { name: /switch to base sepolia/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record heartbeat/i })).not.toBeInTheDocument();
  });

  it("shows only active owner controls and real provenance labels", () => {
    render(<DashboardView {...baseProps} />);
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update policy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /veto settlement/i })).not.toBeInTheDocument();
    expect(screen.getByText(/read from base sepolia/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /audit trail/i })).toBeInTheDocument();
  });

  it("reports indexing, fresh, and stale chain-history coverage without inventing a completed range", () => {
    const { rerender } = render(<DashboardView {...baseProps} auditIndexCoverage={{ state: "indexing", targetBlock: 25_010n }} />);
    expect(screen.getByText("Indexing confirmed contract events through block 25010")).toBeInTheDocument();
    expect(screen.queryByText(/no indexed events yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/last complete/i)).not.toBeInTheDocument();

    rerender(<DashboardView {...baseProps} auditIndexCoverage={{ state: "fresh", indexedThroughBlock: 25_010n }} />);
    expect(screen.getByText("Chain history indexed through block 25010")).toBeInTheDocument();

    rerender(<DashboardView {...baseProps} auditIndexCoverage={{ state: "stale", targetBlock: 25_015n, lastCompleteBlock: 25_010n }} />);
    expect(screen.getByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.getByText("Last complete through block 25010. Target block 25015.")).toBeInTheDocument();

    rerender(<DashboardView {...baseProps} auditIndexCoverage={{ state: "stale", targetBlock: 25_015n }} />);
    expect(screen.getByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.queryByText(/last complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no indexed events yet/i)).not.toBeInTheDocument();
  });

  it("renders explicit verification failure for an invalid EOA address without synthesizing ACTIVE", () => {
    render(<DashboardView {...baseProps} vaultResolution="invalid" />);
    expect(screen.getByRole("heading", { name: /vault could not be verified/i })).toBeInTheDocument();
    expect(screen.getByText(/not a factory-proven lastwish vault/i)).toBeInTheDocument();
    expect(screen.queryByText(/^ACTIVE$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fund vault/i })).not.toBeInTheDocument();
  });

  it("renders a loading state without exposing vault actions before provenance succeeds", () => {
    render(<DashboardView {...baseProps} vaultResolution="loading" />);
    expect(screen.getByRole("heading", { name: /verifying vault provenance/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fund vault/i })).not.toBeInTheDocument();
  });

  it("shows guardian veto and beneficiary claim only in eligible roles and states", () => {
    const { rerender } = render(<DashboardView {...baseProps} role="guardian" status="PENDING" />);
    expect(screen.getByRole("button", { name: /veto settlement/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record heartbeat/i })).not.toBeInTheDocument();

    rerender(<DashboardView {...baseProps} role="guardian" status="READY" />);
    expect(screen.queryByRole("button", { name: /veto settlement/i })).not.toBeInTheDocument();

    rerender(<DashboardView {...baseProps} role="beneficiary" status="SETTLED" />);
    expect(screen.getByRole("button", { name: /claim allocation/i })).toBeInTheDocument();
  });

  it("does not offer KeeperHub registration to observers or after settlement", () => {
    const { rerender } = render(<DashboardView {...baseProps} role="observer" />);
    expect(screen.queryByRole("button", { name: /register keeperhub/i })).not.toBeInTheDocument();
    rerender(<DashboardView {...baseProps} role="owner" status="SETTLED" />);
    expect(screen.queryByRole("button", { name: /register keeperhub/i })).not.toBeInTheDocument();

    rerender(<DashboardView {...baseProps} role="owner" canRegisterAutomation={false} />);
    expect(screen.queryByRole("button", { name: /register keeperhub/i })).not.toBeInTheDocument();
  });

  it("keeps repair registration visible for incomplete discovered automation and reports limited KeeperHub coverage", () => {
    render(<DashboardView {...baseProps}
      canRegisterAutomation={true}
      automation={{
        state: "recovery_required",
        detail: "The current open workflow is disabled and the current finalize workflow is missing.",
      }}
      evidenceCoverage={{
        scope: "recent_keeperhub_window_only",
        workflows: [{ workflowId: "wf_open", name: "Open", policyVersion: "3", action: "open", enabled: false, definitionMatches: true, registrationState: "current", coverage: { runsReturned: 50, providerWindow: "latest_50_non_purged", olderRunsMayExist: true, providerPagination: "unavailable" } }],
      }} />);
    expect(screen.getByRole("button", { name: /register keeperhub/i })).toBeInTheDocument();
    expect(screen.getByText(/automation requires recovery/i)).toBeInTheDocument();
    expect(screen.getByText(/latest 50 non-purged runs/i)).toBeInTheDocument();
    expect(screen.getByText(/older runs may exist/i)).toBeInTheDocument();
  });

  it("hides actions that the current contract timing or claim balance would reject", () => {
    const expiredLifecycle = { ...baseProps.lifecycle!, phase: "OPEN_ELIGIBLE" as const, currentStep: 1 as const };
    const { rerender } = render(<DashboardView {...baseProps} lifecycle={expiredLifecycle} />);
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeInTheDocument();

    rerender(<DashboardView {...baseProps} role="beneficiary" status="SETTLED" canClaim={false} />);
    expect(screen.queryByRole("button", { name: /claim allocation/i })).not.toBeInTheDocument();
    expect(screen.getByText(/allocation already claimed/i)).toBeInTheDocument();
  });

  it("lets the owner reactivate any unfinalized settlement, including after grace", () => {
    const { rerender } = render(<DashboardView {...baseProps} status="PENDING" />);
    expect(screen.getByRole("button", { name: /reactivate vault/i })).toBeInTheDocument();
    rerender(<DashboardView {...baseProps} status="READY" />);
    expect(screen.getByRole("button", { name: /reactivate vault/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finalize through wallet/i })).not.toBeInTheDocument();
    expect(screen.getByText(/keeperhub can finalize/i)).toBeInTheDocument();
  });

  it("links transaction-backed evidence to the active testnet explorer", () => {
    const transactionHash = `0x${"a".repeat(64)}` as const;
    render(<DashboardView {...baseProps} auditItems={[{
      id: "event-1",
      source: "chain",
      title: "Heartbeat recorded",
      detail: "Confirmed by the vault contract.",
      tone: "success",
      transactionHash,
    }]} />);
    expect(screen.getByRole("link", { name: /view transaction/i })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${transactionHash}`,
    );
  });

  it("shows the policy clock and next contract-gated lifecycle step", () => {
    render(<DashboardView {...baseProps} />);
    expect(screen.getByRole("heading", { name: /heartbeat window is active/i })).toBeInTheDocument();
    expect(screen.getByText(/owner can reset the clock/i)).toBeInTheDocument();
    expect(screen.getByText(/grace period/i)).toHaveAttribute("aria-current", "false");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("shows timestamp, block, and gas provenance for reconciled evidence", () => {
    render(<DashboardView {...baseProps} auditItems={[{
      id: "keeperhub-exec-1",
      source: "keeperhub",
      title: "KeeperHub execution verified",
      detail: "Receipt and state agree.",
      tone: "success",
      timestamp: 1_800_000_000n,
      blockNumber: 42n,
      gasUsed: 70_000n,
      workflowId: "wf_1",
      executionId: "exec_1",
    }]} />);
    expect(screen.getByText(/block 42/i)).toBeInTheDocument();
    expect(screen.getByText(/70,000 gas/i)).toBeInTheDocument();
    expect(screen.getAllByText(/UTC/i)).toHaveLength(2);
  });

  it("reveals full KeeperHub identifiers in an accessible evidence inspector", () => {
    render(<DashboardView {...baseProps} auditItems={[{
      id: "keeperhub-exec-1",
      source: "keeperhub",
      title: "KeeperHub execution verified",
      detail: "Receipt and state agree.",
      tone: "success",
      workflowId: "wf_full_identifier_123456789",
      executionId: "exec_full_identifier_987654321",
      receiptStatus: "success",
      observedVaultStatus: "PENDING",
    }]} />);

    const inspector = screen.getByText(/inspect keeperhub evidence/i).closest("details");
    expect(inspector).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(/inspect keeperhub evidence/i));
    expect(inspector).toHaveAttribute("open");
    expect(screen.getByText("wf_full_identifier_123456789")).toBeInTheDocument();
    expect(screen.getByText("exec_full_identifier_987654321")).toBeInTheDocument();
    expect(screen.getByText(/receipt status/i)).toBeInTheDocument();
  });

  it("keeps the KeeperHub inspector and unavailable reconciliation fields off chain-only evidence", () => {
    render(<DashboardView {...baseProps} auditItems={[
      {
        id: "chain-heartbeat-1",
        source: "chain",
        title: "Heartbeat recorded",
        detail: "Confirmed by the vault contract.",
        tone: "success",
      },
      {
        id: "keeperhub-exec-2",
        source: "keeperhub",
        title: "KeeperHub execution in progress",
        detail: "Execution status: running.",
        tone: "warning",
        workflowId: "wf_minimal",
      },
    ]} />);

    expect(screen.getAllByText(/inspect keeperhub evidence/i)).toHaveLength(1);
    fireEvent.click(screen.getByText(/inspect keeperhub evidence/i));
    expect(screen.queryByText(/receipt status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/observed vault status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^outcome$/i)).not.toBeInTheDocument();
  });

  it("distinguishes wallet approval from onchain confirmation", () => {
    const { rerender } = render(<DashboardView {...baseProps} pendingAction="heartbeat" transactionProgress={{ label: "Record heartbeat", stage: "AWAITING_SIGNATURE" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/confirm record heartbeat in your wallet/i);
    expect(screen.getByRole("button", { name: /confirm in wallet/i })).toBeDisabled();

    const transactionHash = `0x${"b".repeat(64)}` as const;
    rerender(<DashboardView {...baseProps} pendingAction="heartbeat" transactionProgress={{ label: "Record heartbeat", stage: "CONFIRMING", transactionHash }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for onchain confirmation/i);
    expect(screen.getByRole("link", { name: /track pending transaction/i })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${transactionHash}`);
  });

  it("keeps an ambiguous submitted transaction visible and blocks conflicting writes", () => {
    const onReconcileWalletTransaction = vi.fn();
    const transactionHash = `0x${"c".repeat(64)}` as const;
    render(<DashboardView
      {...baseProps}
      walletWritesBlocked
      walletRecovery={{
        label: "Heartbeat",
        target: baseProps.vaultAddress as `0x${string}`,
        transactionHash,
        reconciling: false,
      }}
      onReconcileWalletTransaction={onReconcileWalletTransaction}
    />);

    expect(screen.getByRole("heading", { name: /transaction needs reconciliation/i })).toBeInTheDocument();
    expect(screen.getByText(/do not submit another vault transaction/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inspect submitted transaction/i })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${transactionHash}`);
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /check receipt again/i }));
    expect(onReconcileWalletTransaction).toHaveBeenCalledOnce();
  });
});
