import { describe, expect, it } from "vitest";

import { parseStoredWalletRecovery } from "./recovery-storage";

describe("parseStoredWalletRecovery", () => {
  it("restores a validated recovery pointer for the selected chain", () => {
    expect(parseStoredWalletRecovery(JSON.stringify({
      chainId: 84532,
      action: "fund",
      label: "Fund vault",
      target: "0x2222222222222222222222222222222222222222",
      transactionHash: `0x${"a".repeat(64)}`,
      actor: "0x1111111111111111111111111111111111111111",
    }), 84532)).toMatchObject({ action: "fund", label: "Fund vault" });
  });

  it("rejects another chain, malformed hashes, and unknown actions", () => {
    const base = { chainId: 84532, action: "fund", label: "Fund vault", target: "0x2222222222222222222222222222222222222222", transactionHash: `0x${"a".repeat(64)}` };
    expect(parseStoredWalletRecovery(JSON.stringify(base), 11155111)).toBeUndefined();
    expect(parseStoredWalletRecovery(JSON.stringify({ ...base, transactionHash: "0x1234" }), 84532)).toBeUndefined();
    expect(parseStoredWalletRecovery(JSON.stringify({ ...base, action: "rebroadcast" }), 84532)).toBeUndefined();
  });
});
