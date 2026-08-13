const protocolVersion = "2025-06-18";
const sensitiveKeys = /authorization|private.?key|secret|signature|token|hmac/i;

export async function callHttpMcpTool({ endpoint, tool, arguments: args = {}, fetcher = fetch, authorization }) {
  let id = 1;
  const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) };
  const initialized = await rpcFetch(fetcher, endpoint, headers, { jsonrpc: "2.0", id: id++, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "lastwish-operator", version: "1.0.0" } } });
  const session = initialized.response.headers.get("mcp-session-id");
  const sessionHeaders = { ...headers, ...(session ? { "mcp-session-id": session } : {}) };
  await fetcher(endpoint, { method: "POST", headers: sessionHeaders, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const listed = await rpcFetch(fetcher, endpoint, sessionHeaders, { jsonrpc: "2.0", id: id++, method: "tools/list", params: {} });
  if (!listed.body?.result?.tools?.some((candidate) => candidate.name === tool)) throw new Error(`KeeperHub MCP tool is unavailable: ${tool}`);
  const called = await rpcFetch(fetcher, endpoint, sessionHeaders, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: tool, arguments: args } });
  if (called.body.error || called.body.result?.isError) throw new Error("KeeperHub MCP tool failed.");
  return called.body.result;
}

export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKeys.test(key) ? "[REDACTED]" : redactEvidence(item)]));
}

export function parseMcpToolJson(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result?.content?.find?.((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (!text) throw new Error("KeeperHub MCP tool omitted structured JSON output.");
  try { return JSON.parse(text); } catch { throw new Error("KeeperHub MCP tool did not return valid JSON."); }
}

async function rpcFetch(fetcher, endpoint, headers, message) {
  const response = await fetcher(endpoint, { method: "POST", headers, body: JSON.stringify(message) });
  const text = await response.text();
  if (!response.ok) throw new Error(`KeeperHub MCP request failed with HTTP ${response.status}.`);
  const body = parseMcpResponse(text, response.headers.get("content-type"));
  return { response, body };
}

function parseMcpResponse(text, contentType) {
  if (!text) return {};
  if (contentType?.includes("text/event-stream")) {
    const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find((line) => line && line !== "[DONE]");
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(text);
}
