export function assertSuccessfulReceipt<T extends { status: string; blockNumber: bigint }>(receipt: T): T {
  if (receipt.status !== "success") throw new Error(`Transaction reverted in block ${receipt.blockNumber}.`);
  return receipt;
}
