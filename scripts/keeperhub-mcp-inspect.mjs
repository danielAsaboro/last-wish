#!/usr/bin/env node
import nextEnv from "@next/env";

import { callHttpMcpTool, redactEvidence } from "./lib/mcp-client.mjs";

nextEnv.loadEnvConfig(process.cwd());

const slug = argument("--slug") ?? "lastwish-vault-integrity-report";
const credential = process.env.KEEPERHUB_MCP_ACCESS_TOKEN || process.env.KEEPERHUB_API_KEY;
if (!credential) throw new Error("A KeeperHub MCP credential is required.");
const authorization = `Bearer ${credential}`;
const endpoint = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp";

const search = await callHttpMcpTool({ endpoint, tool: "search_workflows", arguments: { query: slug }, authorization });
const listing = await callHttpMcpTool({ endpoint, tool: "get_workflow_listing", arguments: { slug }, authorization })
  .catch(() => ({ state: "unavailable", reason: "No readable marketplace listing exists for this slug." }));
process.stdout.write(`${JSON.stringify(redactEvidence({ surface: "hosted_mcp", endpoint, slug, search, listing }), null, 2)}\n`);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
