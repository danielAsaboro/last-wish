import { describe, expect, it, vi } from "vitest";

import { canAuthorizeKeeperHubRegistration, requestKeeperHubRegistrationSignature, type RegistrationActionContext } from "./registration-gate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("KeeperHub registration authorization gate", () => {
  const base = {
    activeOwner: true,
    vaultSnapshotMatches: true,
    readiness: "ready" as const,
    currentVaultEvidence: "fresh" as const,
    automation: "recovery_required" as const,
  };
  const context: RegistrationActionContext = {
    ...base,
    actionEpoch: 1,
    account: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    activeVault: "0x2222222222222222222222222222222222222222",
    snapshotVault: "0x2222222222222222222222222222222222222222",
    policyVersion: 3n,
    selectionEpoch: 1,
    evidenceGeneration: 1,
  };

  it("never permits a registration signature while evidence is unknown after a first failure, refreshing, or healthy", () => {
    expect(canAuthorizeKeeperHubRegistration({ ...base, currentVaultEvidence: "unknown" })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, currentVaultEvidence: "refreshing" })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, automation: "healthy" })).toBe(false);
  });

  it("does not call signMessage until the DashboardApp authorization conditions are all true", async () => {
    const signMessage = vi.fn(async () => "0xsigned");
    for (const input of [
      { ...base, currentVaultEvidence: "unknown" as const },
      { ...base, currentVaultEvidence: "refreshing" as const },
      { ...base, automation: "healthy" as const },
      { ...base, activeOwner: false },
      { ...base, vaultSnapshotMatches: false },
    ]) {
      await expect(requestKeeperHubRegistrationSignature({ ...context, ...input }, () => ({ ...context, ...input }), signMessage)).resolves.toBeUndefined();
    }
    expect(signMessage).not.toHaveBeenCalled();

    await expect(requestKeeperHubRegistrationSignature(context, () => context, signMessage)).resolves.toBe("0xsigned");
    expect(signMessage).toHaveBeenCalledOnce();
  });

  it("permits repair authorization only for the active owner after fresh current-vault evidence confirms nonhealthy automation", () => {
    expect(canAuthorizeKeeperHubRegistration(base)).toBe(true);
    expect(canAuthorizeKeeperHubRegistration({ ...base, activeOwner: false })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, vaultSnapshotMatches: false })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, readiness: "preflight_unavailable" })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, currentVaultEvidence: "stale_with_success" })).toBe(false);
  });

  it("discards a signed registration when the vault or account changes during the wallet prompt", async () => {
    const signature = deferred<string>();
    const initial: RegistrationActionContext = {
      ...base,
      actionEpoch: 7,
      account: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      activeVault: "0x2222222222222222222222222222222222222222",
      snapshotVault: "0x2222222222222222222222222222222222222222",
      policyVersion: 3n,
      selectionEpoch: 3,
      evidenceGeneration: 4,
    };
    let current = initial;
    const pending = requestKeeperHubRegistrationSignature(initial, () => current, () => signature.promise);
    current = {
      ...initial,
      actionEpoch: 8,
      account: "0x3333333333333333333333333333333333333333",
      activeVault: "0x4444444444444444444444444444444444444444",
      snapshotVault: "0x4444444444444444444444444444444444444444",
    };
    signature.resolve("0xsigned");
    await expect(pending).resolves.toBeUndefined();
  });
});
