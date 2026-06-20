import { useEffect, useState } from 'react'
import { mockClient } from './ledger/mockClient'
import type { DealView } from './types'

const client = mockClient

function money(n: number) {
  return n >= 1000 ? `$${(n).toLocaleString()}` : `$${n}`
}

export default function App() {
  const viewers = client.viewers()
  const [viewer, setViewer] = useState(viewers[0].party)
  const [view, setView] = useState<DealView | null>(null)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [settling, setSettling] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    setView(await client.getDealView(viewer))
  }
  useEffect(() => {
    load()
  }, [viewer])

  const current = viewers.find((v) => v.party === viewer)!
  const acceptedOffer = view?.offers.find((o) => o.status === 'accepted')

  async function openDoc(docId: string) {
    try {
      await client.recordAccess(viewer, docId)
      setOpened((o) => ({ ...o, [docId]: true }))
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  async function accept(offerId: string) {
    await client.acceptOffer(viewer, offerId)
    await load()
  }

  async function settle() {
    setSettling(true)
    setMsg(null)
    try {
      await client.settle(viewer)
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setSettling(false)
    }
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <span className="mark">▚</span>
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
                onClick={() => { setViewer(v.party); setMsg(null) }}
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
                    <button className="btn ghost" onClick={() => openDoc(d.docId)}>
                      {opened[d.docId] ? 'Logged — view again' : 'Open document'}
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

        {/* Offers + close */}
        <section className="panel">
          <div className="panel-head">
            <h2>Offers &amp; settlement</h2>
            <span className={`chip ${view?.settled ? 'settled' : ''} mono`}>
              {view?.settled ? '● Settled atomically' : '○ Not settled'}
            </span>
          </div>

          <ul className="offers">
            {view?.offers.map((o) => (
              <li key={o.offerId} className={`offer status-${o.status}`}>
                <div>
                  <div className="o-buyer">{o.buyerLabel}</div>
                  <div className="o-terms mono">{money(o.pricePerUnit)}/unit · {o.quantity.toLocaleString()} units · {money(o.pricePerUnit * o.quantity)}</div>
                </div>
                {current.role === 'seller' && o.status === 'open' && !view?.settled && (
                  <button className="btn" onClick={() => accept(o.offerId)}>Accept</button>
                )}
                {o.status === 'accepted' && <span className="o-flag mono">ACCEPTED</span>}
              </li>
            ))}
            {view?.offers.length === 0 && <li className="empty">No offers visible to you.</li>}
          </ul>

          <div className={`close ${view?.settled ? 'is-settled' : ''} ${settling ? 'is-settling' : ''}`}>
            <div className="legs">
              {view?.holdings.map((h, i) => (
                <div key={i} className="leg">
                  <div className="leg-amt mono">{h.instrument === 'USD-CASH' ? money(h.amount) : h.amount.toLocaleString()}</div>
                  <div className="leg-inst mono">{h.instrument}</div>
                  <div className="leg-owner">{h.ownerLabel}</div>
                </div>
              ))}
            </div>
            {current.role === 'seller' && acceptedOffer && !view?.settled && (
              <button className="btn solid wide" disabled={settling} onClick={settle}>
                {settling ? 'Settling…' : 'Settle — payment vs ownership, atomically'}
              </button>
            )}
            {view?.settled && (
              <div className="settled-banner">
                One transaction. Cash and ownership swapped together — or not at all.
              </div>
            )}
            {current.role !== 'seller' && !view?.settled && (
              <div className="muted-note">Only the seller drives settlement.</div>
            )}
          </div>
        </section>

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
