import { describe, expect, it } from "vitest";

import { wagmiConfig } from "./config";

describe("wallet connector configuration", () => {
  it("provides an explicit MetaMask connector when competing injected wallets are installed", () => {
    expect(wagmiConfig.connectors.some((connector) => connector.type === "metaMask")).toBe(true);
  });
});
