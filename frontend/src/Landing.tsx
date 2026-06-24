import { AtriumMark } from './AtriumMark'

const PILLARS = [
  {
    k: 'Encrypted data room',
    d: 'Documents are encrypted off-ledger (AES-256-GCM). Canton releases the decryption key only when your grant covers the tier — a rival is denied by cryptography, not by a hidden button.',
  },
  {
    k: 'Privacy-bounded AI',
    d: 'A diligence copilot that only ever receives the documents your tier can decrypt. It can’t leak the tier-2 financials to a tier-1 buyer, because it never sees them.',
  },
  {
    k: 'Atomic, compliant close',
    d: 'KYC-gated delivery-vs-payment: cash and tokenized ownership swap in one transaction, or not at all — and the cap table updates the instant it settles.',
  },
]

export function Landing({ onEnter, live }: { onEnter: () => void; live: boolean }) {
  return (
    <div className="landing">
      <header className="lp-top">
        <div className="lp-brand">
          <AtriumMark size={26} />
          <span className="lp-word">ATRIUM</span>
        </div>
        <span className={`mode-pill ${live ? 'live' : ''}`}>{live ? '● LIVE on Canton' : '○ in-browser demo'}</span>
      </header>

      <section className="lp-hero">
        <div className="lp-eyebrow mono">PRIVATE M&amp;A · CAPITAL MARKETS · RWA · BUILT ON CANTON</div>
        <h1 className="lp-title">The data room<br />that closes.</h1>
        <p className="lp-sub">
          Every data room is a filing cabinet with permissions; the close happens off-platform, through
          lawyers and escrow, over weeks. Atrium makes the same private object you run diligence on{' '}
          <em>be the thing that settles</em> — payment versus tokenized ownership, atomically, in one transaction.
        </p>
        <div className="lp-cta">
          <button className="btn solid lp-enter" onClick={onEnter}>Enter the deal room →</button>
          <span className="lp-cta-note mono">Live deal: Halden Robotics — 12% secondary</span>
        </div>
      </section>

      <section className="lp-pillars">
        {PILLARS.map((p) => (
          <div key={p.k} className="lp-card">
            <h3>{p.k}</h3>
            <p>{p.d}</p>
          </div>
        ))}
      </section>

      <section className="lp-why">
        <div className="lp-why-col">
          <div className="lp-why-h mono">SELECTIVE DISCLOSURE → THE DATA ROOM</div>
          <p>Each buyer sees only their tier; rival bidders are invisible; every document access is a tamper-proof on-ledger event; a regulator can verify the deal without seeing the contents.</p>
        </div>
        <div className="lp-why-col">
          <div className="lp-why-h mono">NATIVE ATOMIC DvP → THE CLOSE</div>
          <p>The cash leg and the ownership leg settle together or not at all — no escrow, no counterparty risk, no weeks of back-and-forth. Both are impossible on a transparent chain without heavy ZK.</p>
        </div>
      </section>

      <footer className="lp-foot mono">
        5 ledger-verified proofs · running live on a hosted Canton validator · documents encrypted off-chain
      </footer>
    </div>
  )
}
