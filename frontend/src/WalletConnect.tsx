import { useEffect, useState } from 'react'
import { initLoop, useLoopWallet } from './ledger/loopWallet'

const short = (p: string) => (p.length > 22 ? `${p.slice(0, 10)}…${p.slice(-8)}` : p)

// Render a token balance the way Loop reports it (integer coin string + decimals).
function fmtAmount(raw: string, decimals: number) {
  const n = Number(raw)
  if (!isFinite(n)) return raw
  const v = n / Math.pow(10, decimals || 0)
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

// Real Canton sign-in. Connecting proves the user's own external party and reads their
// real on-chain holdings straight from the ledger — no backend, no mock.
export default function WalletConnect({ onRequestAccess, requested }: { onRequestAccess?: () => Promise<void>; requested?: boolean }) {
  const w = useLoopWallet()
  const [requesting, setRequesting] = useState(false)
  useEffect(() => { initLoop() }, [])

  async function request() {
    if (!onRequestAccess) return
    setRequesting(true)
    try { await onRequestAccess() } finally { setRequesting(false) }
  }

  if (w.status !== 'connected') {
    return (
      <div className="wallet wallet-idle">
        <div className="eyebrow">Your wallet</div>
        <button className="btn wallet-connect" onClick={w.connect} disabled={w.status === 'connecting'}>
          {w.status === 'connecting' ? 'Connecting…' : '🔗 Connect Loop Wallet'}
        </button>
        <p className="wallet-note">
          Sign in with your <strong>real Canton identity</strong> (5N Loop). We read your
          on-chain holdings live — nothing custodial, nothing mocked.
        </p>
        {w.error && <p className="wallet-err">{w.error}</p>}
      </div>
    )
  }

  return (
    <div className="wallet wallet-on">
      <div className="wallet-head">
        <div className="eyebrow">Connected · Loop wallet</div>
        <button className="wallet-disc" onClick={w.disconnect} title="Disconnect">Disconnect</button>
      </div>
      <div className="wallet-id mono" title={w.partyId ?? ''}>
        <span className="wallet-dot" />{short(w.partyId ?? '')}
      </div>
      {w.email && <div className="wallet-email">{w.email}</div>}

      <div className="wallet-holdings">
        <div className="wallet-holdings-head">
          <span className="eyebrow">On-chain holdings</span>
          <button className="wallet-refresh" onClick={w.refresh} disabled={w.loadingHoldings} title="Refresh from ledger">
            {w.loadingHoldings ? '…' : '↻'}
          </button>
        </div>
        {w.holdings.length === 0 ? (
          <p className="wallet-note">{w.loadingHoldings ? 'Reading the ledger…' : 'No holdings on this party yet.'}</p>
        ) : (
          <ul className="wallet-list">
            {w.holdings.map((h) => (
              <li key={`${h.admin}:${h.id}`} className="wallet-row">
                <span className="wallet-sym">{h.symbol}</span>
                <span className="wallet-org">{h.orgName}</span>
                <span className="wallet-bal mono">{fmtAmount(h.unlocked, h.decimals)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="wallet-note">
        This is your real party. Your commit’s payment leg moves tokens from here.
      </p>

      {onRequestAccess && (
        <button className="btn wallet-request" onClick={request} disabled={requesting || requested}>
          {requested ? '✓ Access requested' : requesting ? 'Requesting…' : 'Request access to this deal'}
        </button>
      )}
    </div>
  )
}
