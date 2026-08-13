import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from "viem";

import { factoryAbi } from "@/lib/contracts/abi";

const vault = "0x2222222222222222222222222222222222222222" as const;
const owner = "0x1111111111111111111111111111111111111111" as const;
const otherAccount = "0x3333333333333333333333333333333333333333" as const;
const replacementVault = "0x6666666666666666666666666666666666666666" as const;

function rpcBlockHash(blockNumber: bigint, variant = "0") {
  return `0x${variant}${blockNumber.toString(16).padStart(63, "0")}` as const;
}

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS = "0x5555555555555555555555555555555555555555";
  return {
    isConnected: true,
    account: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    chainId: 84532,
    invalidVault: undefined as string | undefined,
    discoveredVault: "0x2222222222222222222222222222222222222222" as `0x${string}`,
    getBlock: vi.fn(),
    readContract: vi.fn(),
    getBalance: vi.fn(),
    getContractEvents: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    getTransactionReceipt: vi.fn(),
    signMessage: vi.fn(),
    writeContract: vi.fn(),
    sendTransaction: vi.fn(),
    connectAsync: vi.fn(),
    switchChain: vi.fn(),
  };
});

vi.mock("wagmi", () => {
  const publicClient = {
    getBlock: mocks.getBlock,
    readContract: mocks.readContract,
    getBalance: mocks.getBalance,
    getContractEvents: mocks.getContractEvents,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    getTransactionReceipt: mocks.getTransactionReceipt,
  };
  return {
    useAccount: () => ({ address: mocks.account, chainId: mocks.chainId, isConnected: mocks.isConnected }),
    useConnect: () => ({
      connectors: [{ type: "injected", getProvider: async () => ({}) }],
      connectAsync: mocks.connectAsync,
    }),
    useSwitchChain: () => ({ switchChain: mocks.switchChain }),
    useWalletClient: () => ({ data: { signMessage: mocks.signMessage, writeContract: mocks.writeContract, sendTransaction: mocks.sendTransaction } }),
    usePublicClient: () => publicClient,
  };
});

vi.mock("@/lib/wallet/config", () => ({ preferredChain: { id: 84532, name: "Base Sepolia" } }));

