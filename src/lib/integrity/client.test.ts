import { describe, expect, it } from "vitest";

import { loadIntegritySummary, parseIntegritySummary } from "./client";

describe("integrity report client", () => {
  it("extracts only dashboard-safe summary fields", () => {
    expect(parseIntegritySummary({ reportHash: `0x${"a".repeat(64)}`, report: { schema: "lastwish.integrity.v1", chain: { id: 84532 }, vault: { address: "0x1111111111111111111111111111111111111111", observedBlockNumber: "42" }, keeperHub: { workflows: [{ workflowId: "wf" }] }, audit: { state: "fresh", indexedThroughBlock: "42" }, verification: { status: "verified" } } })).toEqual({ chainId: 84532, vaultAddress: "0x1111111111111111111111111111111111111111", reportHash: `0x${"a".repeat(64)}`, observedBlockNumber: "42", workflowCount: 1, auditState: "fresh", verificationStatus: "verified" });
  });

  it("accepts recovery-required verification without treating it as verified", () => {
    expect(parseIntegritySummary({ reportHash: `0x${"c".repeat(64)}`, report: { schema: "lastwish.integrity.v1", chain: { id: 84532 }, vault: { address: "0x1111111111111111111111111111111111111111", observedBlockNumber: "44" }, keeperHub: { workflows: [] }, audit: { state: "stale" }, verification: { status: "recovery_required" } } }).verificationStatus).toBe("recovery_required");
  });

  it("fails closed on malformed responses", () => {
    expect(() => parseIntegritySummary({ reportHash: "bad" })).toThrow(/invalid integrity/i);
  });

  it("loads the current vault through the free local endpoint", async () => {
    const fetcher = async () => new Response(JSON.stringify({ reportHash: `0x${"b".repeat(64)}`, report: { schema: "lastwish.integrity.v1", chain: { id: 84532 }, vault: { address: "0x1111111111111111111111111111111111111111", observedBlockNumber: "43" }, keeperHub: { workflows: [] }, audit: { state: "fresh" }, verification: { status: "verified" } } }));
    expect(await loadIntegritySummary(84532, "0x1111111111111111111111111111111111111111", fetcher as typeof fetch)).toMatchObject({ observedBlockNumber: "43" });
  });
});
