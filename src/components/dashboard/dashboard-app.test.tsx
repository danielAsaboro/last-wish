import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vault = "0x2222222222222222222222222222222222222222" as const;
const owner = "0x1111111111111111111111111111111111111111" as const;
const otherAccount = "0x3333333333333333333333333333333333333333" as const;

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS = "0x5555555555555555555555555555555555555555";
  return {
    account: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    chainId: 84532,
    invalidVault: undefined as string | undefined,
    getBlock: vi.fn(),
    readContract: vi.fn(),
    getBalance: vi.fn(),
    getContractEvents: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    signMessage: vi.fn(),
    writeContract: vi.fn(),
    sendTransaction: vi.fn(),
    connectAsync: vi.fn(),
    switchChain: vi.fn(),
  };
});

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account, chainId: mocks.chainId, isConnected: true }),
  useConnect: () => ({
    connectors: [{ type: "injected", getProvider: async () => ({}) }],
    connectAsync: mocks.connectAsync,
  }),
  useSwitchChain: () => ({ switchChain: mocks.switchChain }),
  useWalletClient: () => ({ data: { signMessage: mocks.signMessage, writeContract: mocks.writeContract, sendTransaction: mocks.sendTransaction } }),
  usePublicClient: () => ({
    getBlock: mocks.getBlock,
    readContract: mocks.readContract,
    getBalance: mocks.getBalance,
    getContractEvents: mocks.getContractEvents,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  }),
}));

vi.mock("@/lib/wallet/config", () => ({ preferredChain: { id: 84532, name: "Base Sepolia" } }));

