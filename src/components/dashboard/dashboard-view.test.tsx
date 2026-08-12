import { render, screen } from "@testing-library/react";
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
  beneficiaries: [
    { label: "Ada", address: "0x3333333333333333333333333333333333333333", shareLabel: "60%", claimed: false },
    { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareLabel: "40%", claimed: false },
  ],
  canClaim: true,
  auditItems: [],
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

  it("shows guardian veto and beneficiary claim only in eligible roles and states", () => {
    const { rerender } = render(<DashboardView {...baseProps} role="guardian" status="PENDING" />);
    expect(screen.getByRole("button", { name: /veto settlement/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record heartbeat/i })).not.toBeInTheDocument();
    rerender(<DashboardView {...baseProps} role="beneficiary" status="SETTLED" />);
    expect(screen.getByRole("button", { name: /claim allocation/i })).toBeInTheDocument();
  });

  it("does not offer KeeperHub registration to observers or after settlement", () => {
    const { rerender } = render(<DashboardView {...baseProps} role="observer" />);
    expect(screen.queryByRole("button", { name: /register keeperhub/i })).not.toBeInTheDocument();
    rerender(<DashboardView {...baseProps} role="owner" status="SETTLED" />);
    expect(screen.queryByRole("button", { name: /register keeperhub/i })).not.toBeInTheDocument();
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

  it("distinguishes wallet approval from onchain confirmation", () => {
    const { rerender } = render(<DashboardView {...baseProps} pendingAction="heartbeat" transactionProgress={{ label: "Record heartbeat", stage: "AWAITING_SIGNATURE" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/confirm record heartbeat in your wallet/i);
    expect(screen.getByRole("button", { name: /confirm in wallet/i })).toBeDisabled();

    const transactionHash = `0x${"b".repeat(64)}` as const;
    rerender(<DashboardView {...baseProps} pendingAction="heartbeat" transactionProgress={{ label: "Record heartbeat", stage: "CONFIRMING", transactionHash }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for onchain confirmation/i);
    expect(screen.getByRole("link", { name: /track pending transaction/i })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${transactionHash}`);
  });
});
