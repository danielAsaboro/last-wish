export type KeeperHubReadinessStatus =
  | "checking"
  | "unconfigured"
  | "chain_unsupported"
  | "wallet_integration_missing"
  | "ready"
  | "preflight_unavailable";

export type KeeperHubReadiness = {
  status: KeeperHubReadinessStatus;
  nextStep: string;
};

export const readinessNextSteps = {
  checking: "Checking the selected network and organization wallet before any registration signature.",
  unconfigured: "Configure the server-side KeeperHub API key and trusted LastWish factory address, then refresh readiness.",
  chain_unsupported: "Enable the selected testnet in KeeperHub or switch LastWish to an enabled supported testnet, then refresh readiness.",
  wallet_integration_missing: "Add an organization Web3 wallet integration in KeeperHub, then refresh readiness.",
  ready: "The selected network and organization wallet are available. Review and sign registration when you are ready.",
  preflight_unavailable: "KeeperHub readiness could not be checked. Inspect KeeperHub availability and refresh; do not sign until it is ready.",
} satisfies Record<KeeperHubReadinessStatus, string>;
