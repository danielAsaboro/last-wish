import { describe, expect, it, vi } from "vitest";

import { callHttpMcpTool, parseMcpToolJson, redactEvidence } from "./mcp-client.mjs";

describe("KeeperHub MCP client", () => {
  it("initializes, lists, and calls tools over Streamable HTTP", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }), { headers: { "mcp-session-id": "session-1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search_workflows" }] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ok" }] } })));
    const result = await callHttpMcpTool({ endpoint: "https://app.keeperhub.com/mcp", tool: "search_workflows", arguments: { query: "LastWish" }, fetcher });
    expect(result.content[0].text).toBe("ok");
    expect(fetcher.mock.calls[3][1].headers["mcp-session-id"]).toBe("session-1");
  });

  it("redacts sensitive keys recursively", () => {
    expect(redactEvidence({ authorization: "Bearer secret", accessToken: "secret", hmacSecret: "secret", payment: { signature: "secret", receiptId: "public" } })).toEqual({ authorization: "[REDACTED]", accessToken: "[REDACTED]", hmacSecret: "[REDACTED]", payment: { signature: "[REDACTED]", receiptId: "public" } });
  });

  it("does not reflect upstream response bodies in MCP transport errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Bearer secret at https://rpc.example/private-token", { status: 502 }));
    await expect(callHttpMcpTool({ endpoint: "https://app.keeperhub.com/mcp", tool: "search_workflows", fetcher })).rejects.toThrow("KeeperHub MCP request failed with HTTP 502.");
  });

  it("parses structured or text MCP tool results and rejects malformed output", () => {
    expect(parseMcpToolJson({ structuredContent: { workflows: [] } })).toEqual({ workflows: [] });
    expect(parseMcpToolJson({ content: [{ type: "text", text: JSON.stringify({ valid: true }) }] })).toEqual({ valid: true });
    expect(() => parseMcpToolJson({ content: [{ type: "text", text: "not-json" }] })).toThrow(/valid json/i);
  });
});
