import { parseEnabledChains, parseWorkflowExecutions, type KeeperHubChain, type KeeperHubWorkflowExecution } from "./client";
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

  async createWorkflow(definition: KeeperHubWorkflowDefinition): Promise<Record<string, unknown>> {
    const { body } = await this.request("/api/workflows", {
      method: "POST",
      body: JSON.stringify(definition),
    });
    return body as Record<string, unknown>;
  }

  async simulateWorkflow(workflowId: string): Promise<Record<string, unknown>> {
    const { body } = await this.request(`/api/workflows/${encodeURIComponent(workflowId)}/simulate`, {
      method: "POST",
    });
    return body as Record<string, unknown>;
  }

  async updateWorkflow(workflowId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { body } = await this.request(`/api/workflows/${encodeURIComponent(workflowId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return body as Record<string, unknown>;
  }

  async listWorkflowExecutions(workflowId: string): Promise<KeeperHubWorkflowExecution[]> {
    const { body } = await this.request(`/api/workflows/${encodeURIComponent(workflowId)}/executions`);
    return parseWorkflowExecutions(body);
  }

  async getWorkflowExecutionLogs(executionId: string): Promise<unknown> {
    const { body } = await this.request(`/api/workflows/executions/${encodeURIComponent(executionId)}/logs`);
    return body;
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
      execution: body as Record<string, unknown>,
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

export function keeperHubClientFromEnv(): KeeperHubClient {
  return new KeeperHubClient({
    apiKey: process.env.KEEPERHUB_API_KEY ?? "",
    baseUrl: process.env.KEEPERHUB_BASE_URL,
  });
}
