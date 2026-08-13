import { getAddress, isAddress } from "viem";

import { buildVaultIntegrityReport, hashVaultIntegrityReport, type VaultIntegrityReportInput } from "./report";

export type IntegrityRequest = { chainId: number; vault: string };
type VaultSnapshot = VaultIntegrityReportInput["vault"];
type KeeperHubSnapshot = VaultIntegrityReportInput["keeperHub"];
type AuditSnapshot = VaultIntegrityReportInput["audit"];

export type IntegrityReportDependencies = {
  readVault(chainId: 84532 | 11155111, vault: `0x${string}`): Promise<VaultSnapshot>;
  readKeeperHubEvidence(chainId: 84532 | 11155111, vault: `0x${string}`, policyVersion: bigint): Promise<KeeperHubSnapshot>;
  readAuditCoverage(chainId: 84532 | 11155111, vault: `0x${string}`, snapshot: VaultSnapshot): Promise<AuditSnapshot>;
  now(): Date;
};

export async function assembleVaultIntegrityReport(request: IntegrityRequest, dependencies: IntegrityReportDependencies) {
  if (request.chainId !== 84532 && request.chainId !== 11155111) throw new Error("Unsupported chain for LastWish integrity reports.");
  if (!isAddress(request.vault)) throw new Error("Invalid vault address.");
  const vault = getAddress(request.vault);
  const snapshot = await dependencies.readVault(request.chainId, vault);
  if (getAddress(snapshot.address).toLowerCase() !== vault.toLowerCase()) throw new Error("Provider returned a different vault snapshot.");
  const [keeperHub, audit] = await Promise.all([
    dependencies.readKeeperHubEvidence(request.chainId, vault, BigInt(snapshot.policyVersion)),
    dependencies.readAuditCoverage(request.chainId, vault, snapshot),
  ]);
  const report = buildVaultIntegrityReport({
    chain: { id: request.chainId, name: request.chainId === 84532 ? "Base Sepolia" : "Sepolia" },
    vault: snapshot,
    keeperHub,
    audit,
    generatedAt: dependencies.now().toISOString(),
  });
  return { report, reportHash: hashVaultIntegrityReport(report) };
}
