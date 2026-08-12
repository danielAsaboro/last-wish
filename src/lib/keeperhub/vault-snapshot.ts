export function shouldApplyVaultSnapshot(requestedVault: string, activeVault: string | undefined): boolean {
  return activeVault?.toLowerCase() === requestedVault.toLowerCase();
}
