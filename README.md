# LastWish

LastWish is a self-custodial, testnet digital-asset succession protocol. A holder creates and funds a dedicated native-ETH vault, names beneficiaries with fixed shares totaling 10,000 basis points, and records periodic heartbeats. If the heartbeat expires, KeeperHub can open an onchain grace period and later finalize settlement. A guardian may veto during grace, but cannot move funds or change beneficiaries.

LastWish is not a legal will, proof-of-death service, probate replacement, or jurisdiction-independent inheritance solution.

## What works

- One `LastWishVault` per holder, deployed through `LastWishVaultFactory`
- Owner heartbeat, policy updates, active-only withdrawal, and native ETH funding
- Permissionless, contract-time-gated settlement opening and finalization
- Guardian-only veto during the grace period
- Deterministic allocation with final-recipient rounding and one-time pull claims
- Injected EVM wallet connection with Base Sepolia preference and Sepolia fallback
- Factory-verified read-only vault inspection and audit export without requiring wallet connection
- Privacy-minimal `?vault=` inspection links that share only the public vault address
- Role-sensitive owner, guardian, beneficiary, and observer controls
- Exact heartbeat/grace lifecycle deadlines with contract-gated next-action guidance
- Owner-signed KeeperHub workflow registration with factory provenance, policy-bound calls, stale-workflow retirement, duplicate reconciliation, disabled-first simulation, and explicit activation
- KeeperHub run history reconciled against its matching execution/write-step log, RPC receipt, expected contract event, and vault state at the receipt block
- AI SDK 7 Policy Copilot with Zod-structured output; it drafts timing and shares but cannot sign, submit calldata, or decide eligibility
- Chain and KeeperHub evidence in a unified, timestamped audit trail with reconstructable policy terms, policy/action lineage, actors, amounts, blocks, gas, identifiers, and explicit recovery-required outcomes
- Versioned JSON audit export with factory provenance, point-in-time vault state, chain-index coverage, KeeperHub evidence freshness, and vault-scoped recovery records
- Wallet-submitted hashes retained in an explicit in-session recovery ledger; conflicting writes stay disabled until a read-only, target-matched receipt check resolves success or revert

No fake balances, workflow runs, transaction hashes, or receipts are used. If credentials or deployment addresses are absent, the corresponding feature reports that it is unavailable.

## Architecture

```text
Injected wallet ──signs──> LastWishVaultFactory / LastWishVault
      │                              │
      │                              ├── policy, heartbeat, grace, claims
      │                              └── authoritative events and state
      │
Next.js dashboard ──reads──────────> testnet RPC
      │
      ├── server route ─────────────> KeeperHub workflow API
      │                                  │
      │                                  └── scheduled read → condition → write
      │
      └── server route ─────────────> AI SDK 7 Policy Copilot
```

The chain is the source of truth. Local storage contains only the last-viewed vault and KeeperHub workflow identifiers. KeeperHub and AI credentials remain server-only.

## Local setup

Requirements: Node.js 20+, npm, Foundry, an injected EVM wallet, and testnet ETH.

```bash
npm install
cp .env.example .env.local
forge test
npm test
npm run dev
```

Open `http://localhost:3000`. Configure `.env.local` with the selected testnet RPC URLs, the deployed factory address, and optional server credentials. Base Sepolia (`84532`) is the default; use Sepolia (`11155111`) only when KeeperHub chain preflight requires it.

Policy Copilot supports either a dedicated `OPENAI_API_KEY` with `OPENAI_MODEL`, or AI SDK 7's gateway via `AI_GATEWAY_API_KEY` with a provider-qualified `AI_GATEWAY_MODEL` such as `openai/gpt-5-mini`. Without either credential, the UI explicitly reports Copilot as unavailable.

## Contract deployment

