import { describe, expect, it } from "vitest";

import { shouldApplyVaultSnapshot } from "./vault-snapshot";

describe("vault snapshot reconciliation", () => {
  it("rejects a late vault A snapshot after the active vault changes to B", () => {
    const vaultA = "0x1111111111111111111111111111111111111111";
    const vaultB = "0x2222222222222222222222222222222222222222";

    expect(shouldApplyVaultSnapshot(vaultA, vaultA)).toBe(true);
    expect(shouldApplyVaultSnapshot(vaultA, vaultB)).toBe(false);
  });
});
