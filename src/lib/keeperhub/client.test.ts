import { describe, expect, it } from "vitest";

import {
  buildExecutionKey,
  classifyKeeperHubEvidence,
  classifyWorkflowEvidence,
  parseEnabledChains,
  selectExecutionChain,
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
});

describe("KeeperHub execution evidence", () => {
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
      { observedVaultStatus: "ACTIVE" },
    )).toMatchObject({ status: "verified", verified: true, outcome: "NO_WRITE", observedVaultStatus: "ACTIVE" });
  });
});
