#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

import { buildIntegrityReportWorkflow, integrityListingConfig } from "../src/lib/keeperhub/integrity-workflow";
import { callHttpMcpTool, parseMcpToolJson, redactEvidence } from "./lib/mcp-client.mjs";
import { buildCreateWorkflowArguments, buildListWorkflowArguments, buildListingUpdateArguments, mcpAuthorization, operatorConfig, publicationConfig } from "./lib/operator-config.mjs";

nextEnv.loadEnvConfig(process.cwd());

const command = process.argv[2] ?? "validate";
const config = operatorConfig();
const definition = buildIntegrityReportWorkflow(config.publicUrl);
const listing = integrityListingConfig({ price: config.price });
const authorization = mcpAuthorization();
const endpoint = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp";

if (!["validate", "publish", "inspect"].includes(command)) throw new Error("Use validate, publish, or inspect.");

let result: unknown;
if (command === "validate") {
  const [systemSchemas, triggerSchemas] = await Promise.all([
    mcpJson("list_action_schemas", { category: "system", includeChains: false }),
    mcpJson("list_action_schemas", { category: "triggers", includeChains: false }),
  ]);
  assertCurrentSchemas(systemSchemas, triggerSchemas);
  result = { valid: true, mode: "read_only_schema_preflight", definition, listing };
} else if (command === "inspect") {
  const cli = spawnSync("kh", ["auth", "status"], { encoding: "utf8" });
  if (cli.error?.message.includes("ENOENT")) throw new Error("KeeperHub CLI `kh` is required. Install it with `brew install keeperhub/tap/kh`.");
  if (cli.status !== 0) throw new Error("KeeperHub CLI authentication is unavailable.");
  const workflows = spawnSync("kh", ["workflow", "list", "--json"], { encoding: "utf8" });
  if (workflows.status !== 0) throw new Error("KeeperHub CLI workflow inspection failed.");
  const [search, marketplace] = await Promise.all([
    callHttpMcpTool({ endpoint, tool: "search_workflows", arguments: { query: listing.slug, workflowType: "read" }, authorization }),
    callHttpMcpTool({ endpoint, tool: "get_workflow_listing", arguments: { slug: listing.slug }, authorization }),
  ]);
  result = { cli: JSON.parse(workflows.stdout), search, marketplace };
} else {
  if (!process.argv.includes("--apply")) throw new Error("Publication changes external state. Re-run publish with --apply after reviewing the workflow and dual-protocol price.");
  const smoke = publicationConfig();
  if (!smoke.vault) throw new Error("A factory-verified test vault is required for publication.");
  const existing = workflowRows(await mcpJson("list_workflows", {})).find((workflow) => workflow.description === definition.description);
  if (existing?.isListed === true) throw new Error("The existing report workflow is already listed. Inspect it before making any marketplace change.");
  if (existing && !workflowDefinitionMatches(existing, definition)) throw new Error("The existing report workflow definition differs from the reviewed local definition.");
  const created = existing ? undefined : await mcpJson("create_workflow", buildCreateWorkflowArguments(definition));
  const workflowId = existing?.id ?? extractWorkflowId(created);
  const validation = await mcpJson("validate_workflow", { workflowId, deepCheck: false });
  if (!validationSucceeded(validation)) throw new Error("KeeperHub rejected the persisted report workflow definition.");
  const execution = await mcpJson("execute_workflow", {
    workflowId,
    input: smoke,
    idempotency_key: `lastwish-integrity-smoke-v1:${smoke.chainId}:${smoke.vault.toLowerCase()}`,
  });
  const executionId = extractExecutionId(execution);
  const terminal = await waitForSuccessfulReport(executionId);
  const listingUpdate = await mcpJson("update_workflow_listing", buildListingUpdateArguments(workflowId, listing));
  const activated = await mcpJson("update_workflow", { workflowId, enabled: true });
  const published = await mcpJson("list_workflow", buildListWorkflowArguments(workflowId, listing));
  const readback = await mcpJson("get_workflow_listing", { slug: listing.slug });
  assertListingReadback(readback, listing);
  result = { workflowId, executionId, created, validation, terminal, listingUpdate, activated, published, readback };
}
process.stdout.write(`${JSON.stringify(redactEvidence({ command, definition, listing, result }), null, 2)}\n`);

