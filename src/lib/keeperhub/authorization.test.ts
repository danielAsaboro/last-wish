import { describe, expect, it } from "vitest";

import { buildWorkflowAuthorizationMessage, validateWorkflowAuthorizationWindow, withWorkflowRegistrationLock } from "./authorization";

describe("KeeperHub workflow authorization", () => {
  it("binds owner consent to chain, vault, policy, schedule, and expiry", () => {
    expect(buildWorkflowAuthorizationMessage({
      chainId: 84532,
      vault: "0x1111111111111111111111111111111111111111",
      policyVersion: 3n,
      scheduleCron: "*/5 * * * *",
      expiresAt: 1_800_000_300,
    })).toBe([
      "LastWish KeeperHub workflow registration",
      "Chain ID: 84532",
      "Vault: 0x1111111111111111111111111111111111111111",
      "Policy version: 3",
      "Schedule: */5 * * * *",
      "Expires at: 1800000300",
    ].join("\n"));
  });

  it("accepts only a short-lived future authorization", () => {
    expect(() => validateWorkflowAuthorizationWindow(1_800_000_300, 1_800_000_000)).not.toThrow();
    expect(() => validateWorkflowAuthorizationWindow(1_800_000_000, 1_800_000_000)).toThrow(/expired/i);
    expect(() => validateWorkflowAuthorizationWindow(1_800_000_601, 1_800_000_000)).toThrow(/too far/i);
  });

  it("serializes concurrent registration attempts for the same policy", async () => {
    let active = 0;
    let peak = 0;
    const task = () => withWorkflowRegistrationLock("vault:3", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    });
    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });
});