import { DashboardApp, PolicyEditor } from "./dashboard-app";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("DashboardApp async action identity", () => {
  let intervalCallbacks: Array<() => void>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let latestBlockCall: number;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("lastwish:vault:84532", vault);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    mocks.account = owner;
    mocks.chainId = 84532;
    mocks.invalidVault = undefined;
    latestBlockCall = 0;
    intervalCallbacks = [];
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      intervalCallbacks.push(handler as () => void);
      return intervalCallbacks.length as unknown as NodeJS.Timeout;
    });
    mocks.getBlock.mockReset().mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return { number: 100n, timestamp: 1_800_000_000n };
      }
      return { number: input.blockNumber ?? 100n, timestamp: 1_800_000_000n };
    });
    mocks.readContract.mockReset().mockImplementation(async (input: { address?: string; functionName: string; blockNumber?: bigint }) => {
      if (mocks.invalidVault && input.address?.toLowerCase() === mocks.invalidVault.toLowerCase()) throw new Error("No contract code at this address");
      switch (input.functionName) {
        case "owner": return owner;
        case "guardian": return otherAccount;
        case "policyVersion": return input.blockNumber === 102n ? 2n : 1n;
        case "status": return 0;
        case "beneficiaryCount": return 0n;
        case "heartbeatInterval": return 2_592_000n;
        case "gracePeriod": return 1_209_600n;
        case "lastHeartbeat": return 1_799_900_000n;
        case "pendingAt": return 0n;
        case "deployedAtBlock": return 1n;
        case "vaultOf": return vault;
        default: throw new Error(`Unexpected read ${input.functionName}`);
      }
    });
    mocks.getBalance.mockReset().mockResolvedValue(1n);
    mocks.getContractEvents.mockReset().mockResolvedValue([]);
    mocks.waitForTransactionReceipt.mockReset();
    mocks.signMessage.mockReset();
    mocks.writeContract.mockReset();
    mocks.sendTransaction.mockReset();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keeperhub/readiness")) {
        return json({ status: "ready", nextStep: "KeeperHub is ready." });
      }
      if (url.includes("/api/keeperhub/evidence")) {
        const policyVersion = latestBlockCall >= 3 ? "2" : "1";
        return json({ configured: true, chainId: 84532, vault, policyVersion, workflows: [], executionEvidenceScope: "recent_keeperhub_window_only", evidence: [] });
      }
      if (url.includes("/api/keeperhub/workflows")) {
        return json({ workflows: [{ workflowId: "wf_open" }, { workflowId: "wf_finalize" }] }, 201);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not POST a registration when the connected account changes during signing", async () => {
    const signature = deferred<`0x${string}`>();
    mocks.signMessage.mockReturnValue(signature.promise);
    const { rerender } = render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /register keeperhub/i }));
    await waitFor(() => expect(mocks.signMessage).toHaveBeenCalledOnce());

    mocks.account = otherAccount;
    rerender(<DashboardApp />);
    await act(async () => { signature.resolve("0x1234"); await signature.promise; });

    await waitFor(() => expect(screen.queryByText(/confirm authorize keeperhub setup/i)).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/keeperhub/workflows"))).toHaveLength(0);
    expect(screen.queryByText(/registered \d+ workflows|condition-gated|exact enabled workflow pair/i)).not.toBeInTheDocument();
  });

  it("discards a late registration response after the connected account changes", async () => {
    const workflowResponse = deferred<Response>();
    mocks.signMessage.mockResolvedValue("0x1234");
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keeperhub/readiness")) return json({ status: "ready", nextStep: "KeeperHub is ready." });
      if (url.includes("/api/keeperhub/evidence")) {
        return json({ configured: true, chainId: 84532, vault, policyVersion: "1", workflows: [], executionEvidenceScope: "recent_keeperhub_window_only", evidence: [] });
      }
      if (url.includes("/api/keeperhub/workflows")) return workflowResponse.promise;
      throw new Error(`Unexpected fetch ${url}`);
    });
    const { rerender } = render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /register keeperhub/i }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/keeperhub/workflows"))).toHaveLength(1));

    mocks.account = otherAccount;
    rerender(<DashboardApp />);
    await act(async () => {
      workflowResponse.resolve(json({ workflows: [{ workflowId: "wf_open" }, { workflowId: "wf_finalize" }] }, 201));
      await workflowResponse.promise;
    });

    await waitFor(() => expect(screen.queryByText(/confirm authorize keeperhub setup/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/registered \d+ workflows|condition-gated|exact enabled workflow pair/i)).not.toBeInTheDocument();
  });

  it("closes a vault-A funding composer and renders an invalid replacement without sending value", async () => {
    render(<DashboardApp />);
    fireEvent.click(await screen.findByRole("button", { name: /fund vault/i }));
    expect(screen.getByText(vault)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/amount in eth/i), { target: { value: "0.5" } });

    mocks.invalidVault = otherAccount;
    fireEvent.change(screen.getByLabelText(/vault address/i), { target: { value: otherAccount } });
    fireEvent.click(screen.getByRole("button", { name: /load vault/i }));

    expect(screen.queryByRole("button", { name: /review in wallet/i })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /vault could not be verified/i })).toBeInTheDocument();
    expect(screen.queryByText(/^ACTIVE$/)).not.toBeInTheDocument();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps a newer same-vault policy snapshot when an older poll resolves last", async () => {
    const olderBlock = deferred<{ number: bigint; timestamp: bigint }>();
    const olderEvidence = deferred<Response>();
    let evidenceCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keeperhub/readiness")) return json({ status: "ready", nextStep: "KeeperHub is ready." });
      if (url.includes("/api/keeperhub/evidence")) {
        evidenceCalls += 1;
        if (evidenceCalls === 1) return olderEvidence.promise;
        return json({ configured: true, chainId: 84532, vault, policyVersion: "2", workflows: [], executionEvidenceScope: "recent_keeperhub_window_only", evidence: [] });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag !== "latest") return { number: input.blockNumber ?? 100n, timestamp: 1_800_000_000n };
      latestBlockCall += 1;
      if (latestBlockCall === 1) return { number: 100n, timestamp: 1_800_000_000n };
      if (latestBlockCall === 2) return olderBlock.promise;
      return { number: 102n, timestamp: 1_800_000_200n };
    });
    render(<DashboardApp />);
    expect(await screen.findByText("Policy v1")).toBeInTheDocument();
    await waitFor(() => expect(evidenceCalls).toBe(1));

    await act(async () => { intervalCallbacks[0]?.(); });
    await act(async () => { intervalCallbacks[0]?.(); });
    expect(await screen.findByText("Policy v2")).toBeInTheDocument();
    await waitFor(() => expect(evidenceCalls).toBe(2));

    await act(async () => {
      olderBlock.resolve({ number: 101n, timestamp: 1_800_000_100n });
      await olderBlock.promise;
      olderEvidence.resolve(json({
        configured: true,
        chainId: 84532,
        vault,
        policyVersion: "1",
        workflows: ["open", "finalize"].map((action) => ({
          workflowId: `wf_${action}`,
          name: action,
          policyVersion: "1",
          action,
          enabled: true,
          definitionMatches: true,
          registrationState: "current",
          coverage: { runsReturned: 0, providerWindow: "latest_50_non_purged", olderRunsMayExist: false, providerPagination: "unavailable" },
        })),
        executionEvidenceScope: "recent_keeperhub_window_only",
        evidence: [],
      }));
      await olderEvidence.promise;
      await Promise.resolve();
    });
    expect(screen.getByText("Policy v2")).toBeInTheDocument();
    expect(screen.queryByText("Policy v1")).not.toBeInTheDocument();
    expect(screen.queryByText(/keeperhub automation is healthy/i)).not.toBeInTheDocument();
  });
});

