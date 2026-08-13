import { describe, expect, it } from "vitest";

import { buildIntegrityReportWorkflow, integrityListingConfig } from "./integrity-workflow";

describe("integrity report KeeperHub workflow", () => {
  it("builds a manual, read-only HTTP workflow for a public HTTPS endpoint", () => {
    const workflow = buildIntegrityReportWorkflow("https://lastwish.example");
    expect(workflow.enabled).toBe(false);
    expect(workflow.nodes[0].data.config).toMatchObject({ triggerType: "Manual" });
    expect(workflow.nodes[1].data.config).toMatchObject({ actionType: "HTTP Request", httpMethod: "POST", endpoint: "https://lastwish.example/api/integrity-report", failOnError: true });
    expect(workflow.nodes[1].data.config.httpBody).toContain("{{@manual:Report request.chainId}}");
    expect(workflow.nodes[1].data.config.httpBody).toContain("{{@manual:Report request.vault}}");
    expect(JSON.stringify(workflow)).not.toMatch(/web3\/write-contract|private.?key|payment/i);
  });

  it("rejects localhost and insecure publication endpoints", () => {
    expect(() => buildIntegrityReportWorkflow("http://localhost:3000")).toThrow(/public https/i);
    expect(() => buildIntegrityReportWorkflow("https://127.0.0.1:3000")).toThrow(/public https/i);
  });

  it("builds current marketplace metadata without inventing payment rails or a recipient", () => {
    const listing = integrityListingConfig({ price: "0.10" });
    expect(listing).toMatchObject({
      slug: "lastwish-vault-integrity-report",
      category: "monitoring",
      workflowType: "read",
      priceUsdcPerCall: "0.10",
    });
    expect(listing.inputSchema.required).toEqual(["chainId", "vault"]);
    expect(listing.outputMapping).toEqual({ report: "{{@report:Generate integrity report.data.report}}", reportHash: "{{@report:Generate integrity report.data.reportHash}}" });
    expect(listing).not.toHaveProperty("payments");
    expect(listing).not.toHaveProperty("recipient");
  });
});
