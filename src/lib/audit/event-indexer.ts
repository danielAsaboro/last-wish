export const AUDIT_EVENT_BLOCK_WINDOW = 10_000n;

export async function readEventHistoryInWindows<T>(input: {
  fromBlock: bigint;
  toBlock: bigint;
  readRange: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>;
}): Promise<T[]> {
  if (input.fromBlock > input.toBlock) return [];

  const logs: T[] = [];
  let fromBlock = input.fromBlock;

  while (fromBlock <= input.toBlock) {
    const toBlock = fromBlock + AUDIT_EVENT_BLOCK_WINDOW - 1n < input.toBlock
      ? fromBlock + AUDIT_EVENT_BLOCK_WINDOW - 1n
      : input.toBlock;
    logs.push(...await input.readRange(fromBlock, toBlock));
    fromBlock = toBlock + 1n;
  }

  return logs;
}
