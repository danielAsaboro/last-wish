export type RequestContext = { vault: string; policyVersion?: bigint };

export type RequestGenerationToken = RequestContext & {
  generation: number;
  signal: AbortSignal;
};

export class AbortableRequestGeneration {
  private generation = 0;
  private controller?: AbortController;

  begin(context: RequestContext): RequestGenerationToken {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return { ...context, generation: this.generation, signal: this.controller.signal };
  }

  invalidate(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.generation += 1;
  }

  isCurrent(token: RequestGenerationToken): boolean {
    return !token.signal.aborted && token.generation === this.generation;
  }
}

export function shouldApplyVaultBlock(
  token: RequestGenerationToken,
  guard: AbortableRequestGeneration,
  blockNumber: bigint,
  latestAppliedBlock: bigint | undefined,
): boolean {
  return guard.isCurrent(token) && (latestAppliedBlock === undefined || blockNumber >= latestAppliedBlock);
}

export function shouldApplyEvidenceResponse(
  token: RequestGenerationToken,
  guard: AbortableRequestGeneration,
  current: {
    requestedChainId: number;
    activeVault?: string;
    currentPolicyVersion?: bigint;
    responseChainId?: number;
    responseVault?: string;
    responsePolicyVersion?: bigint;
  },
): boolean {
  return guard.isCurrent(token) &&
    token.policyVersion !== undefined &&
    current.currentPolicyVersion !== undefined &&
    current.responsePolicyVersion !== undefined &&
    token.vault.toLowerCase() === current.activeVault?.toLowerCase() &&
    token.vault.toLowerCase() === current.responseVault?.toLowerCase() &&
    current.requestedChainId === current.responseChainId &&
    token.policyVersion === current.currentPolicyVersion &&
    token.policyVersion === current.responsePolicyVersion;
}

export function shouldApplyIntegrityResponse(
  token: RequestGenerationToken,
  guard: AbortableRequestGeneration,
  requestedChainId: number,
  activeVault: string | undefined,
  responseChainId: number | undefined,
  responseVault: string | undefined,
): boolean {
  return guard.isCurrent(token) &&
    requestedChainId === responseChainId &&
    token.vault.toLowerCase() === activeVault?.toLowerCase() &&
    token.vault.toLowerCase() === responseVault?.toLowerCase();
}

export function isVerifiedVaultActionTarget(
  activeVault: string | undefined,
  snapshot: { address: string; provenance: { kind: string; factory: string; verifiedAtBlock: bigint }; observedBlockNumber: bigint } | undefined,
  configuredFactory: string | undefined,
): boolean {
  return Boolean(
    activeVault &&
    snapshot &&
    configuredFactory &&
    snapshot.provenance.kind === "factory_verified" &&
    snapshot.provenance.verifiedAtBlock === snapshot.observedBlockNumber &&
    configuredFactory.toLowerCase() === snapshot.provenance.factory.toLowerCase() &&
    activeVault.toLowerCase() === snapshot.address.toLowerCase(),
  );
}
