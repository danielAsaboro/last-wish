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
  auditItems: [],
  pendingAction: null,
  message: null,
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
});
