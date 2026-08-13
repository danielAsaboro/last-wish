import { describe, expect, it } from "vitest";

import { AbortableRequestGeneration, isVerifiedVaultActionTarget, shouldApplyEvidenceResponse, shouldApplyIntegrityResponse, shouldApplyVaultBlock } from "./async-guards";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("dashboard async and vault-target guards", () => {
  it("rejects an older same-vault snapshot that resolves after a newer block", async () => {
    const guard = new AbortableRequestGeneration();
    const older = deferred<bigint>();
    const newer = deferred<bigint>();
    const olderToken = guard.begin({ vault: "0x1111111111111111111111111111111111111111" });
    const newerToken = guard.begin({ vault: "0x1111111111111111111111111111111111111111" });
    newer.resolve(101n);
    const newestBlock = await newer.promise;
    expect(shouldApplyVaultBlock(newerToken, guard, newestBlock, undefined)).toBe(true);
    older.resolve(100n);
    expect(shouldApplyVaultBlock(olderToken, guard, await older.promise, newestBlock)).toBe(false);
    expect(olderToken.signal.aborted).toBe(true);
  });

  it("binds same-vault evidence to both request generation and observed policy version", () => {
    const guard = new AbortableRequestGeneration();
    const v1 = guard.begin({ vault: "0x1111111111111111111111111111111111111111", policyVersion: 1n });
    const v2 = guard.begin({ vault: "0x1111111111111111111111111111111111111111", policyVersion: 2n });
    expect(shouldApplyEvidenceResponse(v1, guard, { requestedChainId: 84532, activeVault: v1.vault, currentPolicyVersion: 2n, responseChainId: 84532, responseVault: v1.vault, responsePolicyVersion: 1n })).toBe(false);
    expect(shouldApplyEvidenceResponse(v2, guard, { requestedChainId: 84532, activeVault: v2.vault, currentPolicyVersion: 2n, responseChainId: 84532, responseVault: v2.vault, responsePolicyVersion: 2n })).toBe(true);
    expect(shouldApplyEvidenceResponse(v2, guard, { requestedChainId: 84532, activeVault: v2.vault, currentPolicyVersion: 2n, responseChainId: 11155111, responseVault: v2.vault, responsePolicyVersion: 2n })).toBe(false);
  });

  it("requires an exact factory-verified snapshot before resolving a vault transaction target", () => {
    const vaultA = "0x1111111111111111111111111111111111111111";
    const vaultB = "0x2222222222222222222222222222222222222222";
    const factory = "0x3333333333333333333333333333333333333333";
    const snapshot = { address: vaultA, observedBlockNumber: 42n, provenance: { kind: "factory_verified", factory, verifiedAtBlock: 42n } };
    expect(isVerifiedVaultActionTarget(vaultA, snapshot, factory)).toBe(true);
    expect(isVerifiedVaultActionTarget(vaultB, snapshot, factory)).toBe(false);
    expect(isVerifiedVaultActionTarget(vaultA, snapshot, "0x4444444444444444444444444444444444444444")).toBe(false);
  });

  it("rejects a late integrity report after the active vault changes", () => {
    const guard = new AbortableRequestGeneration();
    const vaultA = "0x1111111111111111111111111111111111111111";
    const vaultB = "0x2222222222222222222222222222222222222222";
    const tokenA = guard.begin({ vault: vaultA });
    const tokenB = guard.begin({ vault: vaultB });
    expect(shouldApplyIntegrityResponse(tokenA, guard, 84532, vaultB, 84532, vaultA)).toBe(false);
    expect(shouldApplyIntegrityResponse(tokenB, guard, 84532, vaultB, 84532, vaultB)).toBe(true);
    expect(shouldApplyIntegrityResponse(tokenB, guard, 84532, vaultB, 11155111, vaultB)).toBe(false);
  });
});