async function mcpJson(tool: string, args: Record<string, unknown>) {
  return parseMcpToolJson(await callHttpMcpTool({ endpoint, tool, arguments: args, authorization }));
}

function assertCurrentSchemas(system: unknown, triggers: unknown) {
  const systemRecord = record(system);
  const triggerRecord = record(triggers);
  const http = record(record(systemRecord.actions)["HTTP Request"]);
  const required = record(http.requiredFields);
  if (http.actionType !== "HTTP Request" || !("endpoint" in required) || !("httpMethod" in required)) throw new Error("KeeperHub HTTP Request schema does not match the reviewed definition.");
  if (record(record(triggerRecord.triggers).Manual).triggerType !== "Manual") throw new Error("KeeperHub Manual trigger schema is unavailable.");
}

function workflowRows(input: unknown): Array<Record<string, unknown>> {
  const object = record(input);
  const candidate = Array.isArray(input) ? input : Array.isArray(object.workflows) ? object.workflows : Array.isArray(object.data) ? object.data : [];
  return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function workflowDefinitionMatches(workflow: Record<string, unknown>, expected: typeof definition) {
  return workflow.name === expected.name && workflow.description === expected.description && JSON.stringify(workflow.nodes) === JSON.stringify(expected.nodes) && JSON.stringify(workflow.edges) === JSON.stringify(expected.edges);
}

function extractWorkflowId(input: unknown): string {
  const object = record(input);
  const nested = record(object.workflow);
  const id = typeof object.workflowId === "string" ? object.workflowId : typeof object.id === "string" ? object.id : typeof nested.id === "string" ? nested.id : undefined;
  if (!id) throw new Error("KeeperHub create_workflow response omitted workflowId.");
  return id;
}

function extractExecutionId(input: unknown): string {
  const object = record(input);
  const id = typeof object.executionId === "string" ? object.executionId : typeof object.id === "string" ? object.id : undefined;
  if (!id) throw new Error("KeeperHub execute_workflow response omitted executionId.");
  return id;
}

function validationSucceeded(input: unknown): boolean {
  const object = record(input);
  const resultRecord = record(object.result);
  return object.valid === true || resultRecord.valid === true;
}

async function waitForSuccessfulReport(executionId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const execution = await mcpJson("get_execution", { executionId, includeData: true, nodeIds: ["report"], truncateData: 65_536 });
    const status = findString(execution, "status");
    if (status === "success" || status === "completed") {
      if (!/^0x[a-f0-9]{64}$/i.test(findString(execution, "reportHash") ?? "")) throw new Error("The report smoke completed without a valid report hash.");
      return execution;
    }
    if (["error", "failed", "cancelled", "system_error"].includes(status ?? "")) throw new Error("The report smoke execution failed.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("The report smoke execution did not reach a terminal state.");
}

function assertListingReadback(input: unknown, expected: typeof listing) {
  const serialized = JSON.stringify(input);
  if (!serialized.includes(expected.slug) || !serialized.includes(expected.priceUsdcPerCall)) throw new Error("KeeperHub listing readback did not preserve the reviewed slug and price.");
}

function findString(input: unknown, key: string): string | undefined {
  if (Array.isArray(input)) {
    for (const item of input) { const found = findString(item, key); if (found) return found; }
    return undefined;
  }
  if (!input || typeof input !== "object") return undefined;
  const object = input as Record<string, unknown>;
  if (typeof object[key] === "string") return object[key];
  for (const value of Object.values(object)) { const found = findString(value, key); if (found) return found; }
  return undefined;
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}
