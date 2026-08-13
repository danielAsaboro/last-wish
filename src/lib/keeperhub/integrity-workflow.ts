import { z } from "zod";

import type { KeeperHubWorkflowDefinition } from "./workflow";

const listingInput = z.object({
  price: z.string().regex(/^\d+(?:\.\d{1,6})?$/).refine((value) => Number(value) > 0),
});

export const integrityReportInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chainId", "vault"],
  properties: {
    chainId: { type: "integer", enum: [84532, 11155111] },
    vault: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
  },
} as const;

export const integrityReportOutputMapping = {
  report: "{{@report:Generate integrity report.data.report}}",
  reportHash: "{{@report:Generate integrity report.data.reportHash}}",
} as const;

export function buildIntegrityReportWorkflow(applicationUrl: string): KeeperHubWorkflowDefinition {
  const endpoint = publicIntegrityEndpoint(applicationUrl);
  return {
    name: "LastWish · Vault Integrity Report",
    description: "Read-only, factory-proven vault integrity evidence. Inputs: chainId and vault. Listing key: lastwish-vault-integrity-report:v1",
    enabled: false,
    nodes: [
      {
        id: "manual",
        type: "trigger",
        data: {
          type: "trigger",
          label: "Report request",
          config: {
            triggerType: "Manual",
          },
        },
      },
      {
        id: "report",
        type: "action",
        data: {
          type: "action",
          label: "Generate integrity report",
          config: {
            actionType: "HTTP Request",
            httpMethod: "POST",
            endpoint,
            httpHeaders: JSON.stringify({ "Content-Type": "application/json" }),
            httpBody: JSON.stringify({ chainId: "{{@manual:Report request.chainId}}", vault: "{{@manual:Report request.vault}}" }),
            timeout: 30,
            failOnError: true,
          },
        },
      },
    ],
    edges: [{ id: "manual-report", source: "manual", target: "report" }],
  };
}

export function integrityListingConfig(raw: { price: string }) {
  const input = listingInput.parse(raw);
  return {
    slug: "lastwish-vault-integrity-report",
    category: "monitoring",
    workflowType: "read" as const,
    inputSchema: integrityReportInputSchema,
    outputMapping: integrityReportOutputMapping,
    priceUsdcPerCall: input.price,
  };
}

function publicIntegrityEndpoint(applicationUrl: string) {
  const url = new URL(applicationUrl);
  const privateHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname.endsWith(".local");
  if (url.protocol !== "https:" || privateHost) throw new Error("KeeperHub publication requires a public HTTPS application URL.");
  return new URL("/api/integrity-report", url).toString();
}
