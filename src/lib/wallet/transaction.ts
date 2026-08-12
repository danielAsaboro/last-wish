import type { Hash } from "viem";

export function assertSuccessfulReceipt<T extends { status: string; blockNumber: bigint }>(receipt: T): T {
  if (receipt.status !== "success") throw new Error(`Transaction reverted in block ${receipt.blockNumber}.`);
  return receipt;
}

export type WalletSubmissionFailure = "rejected" | "insufficient_funds" | "failed";

export type WalletTransactionResult<TReceipt extends { status: string; blockNumber: bigint }> =
  | { kind: "confirmed"; transactionHash: Hash; receipt: TReceipt }
  | { kind: "reverted"; transactionHash: Hash; blockNumber: bigint }
  | { kind: "recovery_required"; transactionHash: Hash }
  | { kind: "not_submitted"; reason: WalletSubmissionFailure };

export async function submitAndConfirmTransaction<TReceipt extends { status: string; blockNumber: bigint }>(input: {
  submit(): Promise<Hash>;
  waitForReceipt(transactionHash: Hash): Promise<TReceipt>;
  onSubmitted?(transactionHash: Hash): void;
  expectedTarget?: `0x${string}`;
}): Promise<WalletTransactionResult<TReceipt>> {
  let transactionHash: Hash;
  try {
    transactionHash = await input.submit();
  } catch (error) {
    return { kind: "not_submitted", reason: classifySubmissionFailure(error) };
  }

  try {
    input.onSubmitted?.(transactionHash);
    const receipt = await input.waitForReceipt(transactionHash);
    if (!receiptMatchesTarget(receipt, input.expectedTarget)) return { kind: "recovery_required", transactionHash };
    if (receipt.status === "success") return { kind: "confirmed", transactionHash, receipt };
    if (receipt.status === "reverted") return { kind: "reverted", transactionHash, blockNumber: receipt.blockNumber };
    return { kind: "recovery_required", transactionHash };
  } catch {
    return { kind: "recovery_required", transactionHash };
  }
}

export async function reconcileTransactionReceipt<TReceipt extends { status: string; blockNumber: bigint }>(
  transactionHash: Hash,
  getReceipt: (transactionHash: Hash) => Promise<TReceipt>,
  expectedTarget?: `0x${string}`,
): Promise<Exclude<WalletTransactionResult<TReceipt>, { kind: "not_submitted" }>> {
  try {
    const receipt = await getReceipt(transactionHash);
    if (!receiptMatchesTarget(receipt, expectedTarget)) {
      return { kind: "recovery_required", transactionHash };
    }
    if (receipt.status === "success") return { kind: "confirmed", transactionHash, receipt };
    if (receipt.status === "reverted") return { kind: "reverted", transactionHash, blockNumber: receipt.blockNumber };
    return { kind: "recovery_required", transactionHash };
  } catch {
    return { kind: "recovery_required", transactionHash };
  }
}

function receiptMatchesTarget(receipt: object, expectedTarget?: `0x${string}`): boolean {
  if (!expectedTarget) return true;
  const receiptTarget = "to" in receipt && (typeof receipt.to === "string" || receipt.to === null) ? receipt.to : undefined;
  return Boolean(receiptTarget && receiptTarget.toLowerCase() === expectedTarget.toLowerCase());
}

function classifySubmissionFailure(error: unknown): WalletSubmissionFailure {
  const facts = collectErrorFacts(error);
  if (facts.codes.some((code) => code === "4001" || code === "ACTION_REJECTED") || facts.text.includes("user rejected")) return "rejected";
  if (facts.text.includes("insufficient funds") || facts.names.includes("InsufficientFundsError")) return "insufficient_funds";
  return "failed";
}

function collectErrorFacts(error: unknown, seen = new Set<object>()): { codes: string[]; names: string[]; text: string } {
  if (typeof error !== "object" || error === null || seen.has(error)) return { codes: [], names: [], text: "" };
  seen.add(error);
  const value = error as { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown };
  const nested = collectErrorFacts(value.cause, seen);
  return {
    codes: [...(typeof value.code === "string" || typeof value.code === "number" ? [String(value.code)] : []), ...nested.codes],
    names: [...(typeof value.name === "string" ? [value.name] : []), ...nested.names],
    text: [value.message, value.shortMessage, nested.text].filter((item): item is string => typeof item === "string").join(" ").toLowerCase(),
  };
}