import { DashboardApp, PolicyEditor, selectWalletRecoveryForVault } from "./dashboard-app";

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
  let nextIntervalId: number;
  let activeIntervals: Array<{ id: number; callback: () => void }>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let latestBlockCall: number;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("lastwish:vault:84532", vault);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    mocks.account = owner;
    mocks.isConnected = true;
    mocks.chainId = 84532;
    mocks.invalidVault = undefined;
    mocks.discoveredVault = vault;
    latestBlockCall = 0;
    nextIntervalId = 0;
    activeIntervals = [];
    intervalCallbacks = [];
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      nextIntervalId += 1;
      activeIntervals.push({ id: nextIntervalId, callback: handler as () => void });
      intervalCallbacks = activeIntervals.map(({ callback }) => callback);
      return nextIntervalId as unknown as NodeJS.Timeout;
    });
    vi.spyOn(window, "clearInterval").mockImplementation((id) => {
      activeIntervals = activeIntervals.filter((interval) => interval.id !== Number(id));
      intervalCallbacks = activeIntervals.map(({ callback }) => callback);
    });
    mocks.getBlock.mockReset().mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return { number: 100n, timestamp: 1_800_000_000n, hash: rpcBlockHash(100n) };
      }
      const blockNumber = input.blockNumber ?? 100n;
      return { number: blockNumber, timestamp: 1_800_000_000n, hash: rpcBlockHash(blockNumber) };
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
        case "vaultOf": return mocks.discoveredVault;
        default: throw new Error(`Unexpected read ${input.functionName}`);
      }
    });
    mocks.getBalance.mockReset().mockResolvedValue(1n);
    mocks.getContractEvents.mockReset().mockResolvedValue([]);
    mocks.waitForTransactionReceipt.mockReset();
    mocks.getTransactionReceipt.mockReset();
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

  it("rejects malformed KeeperHub policy lineage instead of fabricating an action", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keeperhub/readiness")) return json({ status: "ready", nextStep: "KeeperHub is ready." });
      if (url.includes("/api/keeperhub/evidence")) return json({
        configured: true,
        chainId: 84532,
        vault,
        policyVersion: "1",
        workflows: [{
          workflowId: "wf_check",
          name: "Open",
          policyVersion: "1",
          action: "open",
          enabled: true,
          definitionMatches: true,
          registrationState: "current",
          coverage: { runsReturned: 1, providerWindow: "latest_50_non_purged", olderRunsMayExist: false, providerPagination: "unavailable" },
        }],
        executionEvidenceScope: "recent_keeperhub_window_only",
        evidence: [{
          workflowId: "wf_tampered",
          executionId: "exec_tampered",
          status: "verified",
          verified: true,
          observedVaultStatus: "SETTLED",
          policyVersion: "1",
          workflowAction: "destroy",
        }],
      });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<DashboardApp />);

    expect(await screen.findByText("KeeperHub evidence is unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Finalize settlement")).not.toBeInTheDocument();
  });

  it("loads a factory-verified vault for read-only inspection without a connected wallet", async () => {
    mocks.isConnected = false;
    window.localStorage.clear();
    render(<DashboardApp />);

    fireEvent.change(await screen.findByRole("textbox", { name: /vault address/i }), { target: { value: vault } });
    fireEvent.click(screen.getByRole("button", { name: /load vault/i }));

    expect(await screen.findByText(/read-only inspection/i)).toBeInTheDocument();
    expect(await screen.findByText(/vault balance · read from base sepolia/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export audit json/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record heartbeat|update policy|fund vault|withdraw|register keeperhub/i })).not.toBeInTheDocument();
    expect(mocks.signMessage).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/keeperhub/workflows"))).toHaveLength(0);
  });

  it("downloads a point-in-time audit manifest from the verified vault", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:lastwish-audit");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const linkClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /export audit json/i }));

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(linkClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:lastwish-audit");
  });

  it("retains an ambiguous wallet hash, blocks another write, and reconciles it read-only", async () => {
    const transactionHash = `0x${"c".repeat(64)}` as const;
    mocks.writeContract.mockResolvedValue(transactionHash);
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("https://rpc.example/private-token timed out"));
    mocks.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 121n, to: vault, logs: [] });
    render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /record heartbeat/i }));

    expect(await screen.findByRole("heading", { name: /transaction needs reconciliation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeDisabled();
    expect(screen.getByLabelText(/vault address/i)).toBeEnabled();
    expect(document.body).not.toHaveTextContent("private-token");
    expect(screen.getByRole("link", { name: /inspect submitted transaction/i })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${transactionHash}`);
    expect(window.sessionStorage.getItem("lastwish:wallet-recovery:84532")).toContain(transactionHash);

    fireEvent.click(screen.getByRole("button", { name: /check receipt again/i }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: /transaction needs reconciliation/i })).not.toBeInTheDocument());
    expect(screen.getByText(/heartbeat confirmed in block 121/i)).toBeInTheDocument();
    expect(mocks.getTransactionReceipt).toHaveBeenCalledWith({ hash: transactionHash });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeEnabled();
    expect(window.sessionStorage.getItem("lastwish:wallet-recovery:84532")).toBeNull();
  });

  it("persists the submitted hash before receipt confirmation completes", async () => {
    const transactionHash = `0x${"9".repeat(64)}` as const;
    const receipt = deferred<{ status: "success"; blockNumber: bigint; to: typeof vault; logs: [] }>();
    mocks.writeContract.mockResolvedValue(transactionHash);
    mocks.waitForTransactionReceipt.mockReturnValue(receipt.promise);
    render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /record heartbeat/i }));

    await waitFor(() => expect(window.sessionStorage.getItem("lastwish:wallet-recovery:84532")).toContain(transactionHash));
    expect(screen.getByRole("link", { name: /track pending transaction/i })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${transactionHash}`);

    await act(async () => {
      receipt.resolve({ status: "success", blockNumber: 120n, to: vault, logs: [] });
      await receipt.promise;
    });
    await waitFor(() => expect(window.sessionStorage.getItem("lastwish:wallet-recovery:84532")).toBeNull());
  });

  it("uses fixed wallet copy when a signature is rejected before submission", async () => {
    mocks.writeContract.mockRejectedValue(Object.assign(new Error("Rejected at https://wallet.example/private-token"), { code: 4001 }));
    render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /record heartbeat/i }));

    expect(await screen.findByText(/wallet request was rejected/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-token");
    expect(screen.queryByRole("heading", { name: /transaction needs reconciliation/i })).not.toBeInTheDocument();
  });

  it("treats a mined revert as terminal and allows a reviewed retry", async () => {
    const transactionHash = `0x${"d".repeat(64)}` as const;
    mocks.writeContract.mockResolvedValue(transactionHash);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 122n, to: vault, logs: [] });
    render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /record heartbeat/i }));

    expect(await screen.findByText(/transaction reverted in block 122/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /transaction needs reconciliation/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeEnabled();
  });

  it("applies the same submitted-hash recovery gate to native ETH funding", async () => {
    const transactionHash = `0x${"e".repeat(64)}` as const;
    mocks.sendTransaction.mockResolvedValue(transactionHash);
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("receipt timeout"));
    render(<DashboardApp />);

    fireEvent.click(await screen.findByRole("button", { name: /fund vault/i }));
    fireEvent.change(screen.getByLabelText(/amount in eth/i), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: /review in wallet/i }));

    expect(await screen.findByRole("heading", { name: /transaction needs reconciliation/i })).toBeInTheDocument();
    expect(screen.getByText(/fund vault was submitted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record heartbeat/i })).toBeDisabled();
    expect(screen.getByLabelText(/amount in eth/i)).toBeDisabled();
  });

  it("does not activate a confirmed deployment after the connected account changes", async () => {
    const beneficiaryOne = replacementVault;
    const beneficiaryTwo = "0x7777777777777777777777777777777777777777" as const;
    const transactionHash = `0x${"f".repeat(64)}` as const;
    const receipt = deferred<{
      status: "success";
      blockNumber: bigint;
      to: typeof mocks.discoveredVault;
      transactionHash: typeof transactionHash;
      logs: Array<{ address: typeof mocks.discoveredVault; topics: readonly `0x${string}`[]; data: `0x${string}`; blockNumber: bigint; transactionHash: typeof transactionHash; logIndex: number; transactionIndex: number; blockHash: `0x${string}`; removed: boolean }>;
    }>();
    window.localStorage.clear();
    mocks.discoveredVault = zeroAddress;
    mocks.writeContract.mockResolvedValue(transactionHash);
    mocks.waitForTransactionReceipt.mockReturnValue(receipt.promise);
    const { rerender } = render(<DashboardApp />);

    fireEvent.change(await screen.findByLabelText(/guardian address/i), { target: { value: otherAccount } });
    fireEvent.change(screen.getByLabelText(/beneficiary 1 label/i), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/beneficiary 1 address/i), { target: { value: beneficiaryOne } });
    fireEvent.change(screen.getByLabelText(/beneficiary 2 label/i), { target: { value: "Lin" } });
    fireEvent.change(screen.getByLabelText(/beneficiary 2 address/i), { target: { value: beneficiaryTwo } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /deploy vault/i }));
    await waitFor(() => expect(mocks.writeContract).toHaveBeenCalledOnce());

    mocks.account = otherAccount;
    rerender(<DashboardApp />);
    const trustedFactory = "0x5555555555555555555555555555555555555555" as const;
    await act(async () => {
      receipt.resolve({
        status: "success",
        blockNumber: 123n,
        to: trustedFactory,
        transactionHash,
        logs: [{
          address: trustedFactory,
          topics: encodeEventTopics({ abi: factoryAbi, eventName: "VaultCreated", args: { owner, vault } }) as readonly `0x${string}`[],
          data: encodeAbiParameters([{ type: "bool" }], [false]),
          blockNumber: 123n,
          transactionHash,
          logIndex: 0,
          transactionIndex: 0,
          blockHash: rpcBlockHash(123n),
          removed: false,
        }],
      });
      await receipt.promise;
    });

    expect(await screen.findByRole("heading", { name: /transaction needs reconciliation/i })).toBeInTheDocument();
    expect(screen.getByText(/connected wallet changed before the deployment could be attached/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("lastwish:vault:84532")).toBeNull();
    expect(screen.queryByText(new RegExp(vault, "i"))).not.toBeInTheDocument();
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

  it("indexes the initial audit range in bounded windows and polls only new blocks", async () => {
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 25_010n, timestamp: 1_800_000_000n, hash: rpcBlockHash(25_010n) }
          : { number: 25_015n, timestamp: 1_800_000_005n, hash: rpcBlockHash(25_015n) };
      }
      const blockNumber = input.blockNumber ?? 25_010n;
      return { number: blockNumber, timestamp: 1_800_000_000n, hash: rpcBlockHash(blockNumber) };
    });
    mocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      switch (input.functionName) {
        case "owner": return owner;
        case "guardian": return otherAccount;
        case "policyVersion": return 1n;
        case "status": return 0;
        case "beneficiaryCount": return 0n;
        case "heartbeatInterval": return 2_592_000n;
        case "gracePeriod": return 1_209_600n;
        case "lastHeartbeat": return 1_799_900_000n;
        case "pendingAt": return 0n;
        case "deployedAtBlock": return 7n;
        case "vaultOf": return vault;
        default: throw new Error(`Unexpected read ${input.functionName}`);
      }
    });

    render(<DashboardApp />);

    await waitFor(() => expect(mocks.getContractEvents).toHaveBeenCalledTimes(3));
    expect(mocks.getContractEvents.mock.calls.map(([input]) => ({
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
    }))).toEqual([
      { fromBlock: 7n, toBlock: 10_006n },
      { fromBlock: 10_007n, toBlock: 20_006n },
      { fromBlock: 20_007n, toBlock: 25_010n },
    ]);
    expect(await screen.findByText("Chain history indexed through block 25010")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    await waitFor(() => expect(mocks.getContractEvents).toHaveBeenCalledTimes(4));
    expect(mocks.getContractEvents.mock.calls.at(-1)?.[0]).toMatchObject({
      fromBlock: 25_011n,
      toBlock: 25_015n,
    });
  });

  it("rebuilds a cache that is ahead of the current verified head", async () => {
    const cachedTransaction = `0x${"c".repeat(64)}` as const;
    const rebuiltTransaction = `0x${"d".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 105n, timestamp: 1_800_000_005n }
          : { number: 104n, timestamp: 1_800_000_004n };
      }
      return { number: input.blockNumber ?? 105n, timestamp: 1_799_999_900n + (input.blockNumber ?? 105n) };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 105n,
        transactionHash: cachedTransaction,
        logIndex: 0,
        args: { owner },
      }])
      .mockResolvedValueOnce([{
        eventName: "Deposit",
        blockNumber: 104n,
        transactionHash: rebuiltTransaction,
        logIndex: 0,
        args: { sender: owner, amount: 1n },
      }]);

    render(<DashboardApp />);

    expect(await screen.findByText("Chain history indexed through block 105")).toBeInTheDocument();
    expect(screen.getByText("Owner heartbeat recorded")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history indexed through block 104")).toBeInTheDocument();
    expect(mocks.getContractEvents.mock.calls.at(-1)?.[0]).toMatchObject({ fromBlock: 1n, toBlock: 104n });
    expect(screen.getByText("Vault funded")).toBeInTheDocument();
    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("Chain history indexed through block 105")).not.toBeInTheDocument();
  });

  it("refetches timestamps for canonical logs when rebuilding an ahead cache", async () => {
    const cachedTransaction = `0x${"5".repeat(64)}` as const;
    const canonicalTransaction = `0x${"6".repeat(64)}` as const;
    let block104TimestampCall = 0;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 105n, timestamp: 1_800_000_005n }
          : { number: 104n, timestamp: 1_800_086_400n };
      }
      if (input.blockNumber === 104n) {
        block104TimestampCall += 1;
        return {
          number: 104n,
          timestamp: block104TimestampCall === 1 ? 1_800_000_000n : 1_800_086_400n,
        };
      }
      return { number: input.blockNumber ?? 105n, timestamp: 1_800_000_000n };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 104n,
        transactionHash: cachedTransaction,
        logIndex: 0,
        args: { owner },
      }])
      .mockResolvedValueOnce([{
        eventName: "Deposit",
        blockNumber: 104n,
        transactionHash: canonicalTransaction,
        logIndex: 0,
        args: { sender: owner, amount: 1n },
      }]);

    render(<DashboardApp />);

    expect(await screen.findByText("Chain history indexed through block 105")).toBeInTheDocument();
    expect(screen.getByText("Jan 15, 2027, 8:00 AM UTC")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history indexed through block 104")).toBeInTheDocument();
    expect(mocks.getBlock.mock.calls.filter(([input]) => input.blockNumber === 104n)).toHaveLength(2);
    expect(screen.getByText("Jan 16, 2027, 8:00 AM UTC")).toBeInTheDocument();
    expect(screen.queryByText("Jan 15, 2027, 8:00 AM UTC")).not.toBeInTheDocument();
  });

  it("clears rejected chain events while a same-height canonical rebuild is in progress", async () => {
    const oldTransaction = `0x${"7".repeat(64)}` as const;
    const canonicalTransaction = `0x${"8".repeat(64)}` as const;
    const oldHash = `0x${"a".repeat(64)}` as const;
    const canonicalHash = `0x${"b".repeat(64)}` as const;
    const slowCanonicalHistory = deferred<Array<{
      eventName: string;
      blockNumber: bigint;
      transactionHash: `0x${string}`;
      logIndex: number;
      args: { sender: typeof owner; amount: bigint };
    }>>();
    let block90TimestampCall = 0;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 100n, timestamp: 1_800_000_000n, hash: oldHash }
          : { number: 100n, timestamp: 1_800_086_400n, hash: canonicalHash };
      }
      if (input.blockNumber === 100n) return { number: 100n, timestamp: 1_800_086_400n, hash: canonicalHash };
      if (input.blockNumber === 90n) {
        block90TimestampCall += 1;
        return { number: 90n, timestamp: block90TimestampCall === 1 ? 1_800_000_000n : 1_800_086_400n };
      }
      return { number: input.blockNumber ?? 100n, timestamp: 1_800_000_000n };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 90n,
        transactionHash: oldTransaction,
        logIndex: 0,
        args: { owner },
      }])
      .mockReturnValueOnce(slowCanonicalHistory.promise);

    render(<DashboardApp />);
    expect(await screen.findByText("Owner heartbeat recorded")).toBeInTheDocument();
    expect(screen.getByText("Jan 15, 2027, 8:00 AM UTC")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Indexing confirmed contract events through block 100")).toBeInTheDocument();
    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("Jan 15, 2027, 8:00 AM UTC")).not.toBeInTheDocument();

    await act(async () => {
      slowCanonicalHistory.resolve([{
        eventName: "Deposit",
        blockNumber: 90n,
        transactionHash: canonicalTransaction,
        logIndex: 0,
        args: { sender: owner, amount: 1n },
      }]);
      await slowCanonicalHistory.promise;
    });

    expect(await screen.findByText("Vault funded")).toBeInTheDocument();
    expect(screen.getByText("Jan 16, 2027, 8:00 AM UTC")).toBeInTheDocument();
    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
  });

  it("fully rebuilds a higher-head cache when its canonical checkpoint hash changes", async () => {
    const oldTransaction = `0x${"9".repeat(64)}` as const;
    const canonicalTransaction = `0x${"a".repeat(64)}` as const;
    const oldHash = `0x${"c".repeat(64)}` as const;
    const replacementCheckpointHash = `0x${"d".repeat(64)}` as const;
    const newHeadHash = `0x${"e".repeat(64)}` as const;
    const slowCanonicalHistory = deferred<Array<{
      eventName: string;
      blockNumber: bigint;
      transactionHash: `0x${string}`;
      logIndex: number;
      args: { sender: typeof owner; amount: bigint };
    }>>();
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 100n, timestamp: 1_800_000_000n, hash: oldHash }
          : { number: 105n, timestamp: 1_800_000_005n, hash: newHeadHash };
      }
      if (input.blockNumber === 100n) return { number: 100n, timestamp: 1_800_000_001n, hash: replacementCheckpointHash };
      return { number: input.blockNumber ?? 100n, timestamp: 1_800_086_400n };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 90n,
        transactionHash: oldTransaction,
        logIndex: 0,
        args: { owner },
      }])
      .mockReturnValueOnce(slowCanonicalHistory.promise);

    render(<DashboardApp />);
    expect(await screen.findByText("Owner heartbeat recorded")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Indexing confirmed contract events through block 105")).toBeInTheDocument();
    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
    expect(mocks.getContractEvents.mock.calls.at(-1)?.[0]).toMatchObject({ fromBlock: 1n, toBlock: 105n });

    await act(async () => {
      slowCanonicalHistory.resolve([{
        eventName: "Deposit",
        blockNumber: 95n,
        transactionHash: canonicalTransaction,
        logIndex: 0,
        args: { sender: owner, amount: 1n },
      }]);
      await slowCanonicalHistory.promise;
    });

    expect(await screen.findByText("Chain history indexed through block 105")).toBeInTheDocument();
    expect(screen.getByText("Vault funded")).toBeInTheDocument();
    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
  });

  it("rebuilds from the new deployment block when the verified snapshot no longer matches the cache", async () => {
    const oldTransaction = `0x${"e".repeat(64)}` as const;
    const replacementTransaction = `0x${"f".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 100n, timestamp: 1_800_000_000n }
          : { number: 101n, timestamp: 1_800_000_001n };
      }
      return { number: input.blockNumber ?? 100n, timestamp: 1_799_999_900n + (input.blockNumber ?? 100n) };
    });
    mocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      switch (input.functionName) {
        case "owner": return owner;
        case "guardian": return otherAccount;
        case "policyVersion": return 1n;
        case "status": return 0;
        case "beneficiaryCount": return 0n;
        case "heartbeatInterval": return 2_592_000n;
        case "gracePeriod": return 1_209_600n;
        case "lastHeartbeat": return 1_799_900_000n;
        case "pendingAt": return 0n;
        case "deployedAtBlock": return latestBlockCall === 1 ? 1n : 7n;
        case "vaultOf": return vault;
        default: throw new Error(`Unexpected read ${input.functionName}`);
      }
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 100n,
        transactionHash: oldTransaction,
        logIndex: 0,
        args: { owner },
      }])
      .mockResolvedValueOnce([{
        eventName: "Deposit",
        blockNumber: 101n,
        transactionHash: replacementTransaction,
        logIndex: 0,
        args: { sender: owner, amount: 1n },
      }]);

    render(<DashboardApp />);
    expect(await screen.findByText("Chain history indexed through block 100")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history indexed through block 101")).toBeInTheDocument();
    expect(mocks.getContractEvents.mock.calls.at(-1)?.[0]).toMatchObject({ fromBlock: 7n, toBlock: 101n });
    expect(screen.getByText("Vault funded")).toBeInTheDocument();
    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
  });

  it("does not commit multi-window logs when a candidate timestamp fetch fails", async () => {
    const completeTransaction = `0x${"1".repeat(64)}` as const;
    const firstWindowTransaction = `0x${"2".repeat(64)}` as const;
    const secondWindowTransaction = `0x${"3".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 100n, timestamp: 1_800_000_000n, hash: rpcBlockHash(100n) }
          : { number: 20_100n, timestamp: 1_800_020_000n, hash: rpcBlockHash(20_100n) };
      }
      if (input.blockNumber === 20_000n) throw new Error("timestamp RPC unavailable");
      const blockNumber = input.blockNumber ?? 100n;
      return { number: blockNumber, timestamp: 1_799_999_900n + blockNumber, hash: rpcBlockHash(blockNumber) };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 100n,
        transactionHash: completeTransaction,
        logIndex: 0,
        args: { owner },
      }])
      .mockResolvedValueOnce([{
        eventName: "Deposit",
        blockNumber: 10_000n,
        transactionHash: firstWindowTransaction,
        logIndex: 0,
        args: { sender: owner, amount: 1n },
      }])
      .mockResolvedValueOnce([{
        eventName: "Withdrawal",
        blockNumber: 20_000n,
        transactionHash: secondWindowTransaction,
        logIndex: 0,
        args: { actor: owner, amount: 1n },
      }]);

    render(<DashboardApp />);
    expect(await screen.findByText("Chain history indexed through block 100")).toBeInTheDocument();
    expect(screen.getByText("Owner heartbeat recorded")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.getByText("Last complete through block 100. Target block 20100.")).toBeInTheDocument();
    expect(mocks.getContractEvents.mock.calls.slice(-2).map(([input]) => ({ fromBlock: input.fromBlock, toBlock: input.toBlock }))).toEqual([
      { fromBlock: 101n, toBlock: 10_100n },
      { fromBlock: 10_101n, toBlock: 20_100n },
    ]);
    expect(screen.getByText("Owner heartbeat recorded")).toBeInTheDocument();
    expect(screen.queryByText("Vault funded")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner withdrawal recorded")).not.toBeInTheDocument();
  });

  it("reconciles coverage when a superseding snapshot refresh fails before indexing", async () => {
    const slowHistory = deferred<readonly []>();
    const transactionHash = `0x${"4".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        if (latestBlockCall === 1) return { number: 100n, timestamp: 1_800_000_000n, hash: rpcBlockHash(100n) };
        if (latestBlockCall === 2) return { number: 101n, timestamp: 1_800_000_001n, hash: rpcBlockHash(101n) };
        throw new Error("superseding snapshot unavailable");
      }
      const blockNumber = input.blockNumber ?? 100n;
      return { number: blockNumber, timestamp: 1_800_000_000n, hash: rpcBlockHash(blockNumber) };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 100n,
        transactionHash,
        logIndex: 0,
        args: { owner },
      }])
      .mockReturnValueOnce(slowHistory.promise);

    render(<DashboardApp />);
    expect(await screen.findByText("Chain history indexed through block 100")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });
    expect(await screen.findByText("Indexing confirmed contract events through block 101")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.getByText("Last complete through block 100. Target block 101.")).toBeInTheDocument();
    expect(screen.getByText("Owner heartbeat recorded")).toBeInTheDocument();
    expect(screen.queryByText("Indexing confirmed contract events through block 101")).not.toBeInTheDocument();

    await act(async () => {
      slowHistory.resolve([]);
      await slowHistory.promise;
      await Promise.resolve();
    });
    expect(screen.getByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.queryByText("Chain history indexed through block 101")).not.toBeInTheDocument();
  });

  it("does not invent a last-complete block when a superseding refresh fails before the first cache commit", async () => {
    const slowHistory = deferred<readonly []>();
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        if (latestBlockCall === 1) return { number: 100n, timestamp: 1_800_000_000n };
        throw new Error("superseding snapshot unavailable");
      }
      return { number: input.blockNumber ?? 100n, timestamp: 1_800_000_000n };
    });
    mocks.getContractEvents.mockReturnValueOnce(slowHistory.promise);

    render(<DashboardApp />);
    expect(await screen.findByText("Indexing confirmed contract events through block 100")).toBeInTheDocument();
    expect(screen.queryByText(/last complete/i)).not.toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.getByText("Target block 100. No complete chain event range is available.")).toBeInTheDocument();
    expect(screen.queryByText(/last complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no indexed events yet/i)).not.toBeInTheDocument();

    await act(async () => {
      slowHistory.resolve([]);
      await slowHistory.promise;
      await Promise.resolve();
    });
    expect(screen.getByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.queryByText("Chain history indexed through block 100")).not.toBeInTheDocument();
  });

  it("uses fixed snapshot failure copy and clears it after a successful current recovery", async () => {
    const checkpointHash = `0x${"f".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        if (latestBlockCall === 1) return { number: 100n, timestamp: 1_800_000_000n, hash: checkpointHash };
        if (latestBlockCall === 2) throw new Error("https://rpc.example/private-token");
        return { number: 100n, timestamp: 1_800_000_001n, hash: checkpointHash };
      }
      return { number: input.blockNumber ?? 100n, timestamp: 1_800_000_000n, hash: checkpointHash };
    });

    render(<DashboardApp />);
    expect(await screen.findByText("Chain history indexed through block 100")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("The latest vault refresh is temporarily unavailable. Retaining the last factory-verified snapshot.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("https://rpc.example/private-token");

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain history indexed through block 100")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("The latest vault refresh is temporarily unavailable. Retaining the last factory-verified snapshot.")).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent("https://rpc.example/private-token");
  });

  it("retains the last complete chain range and KeeperHub evidence when incremental indexing fails", async () => {
    const transactionHash = `0x${"a".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 100n, timestamp: 1_800_000_000n, hash: rpcBlockHash(100n) }
          : { number: 105n, timestamp: 1_800_000_005n, hash: rpcBlockHash(105n) };
      }
      const blockNumber = input.blockNumber ?? 100n;
      return { number: blockNumber, timestamp: 1_799_999_990n, hash: rpcBlockHash(blockNumber) };
    });
    mocks.getContractEvents
      .mockResolvedValueOnce([{
        eventName: "Heartbeat",
        blockNumber: 90n,
        transactionHash,
        logIndex: 0,
        args: { owner },
      }])
      .mockRejectedValueOnce(new Error("https://rpc.example/private-token"));
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keeperhub/readiness")) return json({ status: "ready", nextStep: "KeeperHub is ready." });
      if (url.includes("/api/keeperhub/evidence")) return json({
        configured: true,
        chainId: 84532,
        vault,
        policyVersion: "1",
        workflows: [{
          workflowId: "wf_check",
          name: "Open",
          policyVersion: "1",
          action: "open",
          enabled: true,
          definitionMatches: true,
          registrationState: "current",
          coverage: { runsReturned: 1, providerWindow: "latest_50_non_purged", olderRunsMayExist: false, providerPagination: "unavailable" },
        }],
        executionEvidenceScope: "recent_keeperhub_window_only",
        evidence: [{
          workflowId: "wf_check",
          executionId: "exec_check",
          status: "verified",
          verified: true,
          outcome: "NO_WRITE",
          observedVaultStatus: "ACTIVE",
          timestamp: "1800000001",
          policyVersion: "1",
          workflowAction: "open",
        }],
      });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<DashboardApp />);

    expect(await screen.findByText("Owner heartbeat recorded")).toBeInTheDocument();
    expect(await screen.findByText("Eligibility check completed")).toBeInTheDocument();
    expect(screen.getAllByText("Policy v1")).toHaveLength(2);
    expect(screen.getAllByText("Open settlement")).toHaveLength(2);
    expect(screen.getByText("Chain history indexed through block 100")).toBeInTheDocument();

    await act(async () => { intervalCallbacks[0]?.(); });

    expect(await screen.findByText("Chain audit indexing is temporarily unavailable. The last complete event range remains visible.")).toBeInTheDocument();
    expect(screen.getByText("Chain history is stale")).toBeInTheDocument();
    expect(screen.getByText("Last complete through block 100. Target block 105.")).toBeInTheDocument();
    expect(screen.getByText("Owner heartbeat recorded")).toBeInTheDocument();
    expect(screen.getByText("Eligibility check completed")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("https://rpc.example/private-token");
  });

  it("does not apply a late vault-A audit chunk or coverage to vault B", async () => {
    const vaultAHistory = deferred<Array<{
      eventName: string;
      blockNumber: bigint;
      transactionHash: `0x${string}`;
      logIndex: number;
      args: { owner: typeof owner };
    }>>();
    const vaultATransaction = `0x${"a".repeat(64)}` as const;
    const vaultBTransaction = `0x${"b".repeat(64)}` as const;
    mocks.getBlock.mockImplementation(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "latest") {
        latestBlockCall += 1;
        return latestBlockCall === 1
          ? { number: 100n, timestamp: 1_800_000_000n }
          : { number: 101n, timestamp: 1_800_000_001n };
      }
      return { number: input.blockNumber ?? 100n, timestamp: 1_799_999_900n + (input.blockNumber ?? 100n) };
    });
    mocks.readContract.mockImplementation(async (input: { address?: string; functionName: string; args?: readonly unknown[] }) => {
      switch (input.functionName) {
        case "owner": return input.address?.toLowerCase() === replacementVault.toLowerCase() ? otherAccount : owner;
        case "guardian": return owner;
        case "policyVersion": return 1n;
        case "status": return 0;
        case "beneficiaryCount": return 0n;
        case "heartbeatInterval": return 2_592_000n;
        case "gracePeriod": return 1_209_600n;
        case "lastHeartbeat": return 1_799_900_000n;
        case "pendingAt": return 0n;
        case "deployedAtBlock": return 1n;
        case "vaultOf": return input.args?.[0] === otherAccount ? replacementVault : vault;
        default: throw new Error(`Unexpected read ${input.functionName}`);
      }
    });
    mocks.getContractEvents.mockImplementation(async (input: { address: string }) => {
      if (input.address.toLowerCase() === vault.toLowerCase()) return vaultAHistory.promise;
      return [{
        eventName: "Deposit",
        blockNumber: 101n,
        transactionHash: vaultBTransaction,
        logIndex: 0,
        args: { sender: otherAccount, amount: 1n },
      }];
    });

    render(<DashboardApp />);
    expect(await screen.findByText("Policy v1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/vault address/i), { target: { value: replacementVault } });
    fireEvent.click(screen.getByRole("button", { name: /load vault/i }));

    expect(await screen.findByText("Vault funded")).toBeInTheDocument();
    expect(screen.getByText("Chain history indexed through block 101")).toBeInTheDocument();

    await act(async () => {
      vaultAHistory.resolve([{
        eventName: "Heartbeat",
        blockNumber: 90n,
        transactionHash: vaultATransaction,
        logIndex: 0,
        args: { owner },
      }]);
      await vaultAHistory.promise;
      await Promise.resolve();
    });

    expect(screen.queryByText("Owner heartbeat recorded")).not.toBeInTheDocument();
    expect(screen.getByText("Vault funded")).toBeInTheDocument();
    expect(screen.getByText("Chain history indexed through block 101")).toBeInTheDocument();
    expect(screen.queryByText("Chain history indexed through block 100")).not.toBeInTheDocument();
  });
});

