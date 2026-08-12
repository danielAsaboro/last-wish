import { describe, expect, it } from "vitest";

import {
  buildExecutionKey,
  classifyKeeperHubEvidence,
  classifyWorkflowEvidence,
  parseEnabledChains,
  selectExecutionChain,
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
        transactionHashes: [{ hash, nodeId: "execute", nodeName: "Open grace period", chainId: 84532 }],
      },
      "PENDING",
      { receiptStatus: "success", eventVerified: true, blockNumber: 42n, gasUsed: 70_000n, observedVaultStatus: "PENDING" },
    )).toMatchObject({
      executionId: "exec_workflow",
      workflowId: "wf_open",
      status: "verified",
      verified: true,
      receiptStatus: "success",
      observedVaultStatus: "PENDING",
    });
  });

  it("does not describe a successful eligibility check with no write as a settlement transaction", () => {
    expect(classifyWorkflowEvidence(
      { id: "exec_check", workflowId: "wf_open", status: "success", transactionHashes: [] },
      "PENDING",
      { observedVaultStatus: "ACTIVE" },
    )).toMatchObject({ status: "verified", verified: true, outcome: "NO_WRITE", observedVaultStatus: "ACTIVE" });
  });
});
