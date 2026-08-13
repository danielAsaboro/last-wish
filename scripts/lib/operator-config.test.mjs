import { describe, expect, it } from "vitest";

import { buildCreateWorkflowArguments, buildListWorkflowArguments, buildListingUpdateArguments, mcpAuthorization, operatorConfig, publicationConfig } from "./operator-config.mjs";

describe("KeeperHub operator config", () => {
  it("parses an explicit public endpoint and marketplace price", () => {
    expect(operatorConfig({ LASTWISH_PUBLIC_URL: "https://lastwish.example", KEEPERHUB_REPORT_PRICE: "0.10" })).toEqual({ price: "0.10", publicUrl: "https://lastwish.example" });
  });

  it("rejects private endpoints and ambiguous prices", () => {
    expect(() => operatorConfig({ LASTWISH_PUBLIC_URL: "http://localhost:3000", KEEPERHUB_REPORT_PRICE: "free" })).toThrow();
  });

  it("uses an explicit MCP token or the organization API key without exposing either", () => {
    expect(mcpAuthorization({ KEEPERHUB_MCP_ACCESS_TOKEN: "oauth-token", KEEPERHUB_API_KEY: "kh-key" })).toBe("Bearer oauth-token");
    expect(mcpAuthorization({ KEEPERHUB_API_KEY: "kh-key" })).toBe("Bearer kh-key");
    expect(() => mcpAuthorization({})).toThrow(/credential/i);
  });

  it("builds current MCP create and listing arguments", () => {
    const definition = { name: "Report", description: "key", enabled: false, nodes: [], edges: [] };
    const listing = { slug: "report", category: "monitoring", workflowType: "read", inputSchema: { type: "object" }, outputMapping: { report: "ref" }, priceUsdcPerCall: "0.10" };
    expect(buildCreateWorkflowArguments(definition)).toEqual({ ...definition, idempotency_key: "lastwish-vault-integrity-report-v1" });
    expect(buildListingUpdateArguments("wf_1", listing)).toEqual({ workflowId: "wf_1", category: "monitoring", workflowType: "read", inputSchema: { type: "object" }, outputMapping: { report: "ref" }, priceUsdcPerCall: "0.10" });
    expect(buildListWorkflowArguments("wf_1", listing)).toEqual({ workflowId: "wf_1", slug: "report", category: "monitoring", workflowType: "read", inputSchema: { type: "object" }, outputMapping: { report: "ref" } });
  });

  it("requires a verified test vault before publication can run its read-only smoke", () => {
    expect(publicationConfig({ LASTWISH_REPORT_TEST_CHAIN_ID: "84532", LASTWISH_REPORT_TEST_VAULT: "0x1111111111111111111111111111111111111111" })).toEqual({ chainId: 84532, vault: "0x1111111111111111111111111111111111111111" });
    expect(() => publicationConfig({ LASTWISH_REPORT_TEST_CHAIN_ID: "1", LASTWISH_REPORT_TEST_VAULT: "bad" })).toThrow(/test vault/i);
  });
});
