import { z } from "zod";

import { assembleVaultIntegrityReportFromEnv } from "@/lib/integrity/runtime";

const requestSchema = z.object({
  chainId: z.coerce.number().int(),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/i.test(value), "Vault address must be nonzero."),
}).strict();
const noStore = { "Cache-Control": "no-store, max-age=0" };
const maxRequestBytes = 1_024;

export async function GET(request: Request) {
  const url = new URL(request.url);
  return respond(Object.fromEntries(url.searchParams.entries()));
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxRequestBytes) {
    return Response.json({ error: { code: "REQUEST_TOO_LARGE", message: "Integrity report requests must be 1 KiB or smaller." } }, { status: 413, headers: noStore });
  }
  let input: unknown;
  try { input = JSON.parse(raw); } catch { input = null; }
  return respond(input);
}

async function respond(input: unknown) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Provide a supported chainId and EVM vault address.", issues: parsed.error.issues } }, { status: 400, headers: noStore });
  try {
    return Response.json(await assembleVaultIntegrityReportFromEnv(parsed.data), { headers: noStore });
  } catch {
    return Response.json({ error: { code: "REPORT_UNAVAILABLE", message: "The integrity report could not be assembled from current verified sources." } }, { status: 502, headers: noStore });
  }
}
