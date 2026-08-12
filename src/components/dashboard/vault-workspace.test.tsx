import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import * as dashboardAppModule from "./dashboard-app";

const vaultA = "0x1111111111111111111111111111111111111111" as const;
const vaultB = "0x2222222222222222222222222222222222222222" as const;
const account = "0x3333333333333333333333333333333333333333" as const;
const factory = "0x5555555555555555555555555555555555555555" as const;
const verifiedVault = {
  address: vaultA,
  owner: account,
  guardian: "0x4444444444444444444444444444444444444444",
  policyVersion: 1n,
  status: "ACTIVE",
  balanceWei: 1n,
  heartbeatInterval: 1n,
  gracePeriod: 1n,
  lastHeartbeat: 1n,
  pendingAt: 0n,
  deployedAtBlock: 1n,
  observedAt: 1n,
  observedBlockNumber: 1n,
  provenance: { kind: "factory_verified", factory, verifiedAtBlock: 1n },
  beneficiaries: [],
};

it("cannot retarget an open vault-A funding composer to vault B and clears its local amount", () => {
  const VaultWorkspace = (dashboardAppModule as unknown as { VaultWorkspace?: React.ComponentType<Record<string, unknown>> }).VaultWorkspace;
  expect(VaultWorkspace).toEqual(expect.any(Function));
  if (!VaultWorkspace) return;
  const transferValue = vi.fn();
  const base = {
    account,
    vault: verifiedVault,
    vaultAddress: vaultA,
    setVaultAddress: vi.fn(),
    pending: false,
    configuredFactory: factory,
    composer: { kind: "fund", target: vaultA, actor: account, policyVersion: 1n, selectionEpoch: 1 },
    closeComposer: vi.fn(),
    deployVault: vi.fn(),
    updatePolicy: vi.fn(),
    transferValue,
  };
  const { rerender } = render(<VaultWorkspace {...base} />);
  expect(screen.getByText(vaultA)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/amount in eth/i), { target: { value: "0.5" } });

  rerender(<VaultWorkspace {...base} vaultAddress={vaultB} vault={undefined} />);
  expect(screen.queryByRole("button", { name: /review in wallet/i })).not.toBeInTheDocument();
  expect(transferValue).not.toHaveBeenCalled();

  rerender(<VaultWorkspace {...base} />);
  expect(screen.getByLabelText(/amount in eth/i)).toHaveValue("");
});

it("disables vault switching while a wallet action is in flight", () => {
  const VaultWorkspace = (dashboardAppModule as unknown as { VaultWorkspace?: React.ComponentType<Record<string, unknown>> }).VaultWorkspace;
  expect(VaultWorkspace).toEqual(expect.any(Function));
  if (!VaultWorkspace) return;
  const setVaultAddress = vi.fn();
  const { rerender } = render(<VaultWorkspace
    account={account}
    vault={verifiedVault}
    vaultAddress={vaultA}
    setVaultAddress={setVaultAddress}
    configuredFactory={factory}
    pending={false}
    composer={null}
    closeComposer={vi.fn()}
    deployVault={vi.fn()}
    updatePolicy={vi.fn()}
    transferValue={vi.fn()}
  />);
  fireEvent.change(screen.getByLabelText(/vault address/i), { target: { value: vaultB } });
  expect(screen.getByRole("button", { name: /load vault/i })).toBeEnabled();

  rerender(<VaultWorkspace
    account={account}
    vault={verifiedVault}
    vaultAddress={vaultA}
    setVaultAddress={setVaultAddress}
    configuredFactory={factory}
    pending={true}
    composer={null}
    closeComposer={vi.fn()}
    deployVault={vi.fn()}
    updatePolicy={vi.fn()}
    transferValue={vi.fn()}
  />);
  expect(screen.getByLabelText(/vault address/i)).toBeDisabled();
  expect(screen.getByRole("button", { name: /load vault/i })).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: /load vault/i }).closest("form")!);
  expect(setVaultAddress).not.toHaveBeenCalled();
});
