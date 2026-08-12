import { describe, expect, it, vi } from "vitest";

import { readVaultStatusAtBlock } from "./reconcile";

describe("readVaultStatusAtBlock", () => {
  it("reconciles an execution against the vault state in its receipt block", async () => {
    const readContract = vi.fn().mockResolvedValue(1);

    await expect(readVaultStatusAtBlock(
      { readContract },
      "0x1111111111111111111111111111111111111111",
      42n,
    )).resolves.toBe("PENDING");

    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "status",
      blockNumber: 42n,
    }));
  });

  it("returns recovery required for an unknown contract status", async () => {
    await expect(readVaultStatusAtBlock(
      { readContract: vi.fn().mockResolvedValue(99) },
      "0x1111111111111111111111111111111111111111",
      42n,
    )).resolves.toBe("RECOVERY_REQUIRED");
  });
});
