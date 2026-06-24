import { useEffect, useRef, useState } from 'react'
import { AtriumMark } from './AtriumMark'

// The three lenses the hero auto-cycles through — the privacy money shot, playing itself.
const LENSES = [
  { name: 'Halden', role: 'Seller', dot: 'var(--steel)', sealed: false, offer: true },
  { name: 'Boranic', role: 'Buyer · tier 1', dot: 'var(--seal)', sealed: true, offer: false },
  { name: 'Meridian', role: 'Buyer · tier 2', dot: 'var(--settled)', sealed: false, offer: true },
]

const PILLARS = [
  { k: 'Encrypted data room', d: 'Documents encrypted off-ledger (AES-256-GCM). Canton releases the key only when your grant covers the tier — a rival is denied by cryptography, not a hidden button.' },
  { k: 'Privacy-bounded AI', d: 'A diligence copilot that only receives the documents your tier can decrypt. It can’t leak the tier-2 financials to a tier-1 buyer, because it never sees them.' },
  { k: 'Atomic, compliant close', d: 'KYC-gated delivery-vs-payment: cash and tokenized ownership swap in one transaction, or not at all — and the cap table updates the instant it settles.' },
]

// Reveal-on-scroll: adds `.in` to [data-reveal] elements as they enter the viewport.
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0.18 },
    )
    root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return ref
}

export function Landing({ onEnter, live }: { onEnter: () => void; live: boolean }) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % LENSES.length), 2800)
    return () => clearInterval(t)
  }, [])
  const lens = LENSES[phase]
  const rootRef = useReveal<HTMLDivElement>()

  return (
    <div className="landing" ref={rootRef}>
      <div className="lp-bg" aria-hidden />

      <header className="lp-top">
        <div className="lp-brand">
          <AtriumMark size={26} />
          <span className="lp-word">ATRIUM</span>
        </div>
        <span className={`mode-pill ${live ? 'live' : ''}`}>{live ? '● LIVE on Canton' : '○ in-browser demo'}</span>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-text">
          <div className="lp-eyebrow mono" data-reveal>PRIVATE M&amp;A · CAPITAL MARKETS · RWA · BUILT ON CANTON</div>
          <h1 className="lp-title" data-reveal>The data room<br /><span className="grad">that closes.</span></h1>
          <p className="lp-sub" data-reveal>
            Every data room is a filing cabinet with permissions; the close happens off-platform, over weeks.
            Atrium makes the same private object you run diligence on <em>be the thing that settles</em> —
            payment versus tokenized ownership, atomically, in one transaction.
          </p>
          <div className="lp-cta" data-reveal>
            <button className="btn solid lp-enter" onClick={onEnter}>Enter the deal room →</button>
            <span className="lp-cta-note mono">Live deal: Halden Robotics — 12% secondary</span>
          </div>
        </div>

        {/* Auto-cycling lens — the privacy demo, playing itself */}
        <div className="lp-hero-visual" data-reveal>
          <div className="dealcard">
            <div className="dc-lens">
              <span className="dc-dot" style={{ background: lens.dot }} />
              Viewing as <b>{lens.name}</b> · {lens.role}
            </div>

            <div className="dc-doc">
              <div className="dc-doc-top"><span className="mono">TIER 1</span><span className="mono dc-muted">teaser</span></div>
              <div className="dc-lines"><i /><i /><i style={{ width: '58%' }} /></div>
            </div>

            <div className={`dc-doc ${lens.sealed ? 'is-sealed' : ''}`}>
              <div className="dc-doc-top"><span className="mono">TIER 2</span><span className="mono dc-muted">{lens.sealed ? '🔒 sealed' : 'financials'}</span></div>
              {lens.sealed ? (
                <div className="dc-redact"><i /><i /><i style={{ width: '64%' }} /></div>
              ) : (
                <div className="dc-lines"><i /><i style={{ width: '82%' }} /><span className="dc-val mono">EBITDA $6.9M · rev $41.8M</span></div>
              )}
            </div>

            <div className={`dc-bid ${lens.offer ? '' : 'is-hidden'}`}>
              <span>Meridian bid</span><span className="mono">$35.00 / unit</span>
            </div>
          </div>
          <div className="dc-caption mono">one deal · three realities · enforced by the ledger</div>
        </div>
      </section>

      {/* The close — animated atomic swap */}
      <section className="lp-close" data-reveal>
        <div className="lp-close-head">
          <div className="lp-eyebrow mono">THE CLOSE</div>
          <h2>Payment versus ownership. One transaction.</h2>
        </div>
        <div className="swap">
          <div className="swap-side">
            <div className="swap-chip cash">$4,200,000<small>USD cash</small></div>
            <div className="swap-who">Buyer</div>
          </div>
          <div className="swap-link" aria-hidden>
            <svg viewBox="0 0 200 40" preserveAspectRatio="none">
              <line x1="6" y1="20" x2="194" y2="20" className="swap-line" />
              <line x1="6" y1="20" x2="194" y2="20" className="swap-flow" />
            </svg>
            <span className="swap-tag mono">atomic DvP</span>
          </div>
          <div className="swap-side">
            <div className="swap-chip eq">12%<small>HALDEN-EQUITY</small></div>
            <div className="swap-who">Seller</div>
          </div>
        </div>
        <p className="lp-close-note">Both legs settle together, or not at all — no escrow, no counterparty risk, no weeks of lawyers. <span className="swap-settled">✓ settled atomically</span></p>
      </section>

      <section className="lp-pillars">
        {PILLARS.map((p, i) => (
          <div key={p.k} className="lp-card" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
            <div className="lp-card-num mono">0{i + 1}</div>
            <h3>{p.k}</h3>
            <p>{p.d}</p>
          </div>
        ))}
      </section>

      <section className="lp-why" data-reveal>
        <div className="lp-why-col">
          <div className="lp-why-h mono">SELECTIVE DISCLOSURE → THE DATA ROOM</div>
          <p>Each buyer sees only their tier; rival bidders are invisible; every document access is a tamper-proof on-ledger event; a regulator can verify the deal without seeing the contents.</p>
        </div>
        <div className="lp-why-col">
          <div className="lp-why-h mono">NATIVE ATOMIC DvP → THE CLOSE</div>
          <p>The cash leg and the ownership leg settle together or not at all. Impossible on a transparent chain without heavy ZK — native on Canton.</p>
        </div>
      </section>

      <section className="lp-final" data-reveal>
        <h2>See the same deal, three ways.</h2>
        <button className="btn solid lp-enter" onClick={onEnter}>Enter the deal room →</button>
      </section>

      <footer className="lp-foot mono">
        5 ledger-verified proofs · running live on a hosted Canton validator · documents encrypted off-chain
      </footer>
    </div>
  )
}
