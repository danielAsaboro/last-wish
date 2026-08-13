import { BrandMark } from "@/components/brand-mark";

const steps = [
  ["01", "Create the policy", "Choose a guardian, fixed beneficiary shares, and an inactivity window. Your wallet signs the vault deployment."],
  ["02", "Keep the heartbeat", "A small owner transaction resets the clock. Nothing depends on an email, server login, or model decision."],
  ["03", "Review the grace period", "After inactivity, KeeperHub may open a time-locked review window. The owner can reactivate; the guardian can veto."],
  ["04", "Settle and verify", "KeeperHub finalizes only after the contract permits it. Every beneficiary claims independently from the vault."],
] as const;

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header wrap">
        <a className="wordmark" href="#top" aria-label="LastWish home">
          <BrandMark />
          LastWish
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#safeguards">Safeguards</a>
          <a className="button button-small" href="/dashboard">Open dashboard</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow"><span className="live-dot" /> Self-custodial succession on testnet</p>
            <h1>Your assets should not become inaccessible when you do.</h1>
            <p className="lede">
              A programmable digital-asset succession vault with owner heartbeats, a guardian veto,
              and contract-enforced beneficiary claims.
            </p>
            <div className="hero-actions">
              <a className="button" href="/dashboard">Open dashboard <span aria-hidden="true">↗</span></a>
              <a className="text-link" href="#how-it-works">Follow the lifecycle <span aria-hidden="true">↓</span></a>
            </div>
            <p className="microcopy">Native test ETH only · Base Sepolia preferred · No custody by LastWish</p>
          </div>
          <div className="hero-ledger" aria-label="Example policy lifecycle">
            <div className="ledger-top">
              <span>Policy 03</span><span className="status-pill">Active</span>
            </div>
            <div className="pulse-orbit"><span>28</span><small>days until<br />next heartbeat</small></div>
            <div className="ledger-row"><span>Vault balance</span><strong>0.240 ETH</strong></div>
            <div className="ledger-row"><span>Beneficiaries</span><strong>60 / 40</strong></div>
            <div className="ledger-row"><span>Execution</span><strong>KeeperHub</strong></div>
            <p className="ledger-note">Illustrative values—not connected wallet data.</p>
          </div>
        </section>

        <section className="principle-band">
          <div className="wrap band-grid">
            <p className="eyebrow light">The governing principle</p>
            <blockquote>Automation may execute your policy. It may never rewrite it.</blockquote>
          </div>
        </section>

        <section className="section wrap" id="how-it-works">
          <div className="section-heading">
            <p className="eyebrow">A visible, reversible path</p>
            <h2>Inactivity starts a review—not an irreversible transfer.</h2>
          </div>
          <div className="step-grid">
            {steps.map(([number, title, copy]) => (
              <article className="step-card" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section soft-section" id="safeguards">
          <div className="wrap safeguards-grid">
            <div className="section-heading">
              <p className="eyebrow">Authority stays narrow</p>
              <h2>Three safeguards. No hidden administrator.</h2>
              <p>The owner controls the policy and active funds. The guardian can stop settlement, never redirect it. Contract rules constrain every executor.</p>
            </div>
            <div className="safeguard-list">
              <article><span>01</span><div><h3>Self-custodial vault</h3><p>No application server, guardian, or KeeperHub wallet can choose a new recipient.</p></div></article>
              <article><span>02</span><div><h3>Guardian veto, not custody</h3><p>A guardian can halt a questionable transition during grace; only the owner can reactivate.</p></div></article>
              <article><span>03</span><div><h3>Pull-based claims</h3><p>Finalization snapshots every allocation, so one unavailable beneficiary cannot block another.</p></div></article>
            </div>
          </div>
        </section>

        <section className="section wrap execution-section">
          <div>
            <p className="eyebrow">Execution with receipts</p>
            <h2>KeeperHub executes only what the vault permits.</h2>
          </div>
          <div className="evidence-card">
            <div><span className="status-dot success" /> Simulation</div><strong>Must pass before activation</strong>
            <div><span className="status-dot success" /> Receipt</div><strong>Must verify onchain</strong>
            <div><span className="status-dot success" /> Independent read</div><strong>Must match expected state</strong>
            <p>Missing or ambiguous receipts stop in recovery. LastWish never turns “unknown” into “success.”</p>
          </div>
        </section>

        <section className="disclosure wrap">
          <strong>Important boundary</strong>
          <p>LastWish is not a legal will, probate service, or proof-of-death system. It executes a pre-authorized digital-asset policy based on onchain inactivity. This MVP uses testnet assets only.</p>
        </section>
      </main>

      <footer className="site-footer wrap">
        <div className="wordmark"><BrandMark />LastWish</div>
        <p>Programmable digital-asset succession.</p>
        <a href="/dashboard">Open dashboard →</a>
      </footer>
    </div>
  );
}
