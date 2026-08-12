import { describe, expect, it } from "vitest";

import {
  buildExecutionKey,
  classifyKeeperHubEvidence,
  classifyWorkflowEvidence,
  inspectWorkflowExecutionLogs,
  parseEnabledChains,
  parseWorkflowExecutions,
  selectExecutionChain,
  selectRequestedExecutionChain,
  verifyKeeperHubWriteLog,
} from "./client";

const vault = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"a".repeat(64)}` as const;

describe("KeeperHub chain selection", () => {
  it("prefers enabled Base Sepolia and falls back to enabled Ethereum Sepolia", () => {
    const chains = parseEnabledChains([
      { chainId: 11155111, name: "Sepolia", isEnabled: true, isTestnet: true },
      { chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true },
    ]);
    expect(selectExecutionChain(chains).chainId).toBe(84532);
    expect(selectExecutionChain(chains.filter((chain) => chain.chainId !== 84532)).chainId).toBe(11155111);
  });

  it("rejects chains that are disabled or not testnets", () => {
    expect(() =>
      selectExecutionChain(
        parseEnabledChains([
          { chainId: 84532, name: "Base Sepolia", isEnabled: false, isTestnet: true },
          { chainId: 11155111, name: "Sepolia", isEnabled: true, isTestnet: false },
        ]),
      ),
    ).toThrow("No supported KeeperHub testnet is enabled");
  });

  it("selects the exact requested enabled supported testnet without priority fallback", () => {
    const chains = parseEnabledChains([
      { chainId: 84532, name: "Base Sepolia", isEnabled: true, isTestnet: true },
      { chainId: 11155111, name: "Sepolia", isEnabled: true, isTestnet: true },
    ]);
    expect(selectRequestedExecutionChain(chains, 11155111)).toMatchObject({ chainId: 11155111, name: "Sepolia" });
    expect(() => selectRequestedExecutionChain(chains, 1)).toThrow(/supported KeeperHub testnet/i);
  });
});

describe("KeeperHub execution evidence", () => {
  it("accepts every current KeeperHub execution status and nullable completion timestamps", () => {
    const statuses = ["pending", "running", "unconfirmed", "success", "error", "cancelled", "phantom", "system_error"] as const;
    const executions = parseWorkflowExecutions(statuses.map((status) => ({
      id: `exec_${status}`,
      workflowId: "wf_open",
      status,
      startedAt: "2026-08-12T12:00:00Z",
      completedAt: null,
      transactionHashes: [],
    })));

    expect(executions.map((execution) => execution.status)).toEqual(statuses);
    expect(executions.every((execution) => execution.completedAt === null)).toBe(true);
  });

  it("uses a stable key that changes with policy or action", () => {
    expect(buildExecutionKey(84532, vault, 3n, "finalizeSettlement", 900n)).toBe(
      buildExecutionKey(84532, vault, 3n, "finalizeSettlement", 900n),
    );
    expect(buildExecutionKey(84532, vault, 4n, "finalizeSettlement", 900n)).not.toBe(
      buildExecutionKey(84532, vault, 3n, "finalizeSettlement", 900n),
    );
  });

  it("requires a verified successful receipt and independently observed state", () => {
    expect(
      classifyKeeperHubEvidence(
        {
          executionId: "exec_123",
          status: "completed",
          transactionHash: hash,
          transactionLink: `https://sepolia.basescan.org/tx/${hash}`,
          receipts: [{ transactionHash: hash, verified: true, receiptStatus: "success", blockNumber: "42", gasUsed: "70000" }],
        },
        "SETTLED",
        "SETTLED",
      ),
    ).toMatchObject({ status: "verified", verified: true, gasUsed: 70000n, blockNumber: 42n });
  });

  it("classifies timeout and missing independent state as recovery required", () => {
    expect(
      classifyKeeperHubEvidence(
        {
          executionId: "exec_ambiguous",
          status: "unconfirmed",
          transactionHash: hash,
          receipts: [{ transactionHash: hash, verified: false, receiptStatus: "timeout" }],
        },
        "SETTLED",
        undefined,
      ),
    ).toMatchObject({ status: "unknown", verified: false, observedVaultStatus: "RECOVERY_REQUIRED" });
  });

  it("reconciles workflow runs against both an RPC receipt and vault state", () => {
    expect(classifyWorkflowEvidence(
      {
        id: "exec_workflow",
        workflowId: "wf_open",
        status: "success",
        startedAt: "2026-08-12T12:00:00Z",
        completedAt: "2026-08-12T12:00:05Z",
        transactionHashes: [{ hash, nodeId: "execute", nodeName: "Open grace period", chainId: 84532 }],
      },
      "PENDING",
      { keeperWriteVerified: true, receiptStatus: "success", eventVerified: true, blockNumber: 42n, gasUsed: 70_000n, observedVaultStatus: "PENDING" },
    )).toMatchObject({
      executionId: "exec_workflow",
      workflowId: "wf_open",
      status: "verified",
      verified: true,
      receiptStatus: "success",
      observedVaultStatus: "PENDING",
      timestamp: 1_786_536_005n,
    });
  });

  it("requires KeeperHub's successful write-step log to match the transaction", () => {
    expect(verifyKeeperHubWriteLog({
      execution: { id: "exec_1", workflowId: "wf_1", status: "success" },
      logs: [{
        id: "log_1", executionId: "exec_1", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: hash, gasUsedUnits: "70000" }, error: null,
        duration: "1000", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    }, hash, "exec_1", "wf_1")).toBe(true);

    expect(verifyKeeperHubWriteLog({
      execution: { id: "exec_1", workflowId: "wf_1", status: "success" },
      logs: [{
        id: "log_1", executionId: "exec_1", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: `0x${"b".repeat(64)}` }, error: null,
        duration: "1000", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    }, hash, "exec_1", "wf_1")).toBe(false);

    expect(verifyKeeperHubWriteLog({
      execution: { id: "exec_other", workflowId: "wf_1", status: "success" },
      logs: [{
        id: "log_1", executionId: "exec_1", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: hash }, error: null,
        duration: "1000", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    }, hash, "exec_1", "wf_1")).toBe(false);

    expect(verifyKeeperHubWriteLog({
      execution: { id: "exec_1", workflowId: "wf_other", status: "success" },
      logs: [{
        id: "log_1", executionId: "exec_other", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: hash }, error: null,
        duration: "1000", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    }, hash, "exec_1", "wf_1")).toBe(false);
  });

  it("marks a transaction ambiguous when KeeperHub's write log is missing", () => {
    expect(classifyWorkflowEvidence(
      { id: "exec_workflow", workflowId: "wf_open", status: "success", transactionHashes: [{ hash, nodeId: "execute", nodeName: "Open grace" }] },
      "PENDING",
      { keeperWriteVerified: false, receiptStatus: "success", eventVerified: true, observedVaultStatus: "PENDING" },
    )).toMatchObject({ status: "unknown", verified: false, observedVaultStatus: "RECOVERY_REQUIRED" });
  });

  it("requires recovery for every transaction whose complete reconciliation does not match", () => {
    for (const status of ["success", "error", "cancelled", "pending", "running"] as const) {
      expect(classifyWorkflowEvidence(
        { id: `exec_${status}`, workflowId: "wf_open", status, transactionHashes: [{ hash, nodeId: "execute", nodeName: "Open grace" }] },
        "PENDING",
        { keeperWriteVerified: true, receiptStatus: "success", eventVerified: true, observedVaultStatus: "ACTIVE" },
      )).toMatchObject({
        executionId: `exec_${status}`,
        status: "unknown",
        verified: false,
        observedVaultStatus: "RECOVERY_REQUIRED",
      });
    }
  });

  it("does not describe a successful eligibility check with no write as a settlement transaction", () => {
    expect(classifyWorkflowEvidence(
      { id: "exec_check", workflowId: "wf_open", status: "success", transactionHashes: [] },
      "PENDING",
      { observedVaultStatus: "ACTIVE", noWriteVerified: true },
    )).toMatchObject({ status: "verified", verified: true, outcome: "NO_WRITE", observedVaultStatus: "ACTIVE" });
  });

  it("requires positive condition-log proof before classifying an empty-hash run as NO_WRITE", () => {
    expect(classifyWorkflowEvidence(
      { id: "exec_legacy", workflowId: "wf_open", status: "success", transactionHashes: [] },
      "PENDING",
      { observedVaultStatus: "ACTIVE" },
    )).toMatchObject({ status: "unknown", verified: false, observedVaultStatus: "RECOVERY_REQUIRED" });

    expect(inspectWorkflowExecutionLogs({
      execution: { id: "exec_check", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_check", executionId: "exec_check", nodeId: "check", nodeName: "Check eligibility", nodeType: "web3/read-contract", status: "success",
        input: null, output: { result: false }, outputRaw: { result: false }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }, {
        id: "log_condition", executionId: "exec_check", nodeId: "eligible", nodeName: "Eligible onchain?", nodeType: "Condition", status: "success",
        input: { condition: false }, output: { condition: false }, outputRaw: { condition: false }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    }, "exec_check", "wf_open")).toEqual({ kind: "no_write" });
  });

  it("does not infer NO_WRITE from a false condition without the matching successful onchain read", () => {
    expect(inspectWorkflowExecutionLogs({
      execution: { id: "exec_check", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_condition", executionId: "exec_check", nodeId: "eligible", nodeName: "Eligible onchain?", nodeType: "Condition", status: "success",
        input: null, output: { condition: false }, outputRaw: { condition: false }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }],
    }, "exec_check", "wf_open")).toEqual({ kind: "unknown" });
  });

  it("does not infer NO_WRITE when any step output contains a transaction hash", () => {
    expect(inspectWorkflowExecutionLogs({
      execution: { id: "exec_check", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_check", executionId: "exec_check", nodeId: "check", nodeName: "Check eligibility", nodeType: "web3/read-contract", status: "success",
        input: null, output: { result: false, audit: { transactionHash: hash } }, outputRaw: null, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }, {
        id: "log_condition", executionId: "exec_check", nodeId: "eligible", nodeName: "Eligible onchain?", nodeType: "Condition", status: "success",
        input: null, output: { condition: false }, outputRaw: null, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }],
    }, "exec_check", "wf_open")).toEqual({ kind: "unknown" });
  });

  it("reconstructs a legacy write hash from logs instead of declaring NO_WRITE", () => {
    expect(inspectWorkflowExecutionLogs({
      execution: { id: "exec_legacy", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_write", executionId: "exec_legacy", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: {}, output: { success: true, transactionHash: hash }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      }],
    }, "exec_legacy", "wf_open")).toEqual({ kind: "write", transactionHash: hash });
  });

  it("preserves unconfirmed empty-hash executions as ambiguous", () => {
    expect(classifyWorkflowEvidence(
      { id: "exec_unconfirmed", workflowId: "wf_open", status: "unconfirmed", completedAt: null, transactionHashes: [] },
      "PENDING",
      { noWriteVerified: false, observedVaultStatus: "ACTIVE" },
    )).toMatchObject({ status: "unknown", verified: false, observedVaultStatus: "RECOVERY_REQUIRED" });
  });

  it("keeps phantom executions non-terminal and rejects multiple write hashes", () => {
    expect(classifyWorkflowEvidence(
      { id: "exec_phantom", workflowId: "wf_open", status: "phantom", transactionHashes: [] },
      "PENDING",
      { observedVaultStatus: "ACTIVE" },
    )).toMatchObject({ status: "pending", verified: false });
    expect(classifyWorkflowEvidence(
      {
        id: "exec_multi", workflowId: "wf_open", status: "success",
        transactionHashes: [
          { hash, nodeId: "execute", nodeName: "write" },
          { hash: `0x${"b".repeat(64)}`, nodeId: "execute", nodeName: "write" },
        ],
      },
      "PENDING",
      { keeperWriteVerified: true, receiptStatus: "success", eventVerified: true, observedVaultStatus: "PENDING" },
    )).toMatchObject({ status: "unknown", verified: false, observedVaultStatus: "RECOVERY_REQUIRED" });
  });

  it("does not prove no-write when condition attempts conflict", () => {
    expect(inspectWorkflowExecutionLogs({
      execution: { id: "exec_conflict", workflowId: "wf_open", status: "success" },
      logs: [false, true].map((condition, index) => ({
        id: `log_${index}`, executionId: "exec_conflict", nodeId: "eligible", nodeName: "Eligible onchain?", nodeType: "Condition", status: "success",
        input: {}, output: { condition }, error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: "2026-08-12T12:00:01Z",
      })),
    }, "exec_conflict", "wf_open")).toEqual({ kind: "unknown" });
  });

  it("does not trust a write log when the log response execution is not successful", () => {
    expect(verifyKeeperHubWriteLog({
      execution: { id: "exec_1", workflowId: "wf_1", status: "running" },
      logs: [{
        id: "log_1", executionId: "exec_1", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: null, output: { success: true, transactionHash: hash }, outputRaw: { success: true, transactionHash: hash }, error: null,
        duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }],
    }, hash, "exec_1", "wf_1")).toBe(false);
  });

  it("does not fall back to the formatted output when a non-null raw output is malformed", () => {
    expect(inspectWorkflowExecutionLogs({
      execution: { id: "exec_check", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_check", executionId: "exec_check", nodeId: "check", nodeName: "Check eligibility", nodeType: "web3/read-contract", status: "success",
        input: null, output: { result: false }, outputRaw: "malformed", error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }, {
        id: "log_condition", executionId: "exec_check", nodeId: "eligible", nodeName: "Eligible onchain?", nodeType: "Condition", status: "success",
        input: null, output: { condition: false }, outputRaw: "malformed", error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }],
    }, "exec_check", "wf_open")).toEqual({ kind: "unknown" });

    expect(verifyKeeperHubWriteLog({
      execution: { id: "exec_write", workflowId: "wf_open", status: "success" },
      logs: [{
        id: "log_write", executionId: "exec_write", nodeId: "execute", nodeName: "Open grace", nodeType: "web3/write-contract", status: "success",
        input: null, output: { success: true, transactionHash: hash }, outputRaw: "malformed", error: null, duration: "1", startedAt: "2026-08-12T12:00:00Z", completedAt: null,
      }],
    }, hash, "exec_write", "wf_open")).toBe(false);
  });
});