describe("selectWalletRecoveryForVault", () => {
  const recovery = { target: replacementVault, transactionHash: `0x${"d".repeat(64)}` as const };

  it("keeps a global recovery warning out of an unrelated vault audit trail", () => {
    expect(selectWalletRecoveryForVault(recovery, vault)).toBeUndefined();
    expect(selectWalletRecoveryForVault(recovery, replacementVault)).toBe(recovery);
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

  it("rejects a tampered AI response without changing beneficiary identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      available: true,
      source: "ai",
      draft: {
        beneficiaries: [
          { label: "Ada", address: "0x6666666666666666666666666666666666666666", shareBps: 6000 },
          { label: "Lin", address: "0x4444444444444444444444444444444444444444", shareBps: 4000 },
        ],
        heartbeatDays: 45,
        graceDays: 21,
        explanation: "This response changed a beneficiary address and must not reach the unsigned review.",
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

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid draft.*not changed/i);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText("Beneficiary 1 address")).toHaveValue(vault);
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

  it("discards a late Copilot response after its instructions change", async () => {
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
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a shorter maintenance interval." } });

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
          explanation: "This rationale belongs to the superseded instructions and must not be shown.",
        },
      }));
      await copilotResponse.promise;
    });

    expect(screen.queryByText(/superseded instructions/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /draft with copilot/i })).toBeEnabled();
  });

  it.each([
    [503, "<html>temporarily unavailable</html>", /copilot unavailable/i, /no AI provider credential/i],
    [502, "", /draft with copilot/i, /could not produce a valid draft.*not changed/i],
  ])("handles non-JSON Copilot HTTP %i without exposing parser errors", async (status, body, buttonName, errorCopy) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status, headers: { "Content-Type": "text/html" } })));
    render(<PolicyEditor owner={owner} mode="create" pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/guardian address/i), { target: { value: otherAccount } });
    for (const [label, value] of [
      ["Beneficiary 1 label", "Ada"], ["Beneficiary 1 address", vault],
      ["Beneficiary 2 label", "Lin"], ["Beneficiary 2 address", "0x4444444444444444444444444444444444444444"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/policy copilot notes/i), { target: { value: "Prefer a conservative window." } });
    fireEvent.click(screen.getByRole("button", { name: /draft with copilot/i }));

    expect(await screen.findByRole("button", { name: buttonName })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(errorCopy);
    expect(document.body).not.toHaveTextContent(/json|unexpected end|temporarily unavailable/i);
  });
});