describe("PolicyEditor Copilot transparency", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the AI SDK explanation visible through the unsigned wallet review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      available: true,
      source: "ai",
      draft: {
        beneficiaries: [
          { label: "Ada", address: vault, shareBps: 6000 },
          { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
        ],
        heartbeatDays: 45,
        graceDays: 21,
        explanation: "A longer heartbeat reduces maintenance pressure while the three-week grace window preserves time for guardian review.",
      },
    })));

    render(<PolicyEditor owner={owner} mode="create" pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: otherAccount } });
    fireEvent.change(screen.getByLabelText("Beneficiary 1 label"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Beneficiary 1 address"), { target: { value: vault } });
    fireEvent.change(screen.getByLabelText("Beneficiary 2 label"), { target: { value: "Lin" } });
    fireEvent.change(screen.getByLabelText("Beneficiary 2 address"), { target: { value: "0x4444444444444444444444444444444444444444" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a conservative guardian review window." } });
    fireEvent.click(screen.getByRole("button", { name: /draft with copilot/i }));

    expect(await screen.findByText(/longer heartbeat reduces maintenance pressure/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-generated draft rationale/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/longer heartbeat reduces maintenance pressure/i)).toBeInTheDocument();
    expect(screen.getByText(/unsigned suggestion/i)).toBeInTheDocument();
  });

  it("keeps Copilot explicitly unavailable when the AI provider is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ available: false, error: "Policy Copilot is unavailable because no AI provider credential is configured." }, 503)));
    render(<PolicyEditor owner={owner} mode="create" pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: otherAccount } });
    for (const [label, value] of [
      ["Beneficiary 1 label", "Ada"], ["Beneficiary 1 address", vault],
      ["Beneficiary 2 label", "Lin"], ["Beneficiary 2 address", "0x4444444444444444444444444444444444444444"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a conservative window." } });
    fireEvent.click(screen.getByRole("button", { name: /draft with copilot/i }));
    expect(await screen.findByRole("button", { name: /copilot unavailable/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no AI provider credential/i);
  });

  it("removes stale AI rationale after a reviewed parameter is edited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      available: true,
      source: "ai",
      draft: {
        beneficiaries: [
          { label: "Ada", address: vault, shareBps: 6000 },
          { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
        ],
        heartbeatDays: 45,
        graceDays: 21,
        explanation: "A longer heartbeat reduces maintenance pressure while preserving guardian review time.",
      },
    })));
    render(<PolicyEditor owner={owner} mode="create" pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: otherAccount } });
    for (const [label, value] of [
      ["Beneficiary 1 label", "Ada"], ["Beneficiary 1 address", vault],
      ["Beneficiary 2 label", "Lin"], ["Beneficiary 2 address", "0x4444444444444444444444444444444444444444"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a conservative window." } });
    fireEvent.click(screen.getByRole("button", { name: /draft with copilot/i }));
    expect(await screen.findByText(/longer heartbeat reduces maintenance pressure/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/heartbeat interval/i), { target: { value: "60" } });
    expect(screen.queryByText(/longer heartbeat reduces maintenance pressure/i)).not.toBeInTheDocument();
  });

  it("removes stale AI rationale after the guardian is edited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      available: true,
      source: "ai",
      draft: {
        beneficiaries: [
          { label: "Ada", address: vault, shareBps: 6000 },
          { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
        ],
        heartbeatDays: 45,
        graceDays: 21,
        explanation: "A longer heartbeat reduces maintenance pressure while preserving guardian review time.",
      },
    })));
    render(<PolicyEditor owner={owner} mode="create" pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: otherAccount } });
    for (const [label, value] of [
      ["Beneficiary 1 label", "Ada"], ["Beneficiary 1 address", vault],
      ["Beneficiary 2 label", "Lin"], ["Beneficiary 2 address", "0x4444444444444444444444444444444444444444"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a conservative window." } });
    fireEvent.click(screen.getByRole("button", { name: /draft with copilot/i }));
    expect(await screen.findByText(/longer heartbeat reduces maintenance pressure/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: "0x6666666666666666666666666666666666666666" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.queryByText(/longer heartbeat reduces maintenance pressure/i)).not.toBeInTheDocument();
  });

  it("discards a late Copilot response after a policy parameter changes", async () => {
    const copilotResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(copilotResponse.promise));
    render(<PolicyEditor owner={owner} mode="create" pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: otherAccount } });
    for (const [label, value] of [
      ["Beneficiary 1 label", "Ada"], ["Beneficiary 1 address", vault],
      ["Beneficiary 2 label", "Lin"], ["Beneficiary 2 address", "0x4444444444444444444444444444444444444444"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a conservative window." } });
    fireEvent.click(screen.getByRole("button", { name: /draft with copilot/i }));
    expect(screen.getByRole("button", { name: /drafting/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/heartbeat interval/i), { target: { value: "60" } });

    await act(async () => {
      copilotResponse.resolve(json({
        available: true,
        source: "ai",
        draft: {
          beneficiaries: [
            { label: "Ada", address: vault, shareBps: 6000 },
            { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
          ],
          heartbeatDays: 45,
          graceDays: 21,
          explanation: "This stale rationale must never overwrite the newer user edit.",
        },
      }));
      await copilotResponse.promise;
    });

    expect(screen.getByLabelText(/heartbeat interval/i)).toHaveValue(60);
    expect(screen.queryByText(/stale rationale/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /draft with copilot/i })).toBeEnabled();
  });
});
