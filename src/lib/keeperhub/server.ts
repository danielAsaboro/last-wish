import { z } from "zod";

import { parseEnabledChains, parseWorkflowExecutions, type KeeperHubChain, type KeeperHubWorkflowExecution } from "./client";
import { parseWorkflowSimulation, type KeeperHubWorkflowSimulation } from "./simulation";
import type { KeeperHubWorkflowDefinition } from "./workflow";

const DEFAULT_BASE_URL = "https://app.keeperhub.com";

type ClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export type ContractCallRequest = {
  contractAddress: `0x${string}`;
  chainId: number;
  functionName: string;
  functionArgs: string;
  abi: string;
  simulate?: boolean;
};

const workflowSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().transform((value) => value ?? undefined),
  createdAt: z.string(),
  enabled: z.boolean(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  deletedAt: z.string().nullable(),
  deactivatedAt: z.string().nullable(),
});

export type KeeperHubWorkflowSummary = z.infer<typeof workflowSummarySchema>;
export type KeeperHubIntegrationSummary = { id: string; name: string; type: string; address: string | null; isManaged?: boolean };

export class KeeperHubClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetcher = fetch }: ClientOptions) {
    if (!apiKey) throw new Error("KEEPERHUB_API_KEY is not configured");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetcher = fetcher;
  }

  async getChains(): Promise<KeeperHubChain[]> {
    const { body } = await this.request("/api/chains");
    return parseEnabledChains(body);
  }

  async createWorkflow(definition: KeeperHubWorkflowDefinition, idempotencyKey: string): Promise<Record<string, unknown>> {
    const { body } = await this.request("/api/workflows/create", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(definition),
    });
    return unwrapData(body) as Record<string, unknown>;
  }

  async listWorkflows(): Promise<KeeperHubWorkflowSummary[]> {
    const { body } = await this.request("/api/workflows");
    const candidate = unwrapData(body);
    const parsed = z.array(workflowSummarySchema).safeParse(candidate);
    if (!parsed.success) throw new Error("KeeperHub returned an invalid workflow list.");
    return parsed.data;
  }

  async listIntegrations(): Promise<KeeperHubIntegrationSummary[]> {
    const { body } = await this.request("/api/integrations");
    const candidate = unwrapData(body);
    if (!Array.isArray(candidate)) throw new Error("KeeperHub returned an invalid integration list.");
    return candidate.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const { id, name, type, address, isManaged } = item as Record<string, unknown>;
      return typeof id === "string" && typeof name === "string" && typeof type === "string" && (typeof address === "string" || address === null || address === undefined)
        ? [{ id, name, type, address: typeof address === "string" ? address : null, ...(typeof isManaged === "boolean" ? { isManaged } : {}) }]
        : [];
    });
  }

  async simulateWorkflow(workflowId: string): Promise<KeeperHubWorkflowSimulation> {
    const { body } = await this.request(`/api/workflows/${encodeURIComponent(workflowId)}/simulate`, {
      method: "POST",
    });
    if (typeof body === "object" && body !== null && "ok" in body) {
      const response = body as { ok: unknown; result?: unknown; error?: unknown };
      if (response.ok !== true || typeof response.result !== "object" || response.result === null) {
        const error = typeof response.error === "string" ? response.error.replaceAll("_", " ").toLowerCase() : "invalid response";
        throw new Error(`KeeperHub workflow simulation unavailable: ${error}.`);
      }
      return parseWorkflowSimulation(response.result);
    }
    const legacy = unwrapData(body);
    if (typeof legacy !== "object" || legacy === null) throw new Error("KeeperHub returned an invalid workflow simulation response.");
    return parseWorkflowSimulation(legacy);
  }

  async updateWorkflow(workflowId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { body } = await this.request(`/api/workflows/${encodeURIComponent(workflowId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return unwrapData(body) as Record<string, unknown>;
  }

  async listWorkflowExecutions(workflowId: string): Promise<KeeperHubWorkflowExecution[]> {
    const { body } = await this.request(`/api/workflows/${encodeURIComponent(workflowId)}/executions`);
    return parseWorkflowExecutions(body);
  }

  async getWorkflowExecutionLogs(executionId: string): Promise<unknown> {
    const { body } = await this.request(`/api/workflows/executions/${encodeURIComponent(executionId)}/logs`);
    return unwrapData(body);
  }

  async contractCall(request: ContractCallRequest, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const { body } = await this.request("/api/execute/contract-call", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(request),
    }, request.simulate === true);
    return body as Record<string, unknown>;
  }

  async getExecution(executionId: string): Promise<{ execution: Record<string, unknown>; pollAfterMs?: number }> {
    const { body, response } = await this.request(`/api/execute/${encodeURIComponent(executionId)}/status`);
    const hint = response.headers.get("X-Poll-Interval-Hint");
    return {
      execution: unwrapData(body) as Record<string, unknown>,
      pollAfterMs: hint && Number.isFinite(Number(hint)) ? Number(hint) : undefined,
    };
  }

  private async request(
    path: string,
    init: RequestInit = {},
    acceptSimulationRevert = false,
  ): Promise<{ body: unknown; response: Response }> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => ({ error: "KeeperHub returned a non-JSON response" }));
    const isDecodedSimulationRevert =
      acceptSimulationRevert &&
      typeof body === "object" &&
      body !== null &&
      "wouldRevert" in body &&
      body.wouldRevert === true;
    if (!response.ok && !isDecodedSimulationRevert) {
      const message =
        typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
          ? body.error
          : `KeeperHub request failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return { body, response };
  }
}

function unwrapData(body: unknown): unknown {
  return typeof body === "object" && body !== null && "data" in body
    ? (body as { data: unknown }).data
    : body;
}

export function keeperHubClientFromEnv(): KeeperHubClient {
  return new KeeperHubClient({
    apiKey: process.env.KEEPERHUB_API_KEY ?? "",
    baseUrl: process.env.KEEPERHUB_BASE_URL,
  });
}
