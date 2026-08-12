import { describe, expect, it, vi } from "vitest";

import { canAuthorizeKeeperHubRegistration, requestKeeperHubRegistrationSignature } from "./registration-gate";

describe("KeeperHub registration authorization gate", () => {
  const base = {
    activeOwner: true,
    readiness: "ready" as const,
    currentVaultEvidence: "fresh" as const,
    automation: "recovery_required" as const,
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
    ]) {
      await expect(requestKeeperHubRegistrationSignature(input, signMessage)).resolves.toBeUndefined();
    }
    expect(signMessage).not.toHaveBeenCalled();

    await expect(requestKeeperHubRegistrationSignature(base, signMessage)).resolves.toBe("0xsigned");
    expect(signMessage).toHaveBeenCalledOnce();
  });

  it("permits repair authorization only for the active owner after fresh current-vault evidence confirms nonhealthy automation", () => {
    expect(canAuthorizeKeeperHubRegistration(base)).toBe(true);
    expect(canAuthorizeKeeperHubRegistration({ ...base, activeOwner: false })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, readiness: "preflight_unavailable" })).toBe(false);
    expect(canAuthorizeKeeperHubRegistration({ ...base, currentVaultEvidence: "stale_with_success" })).toBe(false);
  });
});
