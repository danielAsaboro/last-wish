import { z } from "zod";

const responseSchema = z.object({
  reportHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  report: z.object({
    schema: z.literal("lastwish.integrity.v1"),
    chain: z.object({ id: z.union([z.literal(84532), z.literal(11155111)]) }),
    vault: z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), observedBlockNumber: z.string().regex(/^\d+$/) }),
    keeperHub: z.object({ workflows: z.array(z.unknown()) }),
    audit: z.object({ state: z.enum(["fresh", "stale", "indexing", "idle"]) }),
    verification: z.object({ status: z.enum(["verified", "incomplete", "recovery_required"]) }),
  }),
});

export type IntegritySummary = ReturnType<typeof parseIntegritySummary>;

export async function loadIntegritySummary(chainId: number, vault: string, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const response = await fetcher(`/api/integrity-report?chainId=${encodeURIComponent(chainId)}&vault=${encodeURIComponent(vault)}`, { signal, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Integrity report is unavailable.");
  return parseIntegritySummary(body);
}

export function parseIntegritySummary(input: unknown) {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid integrity report response.");
  return {
    chainId: parsed.data.report.chain.id,
    vaultAddress: parsed.data.report.vault.address,
    reportHash: parsed.data.reportHash,
    observedBlockNumber: parsed.data.report.vault.observedBlockNumber,
    workflowCount: parsed.data.report.keeperHub.workflows.length,
    auditState: parsed.data.report.audit.state,
    verificationStatus: parsed.data.report.verification.status,
  };
}
