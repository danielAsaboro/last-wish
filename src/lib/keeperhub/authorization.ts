import type { Address } from "viem";

type WorkflowAuthorization = {
  chainId: number;
  vault: Address;
  policyVersion: bigint;
  scheduleCron: string;
  expiresAt: number;
};

const registrationLocks = new Map<string, Promise<void>>();

export function buildWorkflowAuthorizationMessage(input: WorkflowAuthorization): string {
  return [
    "LastWish KeeperHub workflow registration",
    `Chain ID: ${input.chainId}`,
    `Vault: ${input.vault}`,
    `Policy version: ${input.policyVersion}`,
    `Schedule: ${input.scheduleCron}`,
    `Expires at: ${input.expiresAt}`,
  ].join("\n");
}

export function validateWorkflowAuthorizationWindow(expiresAt: number, now: number): void {
  if (expiresAt <= now) throw new Error("Workflow registration authorization has expired.");
  if (expiresAt > now + 600) throw new Error("Workflow registration authorization expires too far in the future.");
}

export async function withWorkflowRegistrationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = registrationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  registrationLocks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (registrationLocks.get(key) === queued) registrationLocks.delete(key);
  }
}