```bash
forge script script/Deploy.s.sol:DeployLastWish \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

Use a dedicated funded testnet key and do not place it in a committed file. After deployment, verify the factory and set `NEXT_PUBLIC_LASTWISH_FACTORY_ADDRESS`.

## Verified Base Sepolia execution

An explicitly labelled 60-second heartbeat / 60-second grace-period demo vault completed the full self-custodial testnet flow on August 13, 2026. These shortened timings are for demonstration only; the normal dashboard uses day-scale timing.

- Factory: [`0x2b1A…0BF9`](https://sepolia.basescan.org/address/0x2b1A8f06cb055c6e255708a0814621D91eB70BF9)
- Vault: [`0xeE86…4221`](https://sepolia.basescan.org/address/0xeE8608DB5475272ec73232b99fF600D187974221)
- [Vault creation](https://sepolia.basescan.org/tx/0x142f88b94d8e2df75a0d4ae2197c41b29c791456b35c719ec13b8089d0a12f18) and [0.003 ETH funding](https://sepolia.basescan.org/tx/0xc5ee5fe7a92e3735fda0447f256454a1c85cddab72e4cb74ba4dc616267afbe4)
- KeeperHub open-settlement workflow `m1xayoqge0plq5879mu1a`, execution `2x9la6btzcskxl56rhnua`: [verified transaction](https://sepolia.basescan.org/tx/0xc8cd6a3f045d8f439181540fa50f80111d40b3679f6f955ff50208997eb6bd12)
- KeeperHub finalize-settlement workflow `xzda7l3qq1h8ts4orn4lk`, execution `q4mkad42hsruzbiho6g3i`: [verified transaction](https://sepolia.basescan.org/tx/0x54c1d90f7cc4aeb30b79586826c985c21810c941e1a51d5f25855b927caa7e5d)
- [Beneficiary claim](https://sepolia.basescan.org/tx/0x3b40efd1f562fa936b521f89fca8592ef67a8bebdc94295abc012300dbaf902d)

Independent Base Sepolia RPC reads confirmed successful receipts, the expected vault events, terminal `SETTLED` state, zero vault balance, zero remaining claimable balance, and claim/finalization replay protection. No application or KeeperHub credential is published here.

## KeeperHub safety model

Each vault policy receives two scheduled workflows: one calls `canOpenSettlementForPolicy` before `openSettlementForPolicy`; the other calls `canFinalizeSettlementForPolicy` before `finalizeSettlementForPolicy`. Workflows are canonicalized while disabled, simulated, and enabled only after preflight succeeds. Prior-policy schedules are disabled and stale policy calls are rejected onchain.

A workflow transaction is shown as verified only when all four checks agree:

1. KeeperHub records a successful run and transaction hash.
2. The matching successful KeeperHub write-step log records the same execution, workflow, and transaction hash.
3. An independent RPC read finds a successful receipt containing the expected event from the target vault.
4. The vault resolves to the expected state at the receipt block.

Missing or contradictory evidence is classified as recovery-required and is never blindly rebroadcast.
Settlement opening and finalization are not exposed as direct wallet actions in the app; KeeperHub is the shipped settlement execution path.

## Verification

```bash
forge test
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Live deployment, KeeperHub execution, and beneficiary-claim verification require credentials and funded test wallets. Those steps are intentionally separate from the deterministic local suite.

## Security boundaries

- Native test ETH only; ERC-20s and NFTs are out of scope.
- The application server, KeeperHub, and guardian cannot redirect beneficiary assets.
- Beneficiaries must be unique, nonzero addresses and shares must total exactly 10,000 basis points.
- Standard vault timing is at least one day; shortened intervals are contract-supported only for explicitly labelled testnet demo vaults and are not exposed by the normal dashboard flow.
- Deposits stop after settlement, claims are pull-based and replay-safe, and external value transfers use reentrancy protection.
- This is unaudited hackathon software and must not be used with real assets.

## Primary references

- [KeeperHub workflows API](https://docs.keeperhub.com/api/workflows)
- [KeeperHub executions API](https://docs.keeperhub.com/api/executions)
- [KeeperHub verified transaction guidance](https://docs.keeperhub.com/guides/first-verified-transaction)
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
