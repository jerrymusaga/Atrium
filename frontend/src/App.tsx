import { useEffect, useRef, useState } from 'react'
import { mockClient } from './ledger/mockClient'
import { httpClient } from './ledger/httpClient'
import { AtriumMark } from './AtriumMark'
import type { AskResult, CloseAttestation, DealView, DocContent, Viewer } from './types'

// VITE_LIVE=1 → drive the real Canton ledger via the executor; otherwise the in-browser mock.
const LIVE = import.meta.env.VITE_LIVE === '1'
const client = LIVE ? httpClient : mockClient

function money(n: number) {
  return n >= 1000 ? `$${(n).toLocaleString()}` : `$${n}`
}

export default function App() {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [viewer, setViewer] = useState<string>('')
  const [view, setView] = useState<DealView | null>(null)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [doc, setDoc] = useState<DocContent | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<AskResult | null>(null)
  const [settling, setSettling] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [rollback, setRollback] = useState<string | null>(null)
  const [attestation, setAttestation] = useState<CloseAttestation | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [inviteTier, setInviteTier] = useState(1)
  const [bid, setBid] = useState('')

  // Cache every lens's view so flipping is INSTANT even against a live (latent) validator —
  // show the cached projection immediately, then refresh it in the background.
  const viewCache = useRef<Record<string, DealView>>({})

  async function refreshViewers() {
    const vs = await client.listViewers()
    setViewers(vs)
    setViewer((v) => v || vs[0]?.party || '')
    // Warm the cache for all lenses in parallel so the privacy flip is snappy on first try.
    void Promise.all(vs.map(async (v) => {
      try { viewCache.current[v.party] = await client.getDealView(v.party) } catch { /* ignore */ }
    }))
    return vs
  }
  useEffect(() => { refreshViewers() }, [])

  // Re-fetch the current lens (and refresh its cache). Pass invalidate=true after a mutation
  // to drop stale cached projections so every lens reflects the new ledger state.
  async function load(invalidate = false) {
    if (!viewer) return
    if (invalidate) viewCache.current = {}
    const cached = viewCache.current[viewer]
    if (cached) setView(cached) // instant paint from cache
    const fresh = await client.getDealView(viewer)
    viewCache.current[viewer] = fresh
    setView(fresh)
  }
  useEffect(() => {
    load()
  }, [viewer])

  const current = viewers.find((v) => v.party === viewer)
  const acceptedOffer = view?.offers.find((o) => o.status === 'accepted')
  const myOpenOffer = view?.offers.find((o) => current?.role === 'buyer' && o.status === 'open')

  async function invite() {
    try {
      const name = inviteName
      await client.inviteBuyer(viewer, name, inviteTier)
      setInviteName('')
      await refreshViewers()
      setMsg(`Invited ${name} at tier ${inviteTier} — switch the lens to see their view.`)
    } catch (e) { setMsg((e as Error).message) }
  }

  async function makeOffer() {
    try {
      await client.submitOffer(viewer, Number(bid))
      setBid('')
      await load(true)
    } catch (e) { setMsg((e as Error).message) }
  }

  if (!current) return <div className="app booting">Loading the deal room…</div>

  async function openDoc(docId: string) {
    setOpening(docId)
    setMsg(null)
    try {
      const content = await client.openDocument(viewer, docId) // key released only if the ledger authorizes
      setDoc(content)
      setOpened((o) => ({ ...o, [docId]: true }))
      await load(true) // the access trail just grew on-ledger
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setOpening(null)
    }
  }

  async function accept(offerId: string) {
    await client.acceptOffer(viewer, offerId)
    await load()
  }

  async function settle() {
    setSettling(true)
    setMsg(null)
    setRollback(null)
    try {
      await client.settle(viewer)
      await load(true)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setSettling(false)
    }
  }

  // Pull a leg mid-close: proves the swap is all-or-nothing (mirrors testAtomicityHolds).
  async function stressClose() {
    setSettling(true)
    setRollback(null)
    setMsg(null)
    try {
      await client.attemptBrokenClose(viewer)
    } catch (e) {
      setRollback((e as Error).message)
      await load(true) // re-read: every balance is exactly as before
    } finally {
      setSettling(false)
    }
  }

  async function verifyClose() {
    setAttestation(await client.attestClose(viewer))
  }

  async function ask() {
    if (!question.trim()) return
    setAsking(true)
    setAnswer(null)
    try {
      setAnswer(await client.ask(viewer, question))
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <AtriumMark className="mark" />
          <div>
            <div className="brand-name">ATRIUM</div>
            <div className="brand-sub">the deal room that closes</div>
          </div>
        </div>

        {view && (
          <div className="deal-card">
            <div className="eyebrow">Open deal</div>
            <h1 className="deal-title">{view.deal.title}</h1>
            <dl className="deal-meta">
              <div><dt>Instrument</dt><dd className="mono">{view.deal.instrument}</dd></div>
              <div><dt>On offer</dt><dd className="mono">{view.deal.quantity.toLocaleString()} units</dd></div>
              <div><dt>Deal ref</dt><dd className="mono">{view.deal.dealId}</dd></div>
            </dl>
          </div>
        )}

        <div className="lens">
          <div className="eyebrow">Viewing through</div>
          <div className="lens-options">
            {viewers.map((v) => (
              <button
                key={v.party}
                className={`lens-opt ${v.party === viewer ? 'is-active' : ''} role-${v.role}`}
                onClick={() => { setViewer(v.party); setMsg(null); setAnswer(null); setDoc(null) }}
              >
                <span className="lens-dot" />
                {v.label}
              </button>
            ))}
          </div>
          <p className="lens-note">
            The ledger shows each party only their slice. Switch the lens — the same deal
            looks different to everyone.
          </p>
        </div>

        {current.role === 'seller' && !view?.settled && (
          <div className="invite">
            <div className="eyebrow">Invite a buyer</div>
            <div className="invite-row">
              <input
                className="field"
                placeholder="Buyer name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && inviteName.trim()) invite() }}
              />
              <select className="field tier-sel" value={inviteTier} onChange={(e) => setInviteTier(Number(e.target.value))}>
                <option value={1}>Tier 1</option>
                <option value={2}>Tier 1+2</option>
              </select>
            </div>
            <button className="btn wide" disabled={!inviteName.trim()} onClick={invite}>
              Onboard to the deal room
            </button>
            <p className="lens-note">
              Registers a new ledger party and issues their access grant. They appear as a new lens.
            </p>
          </div>
        )}
      </aside>

      <main className="stage">
        <header className="seeing">
          You are <strong>{current.label}</strong>. {viewerBlurb(current.role)}
        </header>

        {/* Documents */}
        <section className="panel">
          <div className="panel-head">
            <h2>Data room</h2>
            <span className="count mono">{view?.documents.filter((d) => d.accessible).length ?? 0}/{view?.documents.length ?? 0} in your tier</span>
          </div>
          <div className="docs">
            {view?.documents.map((d) => (
              <article key={d.docId} className={`doc ${d.accessible ? 'is-open' : 'is-sealed'}`}>
                <div className="doc-top">
                  <span className="tier mono">TIER {d.tier}</span>
                  {d.accessible
                    ? <span className="hash mono">{d.contentHash}</span>
                    : <span className="lock">🔒</span>}
                </div>
                {d.accessible ? (
                  <>
                    <h3 className="doc-title">{d.title}</h3>
                    <button className="btn ghost" disabled={opening === d.docId} onClick={() => openDoc(d.docId)}>
                      {opening === d.docId ? 'Releasing key…' : opened[d.docId] ? 'Open again' : 'Open document'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="redaction">
                      <span /><span /><span />
                    </div>
                    <div className="sealed-label">Sealed — not in your tier</div>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* Access trail */}
        <section className="panel">
          <div className="panel-head">
            <h2>Access trail</h2>
            <span className="count mono">{view?.accessTrail.length ?? 0} events</span>
          </div>
          <p className="panel-note">
            {current.role === 'buyer'
              ? 'You see only your own accesses. You cannot see who else is in the room.'
              : 'Tamper-proof, ledger-timestamped: who opened what, when.'}
          </p>
          <ul className="trail">
            {view?.accessTrail.map((e, i) => (
              <li key={i}>
                <span className="t-time mono">{e.accessedAt}</span>
                <span className="t-who">{e.buyerLabel}</span>
                <span className="t-arrow">opened</span>
                <span className="t-doc">{e.docTitle}</span>
              </li>
            ))}
            {view?.accessTrail.length === 0 && <li className="empty">No accesses recorded yet.</li>}
          </ul>
        </section>

        {/* Diligence copilot — privacy-bounded AI */}
        <section className="panel">
          <div className="panel-head">
            <h2>Diligence copilot</h2>
            <span className="count mono">Venice AI · tier-bounded</span>
          </div>
          <p className="panel-note">
            Ask about the deal. The copilot is given <strong>only the documents your grant authorizes</strong> —
            it can't answer about a tier you can't decrypt, because it never receives those bytes.
          </p>
          <div className="ask-row">
            <input
              className="field"
              placeholder={current.role === 'seller' ? 'e.g. summarize the deal and the financials' : 'e.g. what was FY2025 EBITDA?'}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
            />
            <button className="btn solid" disabled={asking || !question.trim()} onClick={ask}>
              {asking ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          {answer && (
            <div className="answer">
              <div className="answer-body">{answer.answer}</div>
              <div className="answer-foot mono">
                🔒 copilot was shown: {answer.authorizedDocs.length ? answer.authorizedDocs.join(' · ') : 'no documents'} ({answer.tier})
              </div>
            </div>
          )}
        </section>

        {/* Offers + close */}
        <section className="panel">
          <div className="panel-head">
            <h2>Offers &amp; settlement</h2>
            <span className={`chip ${view?.settled ? 'settled' : ''} mono`}>
              {view?.settled ? '● Settled atomically' : '○ Not settled'}
            </span>
          </div>
          {current.role === 'buyer' && (
            <p className="panel-note kyc-line">
              {view?.kyc
                ? <>Your compliance status: <span className="kyc-badge ok">✓ {view.kyc.level} · {view.kyc.jurisdiction}</span> — the seller can settle with you.</>
                : <>Your compliance status: <span className="kyc-badge pending">KYC pending</span> — the seller cannot settle until you're verified.</>}
            </p>
          )}

          <ul className="offers">
            {view?.offers.map((o) => (
              <li key={o.offerId} className={`offer status-${o.status}`}>
                <div>
                  <div className="o-buyer">
                    {o.buyerLabel}
                    {o.kyc
                      ? <span className="kyc-badge ok" title={`${o.kyc.level} · ${o.kyc.jurisdiction}`}>✓ KYC</span>
                      : <span className="kyc-badge pending">KYC pending</span>}
                  </div>
                  <div className="o-terms mono">{money(o.pricePerUnit)}/unit · {o.quantity.toLocaleString()} units · {money(o.pricePerUnit * o.quantity)}</div>
                </div>
                {current.role === 'seller' && o.status === 'open' && !view?.settled && (
                  <button className="btn" disabled={!o.kyc} title={o.kyc ? '' : 'Bidder must be KYC-cleared'} onClick={() => accept(o.offerId)}>Accept</button>
                )}
                {o.status === 'accepted' && <span className="o-flag mono">ACCEPTED</span>}
              </li>
            ))}
            {view?.offers.length === 0 && <li className="empty">No offers visible to you.</li>}
          </ul>

          {current.role === 'buyer' && !view?.settled && !myOpenOffer && (
            <div className="bid-row">
              <input
                className="field"
                inputMode="decimal"
                placeholder="Your price / unit"
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && Number(bid) > 0) makeOffer() }}
              />
              <button className="btn solid" disabled={!(Number(bid) > 0)} onClick={makeOffer}>
                Submit bid for {view?.deal.quantity.toLocaleString()} units
              </button>
            </div>
          )}

          <div className={`close ${view?.settled ? 'is-settled' : ''} ${settling ? 'is-settling' : ''} ${rollback ? 'is-rollback' : ''}`}>
            <div className="legs">
              {view?.holdings.map((h, i) => (
                <div key={i} className={`leg ${view?.settled ? 'leg-swapped' : ''}`}>
                  <div className="leg-amt mono">{h.instrument === 'USD-CASH' ? money(h.amount) : h.amount.toLocaleString()}</div>
                  <div className="leg-inst mono">{h.instrument}</div>
                  <div className="leg-owner"><span className="leg-arrow">{view?.settled ? '→ ' : ''}</span>{h.ownerLabel}</div>
                </div>
              ))}
              {settling && <div className="swap-pulse" aria-hidden />}
            </div>

            {current.role === 'seller' && acceptedOffer && !view?.settled && (
              <>
                <button className="btn solid wide" disabled={settling} onClick={settle}>
                  {settling ? 'Settling both legs in one transaction…' : 'Settle — payment vs ownership, atomically'}
                </button>
                <button className="btn ghost wide stress" disabled={settling} onClick={stressClose}>
                  Stress-test: pull a leg mid-close →
                </button>
              </>
            )}

            {rollback && (
              <div className="rollback-banner">
                <span className="rb-mark mono">⟲ REVERTED</span>
                {rollback} <em>There is no partial settlement to represent.</em>
              </div>
            )}

            {view?.settled && (
              <div className="settled-banner">
                <strong>One transaction.</strong> Cash and ownership swapped together — or not at all.
              </div>
            )}

            {current.role === 'buyer' && !view?.settled && (
              <div className="muted-note">Only the seller drives settlement.</div>
            )}

            {current.role === 'regulator' && (
              <div className="attest">
                <button className="btn wide" onClick={verifyClose}>
                  Verify the close matched the recorded bid
                </button>
                {attestation && (
                  <div className={`attest-card ${attestation.matched ? 'ok' : 'pending'}`}>
                    {attestation.settled ? (
                      <>
                        <div className="attest-line">
                          <span className="mono">{attestation.matched ? '✓ VERIFIED' : '✗ MISMATCH'}</span>
                          settled cash {money(attestation.settledCash)} {attestation.matched ? '=' : '≠'} winning bid {money(attestation.bidPricePerUnit)} × {attestation.bidQuantity.toLocaleString()}
                        </div>
                        <div className="attest-sub">
                          Attested from the recorded bid and the settlement legs — <strong>without any tier-2 document access</strong>.
                        </div>
                      </>
                    ) : (
                      <div className="attest-line">Not settled yet — nothing to attest.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {view?.capTable && view.capTable.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Cap table</h2>
              <span className="count mono">{current.role === 'seller' || current.role === 'regulator' ? 'Halden Robotics · share registry' : 'your position'}</span>
            </div>
            <ul className="captable">
              {view.capTable.map((r, i) => (
                <li key={i} className={view.settled && (r.holderLabel === 'Meridian' || r.holderLabel === 'Boranic') ? 'is-new' : ''}>
                  <span className="ct-holder">{r.holderLabel}</span>
                  <span className="ct-bar"><span className="ct-fill" style={{ width: `${r.pct}%` }} /></span>
                  <span className="ct-pct mono">{r.pct}%</span>
                  <span className="ct-shares mono">{r.shares.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="panel-note">
              {view.settled
                ? 'Ownership transferred on settlement — the share registry now reflects the new holder.'
                : current.role === 'seller'
                  ? 'The 120,000-share (12%) stake on offer transfers to the buyer the instant the deal closes.'
                  : 'Your tokenized ownership will appear here once the seller settles the deal.'}
            </p>
          </section>
        )}

        <footer className="verified">
          <span className={`mode-pill ${LIVE ? 'live' : ''}`}>{LIVE ? '● LIVE on Canton' : '○ in-browser mock'}</span>
          <span className="verified-note">
            Privacy &amp; atomicity are proven on the ledger by <code>daml test</code> —
            <code>testPrivacyProjection</code>, <code>testAtomicDvP</code>, <code>testAtomicityHolds</code>.
          </span>
        </footer>

        {doc && (
          <div className="doc-modal-backdrop" onClick={() => setDoc(null)}>
            <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
              <div className="doc-modal-head">
                <div>
                  <div className="eyebrow">Tier {doc.tier} · decrypted off-ledger</div>
                  <h3>{doc.title}</h3>
                </div>
                <button className="btn ghost" onClick={() => setDoc(null)}>Close</button>
              </div>
              <pre className="doc-content">{doc.content}</pre>
              <div className="doc-modal-foot mono">
                🔓 AES-256-GCM · {doc.bytes} bytes ciphertext · {doc.hash.slice(0, 23)}… — the key service
                released this because the ledger confirms your grant covers tier {doc.tier}.
              </div>
            </div>
          </div>
        )}

        {msg && <div className="toast" onClick={() => setMsg(null)}>{msg}</div>}
      </main>
    </div>
  )
}

function viewerBlurb(role: 'seller' | 'buyer' | 'regulator') {
  if (role === 'seller') return 'You see every buyer, every document, the full trail, and both sides of the close.'
  if (role === 'regulator') return 'You can verify the close matched the recorded bids — without seeing tier-2 contents.'
  return 'You see only your tier and your own activity. Rival bidders are invisible to you.'
}
