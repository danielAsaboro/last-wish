import { beforeEach, describe, expect, it, vi } from "vitest";

const { assemble } = vi.hoisted(() => ({ assemble: vi.fn() }));
vi.mock("@/lib/integrity/runtime", () => ({ assembleVaultIntegrityReportFromEnv: assemble }));

import { GET, POST } from "./route";

const vault = "0x1111111111111111111111111111111111111111";

describe("integrity report route", () => {
  beforeEach(() => assemble.mockReset().mockResolvedValue({ report: { schema: "lastwish.integrity.v1" }, reportHash: `0x${"a".repeat(64)}` }));

  it("supports equivalent GET and POST inputs", async () => {
    const get = await GET(new Request(`https://lastwish.example/api/integrity-report?chainId=84532&vault=${vault}`));
    const post = await POST(new Request("https://lastwish.example/api/integrity-report", { method: "POST", body: JSON.stringify({ chainId: 84532, vault }) }));
    expect(await get.json()).toEqual(await post.json());
    expect(get.headers.get("cache-control")).toContain("no-store");
  });

  it("returns a structured 400 for malformed input", async () => {
    const response = await POST(new Request("https://lastwish.example/api/integrity-report", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects zero addresses, unknown fields, and oversized bodies", async () => {
    const zero = await POST(new Request("https://lastwish.example/api/integrity-report", { method: "POST", body: JSON.stringify({ chainId: 84532, vault: "0x0000000000000000000000000000000000000000" }) }));
    expect(zero.status).toBe(400);
    const unknown = await GET(new Request(`https://lastwish.example/api/integrity-report?chainId=84532&vault=${vault}&rpcUrl=https://attacker.example`));
    expect(unknown.status).toBe(400);
    const oversized = await POST(new Request("https://lastwish.example/api/integrity-report", { method: "POST", body: JSON.stringify({ chainId: 84532, vault, padding: "x".repeat(2_000) }) }));
    expect(oversized.status).toBe(413);
    expect(assemble).not.toHaveBeenCalled();
  });

  it("fails closed when report assembly fails", async () => {
    assemble.mockImplementationOnce(async () => { throw new Error("https://rpc.example/private-token factory mismatch"); });
    const response = await GET(new Request(`https://lastwish.example/api/integrity-report?chainId=84532&vault=${vault}`));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "REPORT_UNAVAILABLE" } });
    expect(JSON.stringify(body)).not.toContain("private-token");
  });
});
