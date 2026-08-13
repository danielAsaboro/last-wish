import { describe, expect, it, vi } from "vitest";

import { buildVaultInspectionUrl, readVaultAddressFromUrl, readVaultLinkFromUrl, replaceVaultInUrl } from "./vault-link";

const vault = "0x2222222222222222222222222222222222222222" as const;

describe("vault inspection links", () => {
  it("reads only a valid EVM address from the vault query parameter", () => {
    expect(readVaultAddressFromUrl(`https://lastwish.example/dashboard?vault=${vault}`)).toBe(vault);
    expect(readVaultAddressFromUrl("https://lastwish.example/dashboard?vault=not-an-address")).toBeUndefined();
    expect(readVaultAddressFromUrl("https://lastwish.example/dashboard?workflow=secret")).toBeUndefined();
  });

  it("distinguishes an absent vault link from a malformed explicit link", () => {
    expect(readVaultLinkFromUrl("https://lastwish.example/dashboard")).toEqual({ state: "absent" });
    expect(readVaultLinkFromUrl("https://lastwish.example/dashboard?vault=not-an-address")).toEqual({ state: "invalid" });
    expect(readVaultLinkFromUrl(`https://lastwish.example/dashboard?vault=${vault}`)).toEqual({ state: "valid", address: vault });
  });

  it("builds a privacy-minimal canonical inspection URL", () => {
    expect(buildVaultInspectionUrl("https://lastwish.example/dashboard?token=secret#private", vault)).toBe(
      `https://lastwish.example/dashboard?vault=${vault}`,
    );
    expect(buildVaultInspectionUrl("https://alice:secret@lastwish.example/dashboard", vault)).toBe(
      `https://lastwish.example/dashboard?vault=${vault}`,
    );
  });

  it("replaces the current URL without creating a navigation entry", () => {
    const replaceState = vi.fn();
    replaceVaultInUrl("https://lastwish.example/dashboard?old=1", vault, { state: { app: true }, replaceState });
    expect(replaceState).toHaveBeenCalledWith({ app: true }, "", `/dashboard?vault=${vault}`);
  });
});
