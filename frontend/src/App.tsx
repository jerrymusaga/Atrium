import { useEffect, useRef, useState } from 'react'
import { mockClient } from './ledger/mockClient'
import { httpClient } from './ledger/httpClient'
import { AtriumMark } from './AtriumMark'
import { Landing } from './Landing'
import WalletConnect from './WalletConnect'
import { useLoopWallet, transferToken } from './ledger/loopWallet'
import type { Asset, AskResult, CloseAttestation, DealView, DistributionSummary, DocContent, IntegrityReport, LedgerTxn, LifecycleKind, ReadinessResult, Viewer } from './types'
import { ASSETS } from './types'

const DEMO_TIERS = ['Teaser', 'Financials', 'Legal']

const LIVE = import.meta.env.VITE_LIVE === '1'
// Loop wallet sign-in + wallet-signed CIP-56 payment leg. Off by default: the demo runs
// entirely executor-side so anyone can drive a deal to close without a Canton wallet.
// Set VITE_WALLET=1 to expose the wallet flow (real party, holdings, wallet-signed commits).
const WALLET = import.meta.env.VITE_WALLET === '1'
const client = LIVE ? httpClient : mockClient

// Format a per-share rate readably even when it's a small fraction.
function fmtRate(n: number) {
  return n >= 1 ? n.toFixed(2) : n.toPrecision(2)
}
// USD formatter (round; compact for big figures).
function fmtUsd(n: number) {
  return '$' + Math.round(n).toLocaleString()
}

// The human-readable resolution an approver signs in the ceremony modal.
function resolutionText(role: string, signer: string) {
  return `HALDEN ROBOTICS — ${role} RESOLUTION

Resolution
  The ${role} hereby approves the closing of the Series A on the terms
  in the Series A term sheet, subject to the remaining on-ledger
  closing conditions.

Signed by:  ${signer}
Role:       ${role}

By signing, this resolution is recorded as an on-ledger Approval on
Canton, and the signed PDF is encrypted in the data room with its hash
anchored on-ledger for tamper-evidence.`
}

// Suggest a download filename extension from the media type.
function extFor(mime?: string) {
  if (!mime) return ''
  if (mime === 'application/pdf') return '.pdf'
  if (mime === 'text/csv') return '.csv'
  if (mime === 'text/plain') return '.txt'
  if (mime === 'application/json') return '.json'
  if (mime.startsWith('image/')) return '.' + mime.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')
  return ''
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
  const [entered, setEntered] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docTier, setDocTier] = useState(1)
  const [docContent, setDocContent] = useState('')
  const [docFile, setDocFile] = useState<{ name: string; mime: string; dataUrl: string; size: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [addingDoc, setAddingDoc] = useState(false)
  const [settling, setSettling] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [rollback, setRollback] = useState<string | null>(null)
  const [attestation, setAttestation] = useState<CloseAttestation | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [inviteTier, setInviteTier] = useState(1)
  const [commitAmt, setCommitAmt] = useState('')
  const [commitAsset, setCommitAsset] = useState<Asset>('USDCx')
  const [committing, setCommitting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [tampering, setTampering] = useState<string | null>(null)
  const [distAmount, setDistAmount] = useState('500000')
  const [declaring, setDeclaring] = useState(false)
  const [activity, setActivity] = useState<LedgerTxn[]>([])
  const [confirmNew, setConfirmNew] = useState(false)
  const [accessReqs, setAccessReqs] = useState<import('./types').AccessRequest[]>([])
  const [reqSent, setReqSent] = useState(false)
  // Founder "set up the room" flow
  const [setupTitle, setSetupTitle] = useState('Halden Robotics — $2.5M Series A')
  const [setupInstrument, setSetupInstrument] = useState('HALDEN-EQUITY')
  const [setupTarget, setSetupTarget] = useState('2500000')
  const [setupQuantity, setSetupQuantity] = useState('120000')
  const [setupTiers, setSetupTiers] = useState<string[]>([...DEMO_TIERS])
  const [creatingDeal, setCreatingDeal] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)

  const wallet = useLoopWallet()
  const walletShort = wallet.partyId ? `${wallet.partyId.slice(0, 10)}…${wallet.partyId.slice(-6)}` : ''
  // Balance of the currently-selected commit asset in the connected wallet, if held.
  const walletBalance = wallet.holdings.find((h) => h.symbol === commitAsset || h.id === commitAsset)
  const walletAvail = walletBalance ? Number(walletBalance.unlocked) / Math.pow(10, walletBalance.decimals || 0) : 0
  // With the wallet flow on, a live commit must be backed by a real wallet-signed transfer.
  // With it off (the default), commits go straight through the executor — nothing blocks.
  const liveCommitBlock: string | null = !(LIVE && WALLET) ? null
    : wallet.status !== 'connected' ? 'connect'
    : !walletBalance ? 'no-asset'
    : Number(commitAmt) > walletAvail ? 'insufficient'
    : null

  const viewCache = useRef<Record<string, DealView>>({})

  async function refreshViewers() {
    const vs = await client.listViewers()
    setViewers(vs)
    setViewer((v) => v || vs[0]?.party || '')
    void Promise.all(vs.map(async (v) => {
      try { viewCache.current[v.party] = await client.getDealView(v.party) } catch { /* ignore */ }
    }))
    return vs
  }
  useEffect(() => { refreshViewers() }, [])

  async function load(invalidate = false) {
    if (!viewer) return
    if (invalidate) viewCache.current = {}
    const cached = viewCache.current[viewer]
    if (cached) setView(cached)
    const fresh = await client.getDealView(viewer)
    viewCache.current[viewer] = fresh
    setView(fresh)
    if (invalidate) client.getActivity().then(setActivity).catch(() => {})
  }
  useEffect(() => { load() }, [viewer])

  // Poll the live Canton transaction feed so judges watch txns land on-ledger in real time.
  useEffect(() => {
    if (!entered) return
    let alive = true
    const tick = () => client.getActivity().then((a) => { if (alive) setActivity(a) }).catch(() => {})
    tick()
    const h = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(h) }
  }, [entered])

  const current = viewers.find((v) => v.party === viewer)
  const isApprover = current?.role === 'board' || current?.role === 'legal' || current?.role === 'compliance'
  const approverRole = current?.role === 'board' ? 'BOARD' : current?.role === 'legal' ? 'LEGAL' : 'COMPLIANCE'
  const isSeller = current?.role === 'seller'
  useEffect(() => {
    if (!isSeller) { setReadiness(null); return }
    client.getReadiness().then(setReadiness).catch(() => {})
  }, [view, isSeller])

  // Founder polls for pending wallet access requests (self-onboarding investors).
  useEffect(() => {
    if (!isSeller || !LIVE) { setAccessReqs([]); return }
    let alive = true
    const tick = () => client.listAccessRequests().then((r) => { if (alive) setAccessReqs(r) }).catch(() => {})
    tick()
    const h = setInterval(tick, 6000)
    return () => { alive = false; clearInterval(h) }
  }, [isSeller])

  // Connected investor asks the founder for access using their real Loop party id.
  async function requestAccess() {
    if (!wallet.partyId) return
    setMsg(null)
    try {
      await client.requestAccess(wallet.partyId, wallet.email || walletShort)
      setReqSent(true)
      setMsg('Access requested — the founder can now grant your wallet on-ledger.')
    } catch (e) { setMsg((e as Error).message) }
  }

  // Founder grants a pending request on-ledger (issues the AccessGrant to the real party).
  async function grantAccess(party: string, tier: number) {
    setMsg(null)
    try {
      await client.grantAccess(viewer, party, tier)
      setAccessReqs((rs) => rs.filter((r) => r.party !== party))
      await refreshViewers()
      await load(true)
      setMsg(`Granted access on-ledger to ${party.slice(0, 14)}… at ${tierName(tier)}.`)
    } catch (e) { setMsg((e as Error).message) }
  }

  async function invite() {
    try {
      await client.inviteBuyer(viewer, inviteName, inviteTier)
      setInviteName('')
      await refreshViewers()
      setMsg(`Invited ${inviteName} at tier ${inviteTier} — switch the lens to see their view.`)
    } catch (e) { setMsg((e as Error).message) }
  }

  function onPickFile(f?: File) {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) { setMsg('Keep the file under 8 MB for the demo.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      setDocFile({ name: f.name, mime: f.type || 'application/octet-stream', dataUrl: String(reader.result), size: f.size })
      if (!docTitle.trim()) setDocTitle(f.name.replace(/\.[^.]+$/, ''))
    }
    reader.readAsDataURL(f)
  }
  function clearFile() { setDocFile(null); if (fileRef.current) fileRef.current.value = '' }

  async function addDoc() {
    const name = (docTitle.trim() || docFile?.name || '').trim()
    if (!name) return
    if (!docFile && !docContent.trim()) return
    setAddingDoc(true)
    setMsg(null)
    try {
      await client.addDocument(viewer, docFile
        ? { title: name, tier: docTier, file: { name: docFile.name, mime: docFile.mime, dataUrl: docFile.dataUrl } }
        : { title: name, tier: docTier, content: docContent })
      const t = docTier
      setDocTitle(''); setDocContent(''); clearFile()
      await load(true)
      setMsg(`Added "${name}" to “${tierName(t)}” — encrypted; only investors granted this tier or higher can decrypt it.`)
    } catch (e) { setMsg((e as Error).message) } finally { setAddingDoc(false) }
  }


  async function commit() {
    const amt = Number(commitAmt)
    if (!(amt > 0)) return
    setCommitting(true)
    setMsg(null)
    try {
      let payment: import('./types').CommitPayment | undefined
      // When the wallet flow is enabled, a live commitment must be backed by a genuine
      // CIP-56 token transfer the investor signs in their own Loop wallet. Otherwise the
      // commitment is recorded on-ledger by the executor for the party holding the lens.
      if (LIVE && WALLET) {
        if (wallet.status !== 'connected') {
          setMsg('Connect your Loop wallet (left) to invest — commitments settle on-chain.')
          setCommitting(false); return
        }
        if (!walletBalance) {
          setMsg(`Your Loop wallet holds no ${commitAsset}. Choose an asset you hold, or top up.`)
          setCommitting(false); return
        }
        if (amt > walletAvail) {
          setMsg(`Your Loop wallet holds ${walletAvail.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${commitAsset} — reduce the amount or top up.`)
          setCommitting(false); return
        }
        const payTo = await client.getPayToParty()
        setMsg('Approve the transfer in your Loop wallet…')
        const r = await transferToken(payTo.party, commitAmt, { admin: walletBalance.admin, id: walletBalance.id }, `Atrium — ${view?.deal?.title ?? 'commitment'}`)
        payment = { updateId: r.updateId, walletParty: wallet.partyId ?? undefined, symbol: commitAsset }
      }
      await client.commit(viewer, commitAsset, amt, payment)
      setCommitAmt('')
      await load(true)
      const usd = amt * (view?.rates?.[commitAsset] ?? 0)
      setMsg(payment?.updateId
        ? `Committed ${amt} ${commitAsset} (${fmtUsd(usd)}) — real transfer signed in your Loop wallet · updateId ${payment.updateId.slice(0, 16)}…`
        : `Committed ${amt} ${commitAsset} (${fmtUsd(usd)}) on-ledger — the founder sees your commitment toward the raise target.`)
    } catch (e) { setMsg(`Commit not recorded — ${(e as Error).message}`) } finally { setCommitting(false) }
  }

  async function signAndApprove() {
    const name = signerName.trim()
    if (!name) return
    setApproving(true)
    setMsg(null)
    try {
      const envelopeId = `ATR-${approverRole}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      await client.approve(viewer, approverRole, { signedBy: name, envelopeId })
      setSigning(false); setSignerName('')
      await load(true)
      setMsg(`${approverRole} resolution signed by ${name} — recorded on-ledger and the signed PDF anchored on Canton (envelope ${envelopeId}).`)
    } catch (e) { setMsg((e as Error).message) } finally { setApproving(false) }
  }

  async function verifyIntegrity() {
    setVerifying(true); setMsg(null)
    try {
      setIntegrity(await client.verifyIntegrity(viewer))
    } catch (e) { setMsg((e as Error).message) } finally { setVerifying(false) }
  }

  async function tamperVault(docId: string) {
    setTampering(docId); setMsg(null)
    try {
      await client.tamperVault(viewer, docId)
      setIntegrity(await client.verifyIntegrity(viewer))
    } catch (e) { setMsg((e as Error).message) } finally { setTampering(null) }
  }

  async function declareDistribution() {
    const amt = Number(distAmount)
    if (!(amt > 0)) { setMsg('Set a total USD amount to distribute.'); return }
    setDeclaring(true); setMsg(null)
    try {
      await client.distribute(viewer, amt)
      await load(true)
      setMsg(`Declared a ${fmtUsd(amt)} distribution (USDCx) — every shareholder was paid pro-rata in one atomic transaction; each sees only their own receipt.`)
    } catch (e) { setMsg((e as Error).message) } finally { setDeclaring(false) }
  }

  async function createDeal() {
    const target = Number(setupTarget)
    const quantity = Number(setupQuantity)
    const tiers = setupTiers.map((t) => t.trim()).filter(Boolean)
    if (!(target > 0) || tiers.length === 0) { setMsg('Set a raise target and at least one named tier.'); return }
    if (!(quantity > 0)) { setMsg('Set the stake on offer (shares).'); return }
    setCreatingDeal(true); setMsg(null)
    try {
      await client.createDeal(viewer, { title: setupTitle, instrument: setupInstrument, raiseTarget: target, quantity, tiers })
      await refreshViewers()
      await load(true)
      setMsg(`Deal room created — ${fmtUsd(target)} for ${quantity.toLocaleString()} shares, tiers ${tiers.join(' · ')}. Now add documents and invite investors.`)
    } catch (e) { setMsg((e as Error).message) } finally { setCreatingDeal(false) }
  }

  async function loadDemo() {
    setLoadingDemo(true); setMsg(null)
    try {
      await client.loadDemo()
      await refreshViewers()
      await load(true)
      setMsg('Fundraise demo loaded — investors, documents, commitments and governance roles are live.')
    } catch (e) { setMsg((e as Error).message) } finally { setLoadingDemo(false) }
  }

  async function startNewDeal() {
    setConfirmNew(false)
    setMsg(null)
    try {
      await client.startNewDeal(viewer)
      await refreshViewers()
      await load(true)
      setMsg('Cleared — set up your deal room: name the tiers, set the raise target and stake, then invite investors.')
    } catch (e) { setMsg((e as Error).message) }
  }

  if (!entered) return <Landing onEnter={() => setEntered(true)} live={LIVE} />
  if (!current) return <div className="app booting">Loading the deal room…</div>

  async function openDoc(docId: string) {
    setOpening(docId); setMsg(null)
    try {
      const content = await client.openDocument(viewer, docId)
      setDoc(content)
      setOpened((o) => ({ ...o, [docId]: true }))
      await load(true)
    } catch (e) { setMsg((e as Error).message) } finally { setOpening(null) }
  }


  async function settle() {
    setSettling(true); setMsg(null); setRollback(null)
    try {
      await client.settle(viewer)
      await load(true)
    } catch (e) { setMsg((e as Error).message) } finally { setSettling(false) }
  }

  async function stressClose() {
    setSettling(true); setRollback(null); setMsg(null)
    try {
      await client.attemptBrokenClose(viewer)
    } catch (e) {
      setRollback((e as Error).message)
      await load(true)
    } finally { setSettling(false) }
  }

  async function verifyClose() {
    setAttestation(await client.attestClose(viewer))
  }

  async function ask() {
    if (!question.trim()) return
    setAsking(true); setAnswer(null)
    try { setAnswer(await client.ask(viewer, question)) }
    catch (e) { setMsg((e as Error).message) } finally { setAsking(false) }
  }

  const conds = view?.conditions
  const allGreen = conds?.allGreen ?? false
  const tiers = view?.deal?.tiers ?? []
  const tierName = (t: number) => tiers[t - 1] ?? `Tier ${t}`
  const noDeal = isSeller && !!view && !view.deal

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand" role="button" title="Back to overview" onClick={() => setEntered(false)}>
          <AtriumMark className="mark" />
          <div>
            <div className="brand-name">ATRIUM</div>
            <div className="brand-sub">private capital markets OS</div>
          </div>
        </div>

        {WALLET && <WalletConnect onRequestAccess={LIVE ? requestAccess : undefined} requested={reqSent} />}

        {view?.deal && (
          <div className="deal-card">
            <div className="eyebrow">Active fundraise</div>
            <h1 className="deal-title">{view.deal.title}</h1>
            <dl className="deal-meta">
              <div><dt>Instrument</dt><dd className="mono">{view.deal.instrument}</dd></div>
              <div><dt>Equity on offer</dt><dd className="mono">{view.deal.quantity.toLocaleString()} units</dd></div>
              {view.deal.raiseTarget ? <div><dt>Raise target</dt><dd className="mono">{fmtUsd(view.deal.raiseTarget)}</dd></div> : null}
              <div><dt>Deal ref</dt><dd className="mono">{view.deal.dealId}</dd></div>
            </dl>
            {isSeller && (
              <button className="deal-new" onClick={() => setConfirmNew(true)}>⟲ Start a new deal</button>
            )}
          </div>
        )}

        <div className="lens">
          <div className="eyebrow">Viewing through</div>
          <div className="lens-options">
            {viewers.map((v) => (
              <button
                key={v.party}
                className={`lens-opt ${v.party === viewer ? 'is-active' : ''} role-${v.role}`}
                onClick={() => { setViewer(v.party); setMsg(null); setAnswer(null); setDoc(null); setIntegrity(null) }}
              >
                <span className="lens-dot" />
                <span className="lens-label">{v.label}</span>
                {v.live && <span className="live-tag" title="Real party on its own validator">● live</span>}
              </button>
            ))}
          </div>
          <p className="lens-note">
            The ledger shows each party only their slice. Switch the lens — the same deal
            looks different to everyone.
          </p>
        </div>

        {current.role === 'seller' && !view?.settled && view?.deal && (
          <div className="invite">
            <div className="eyebrow">Invite an investor</div>
            <div className="invite-row">
              <input
                className="field"
                placeholder="Investor name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && inviteName.trim()) invite() }}
              />
              <select className="field tier-sel" value={inviteTier} onChange={(e) => setInviteTier(Number(e.target.value))}>
                {(tiers.length ? tiers : ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']).map((label, i) => (
                  <option key={i} value={i + 1}>{label}</option>
                ))}
              </select>
            </div>
            <button className="btn wide" disabled={!inviteName.trim()} onClick={invite}>
              Grant up to “{tierName(inviteTier)}”
            </button>

            {WALLET && accessReqs.length > 0 && (
              <div className="access-reqs">
                <div className="eyebrow">Wallet access requests</div>
                <ul className="access-list">
                  {accessReqs.map((r) => (
                    <li key={r.party} className="access-row">
                      <div className="access-who">
                        <span className="access-name">{r.name}</span>
                        <span className="access-party mono" title={r.party}>{r.party.slice(0, 12)}…{r.party.slice(-6)}</span>
                      </div>
                      <button className="btn access-grant" onClick={() => grantAccess(r.party, inviteTier)}>
                        Grant “{tierName(inviteTier)}”
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="lens-note">Grants a real on-ledger AccessGrant to the investor’s own Loop party at the tier selected above.</p>
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="stage">
        <header className="seeing">
          You are <strong>{current.label}</strong>. {viewerBlurb(current.role)}
        </header>

        {/* ── Live Canton transaction feed — judges watch txns land on-ledger ── */}
        {activity.length > 0 && (
          <section className="panel panel-activity">
            <div className="panel-head">
              <h2>Ledger activity</h2>
              <span className={`chip mono ${LIVE ? 'settled' : ''}`}>{LIVE ? '● live on Canton' : '○ simulated'} · {activity.length} txns</span>
            </div>
            <ul className="txfeed">
              {activity.slice(0, 10).map((t, i) => (
                <li key={t.updateId + i} className="txrow">
                  <span className="tx-time mono">{t.at || 'close'}</span>
                  <span className="tx-actor">{t.actor}</span>
                  <span className="tx-summary mono">{t.summary}</span>
                  <span className="tx-id mono" title={`updateId ${t.updateId}`}>{t.updateId.slice(0, 14)}…</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Founder: set up the room (shown on a fresh ledger, before a deal exists) ── */}
        {noDeal && (
          <section className="panel panel-setup">
            <div className="panel-head">
              <h2>Set up the deal room</h2>
              <span className="count mono">no deal on-ledger yet</span>
            </div>
            <p className="panel-note">
              Name your access tiers and set the raise target. The tier names become the
              on-ledger <code>Deal.tiers</code> — every document, grant and the diligence copilot
              speak in your names (e.g. “Financials”), not generic numbers.
            </p>

            <div className="setup-grid">
              <label className="setup-field">
                <span className="setup-lbl">Deal title</span>
                <input className="field" value={setupTitle} onChange={(e) => setSetupTitle(e.target.value)} placeholder="e.g. Halden Robotics — Series A" />
              </label>
              <label className="setup-field">
                <span className="setup-lbl">Instrument</span>
                <input className="field" value={setupInstrument} onChange={(e) => setSetupInstrument(e.target.value)} placeholder="e.g. HALDEN-EQUITY" />
              </label>
              <label className="setup-field">
                <span className="setup-lbl">Raise target (USD)</span>
                <input className="field" inputMode="decimal" value={setupTarget} onChange={(e) => setSetupTarget(e.target.value)} placeholder="2500000" />
              </label>
              <label className="setup-field">
                <span className="setup-lbl">
                  Stake on offer (shares)
                  {Number(setupQuantity) > 0 && <span className="setup-hint mono"> · ~{((Number(setupQuantity) / (880000 + Number(setupQuantity))) * 100).toFixed(1)}% of the company</span>}
                </span>
                <input className="field" inputMode="numeric" value={setupQuantity} onChange={(e) => setSetupQuantity(e.target.value)} placeholder="120000" />
              </label>
            </div>

            <div className="setup-tiers">
              <span className="setup-lbl">Named access tiers (lowest → highest)</span>
              {setupTiers.map((t, i) => (
                <div key={i} className="setup-tier-row">
                  <span className="setup-tier-num mono">T{i + 1}</span>
                  <input
                    className="field"
                    value={t}
                    placeholder={`Tier ${i + 1} name`}
                    onChange={(e) => setSetupTiers((ts) => ts.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button
                    className="btn ghost setup-tier-del"
                    disabled={setupTiers.length <= 1}
                    title="Remove tier"
                    onClick={() => setSetupTiers((ts) => ts.filter((_, j) => j !== i))}
                  >×</button>
                </div>
              ))}
              <button className="btn ghost" disabled={setupTiers.length >= 6} onClick={() => setSetupTiers((ts) => [...ts, ''])}>
                + Add a tier
              </button>
            </div>

            <div className="setup-actions">
              <button className="btn solid wide" disabled={creatingDeal} onClick={createDeal}>
                {creatingDeal ? 'Creating the deal room on-ledger…' : 'Create the deal room'}
              </button>
              <div className="setup-or">or</div>
              <button className="btn wide" disabled={loadingDemo} onClick={loadDemo}>
                {loadingDemo ? 'Loading the fundraise demo…' : '⚡ Load the full fundraise demo'}
              </button>
            </div>
            <p className="panel-note setup-demo-note">
              The demo seeds three investors committing in USDCx / cBTC / cETH, multi-tier documents
              and the Board / Legal / Compliance roles — everything needed to drive the close.
            </p>
          </section>
        )}

        {/* ── Approver panel (Board / Legal / Compliance) ── */}
        {isApprover && (
          <section className="panel panel-approver">
            <div className="panel-head">
              <h2>{approverRole === 'BOARD' ? 'Board' : approverRole === 'LEGAL' ? 'Legal' : 'Compliance'} Approval</h2>
              <span className={`chip mono ${view?.myApproval ? 'settled' : ''}`}>
                {view?.myApproval ? '● Approved' : '○ Pending'}
              </span>
            </div>
            {view?.myApproval ? (
              <>
                <p className="panel-note">
                  Your <strong>{view.myApproval.role}</strong> resolution was signed and recorded on-ledger at {view.myApproval.approvedAt}.
                  A signed PDF resolution is anchored on Canton — tamper-evident and included in the audit trail + integrity check.
                </p>
                <div className="sig-receipt">
                  <span className="sig-check mono">✓ SIGNED</span>
                  {view.myApproval.envelopeId && <span className="sig-title mono">{view.myApproval.envelopeId}</span>}
                  <span className="sig-hash mono">{view.myApproval.documentHash || view.documents.find((d) => d.docId === `resolution-${approverRole.toLowerCase()}`)?.contentHash}</span>
                </div>
              </>
            ) : (
              <>
                <p className="panel-note">
                  Review the fundraise. If satisfied, sign the resolution — the founder cannot close
                  the deal until all required roles have signed. Signing anchors a tamper-evident PDF on Canton.
                </p>
                <button className="btn solid wide" disabled={approving} onClick={() => { setSignerName(''); setSigning(true) }}>
                  ✍ Review &amp; sign the {approverRole} resolution
                </button>
              </>
            )}
          </section>
        )}

        {/* ── Documents ── */}
        {!isApprover && !noDeal && (
          <section className="panel">
            <div className="panel-head">
              <h2>Data room</h2>
              <span className="count mono">{view?.documents.filter((d) => d.accessible).length ?? 0}/{view?.documents.length ?? 0} in your tier</span>
            </div>
            <div className="docs">
              {view?.documents.map((d) => (
                <article key={d.docId} className={`doc ${d.accessible ? 'is-open' : 'is-sealed'}`}>
                  <div className="doc-top">
                    <span className="tier mono" title={`Access tier ${d.tier}`}>{(d.tierLabel ?? `TIER ${d.tier}`).toUpperCase()}</span>
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
                      <div className="redaction"><span /><span /><span /></div>
                      <div className="sealed-label">Sealed — not in your tier</div>
                    </>
                  )}
                </article>
              ))}
              {view?.documents.length === 0 && (
                <div className="empty-room">
                  {current.role === 'seller'
                    ? 'No documents yet — add the teaser, financials, a term sheet, or upload files below. Each is encrypted and gated to the tier you choose.'
                    : 'No documents have been shared with you yet.'}
                </div>
              )}
            </div>

            {current.role === 'seller' && !view?.settled && (
              <div className="add-doc">
                <div className="add-doc-row">
                  <input className="field" placeholder="New document title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                  {tiers.length ? (
                    <select className="field tier-sel" value={docTier} title="Access tier" onChange={(e) => setDocTier(Number(e.target.value))}>
                      {tiers.map((label, i) => <option key={i} value={i + 1}>{label}</option>)}
                    </select>
                  ) : (
                    <input className="field doc-tier" type="number" min={1} value={docTier} title="Access tier" onChange={(e) => setDocTier(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                  )}
                </div>
                <label className="file-drop">
                  <input
                    ref={fileRef}
                    type="file"
                    className="file-input"
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    onChange={(e) => onPickFile(e.currentTarget.files?.[0])}
                  />
                  {docFile ? (
                    <span className="file-chosen">
                      📎 {docFile.name} · {(docFile.size / 1024).toFixed(0)} KB
                      <button className="file-clear" title="Remove file" onClick={(e) => { e.preventDefault(); clearFile() }}>×</button>
                    </span>
                  ) : (
                    <span className="file-prompt">📎 Upload a file — PDF, image, CSV… (encrypted off-ledger, tier-gated)</span>
                  )}
                </label>
                {!docFile && (
                  <textarea className="field add-doc-content" rows={3} placeholder="…or type the document contents — encrypted off-ledger; key released only to investors granted this tier." value={docContent} onChange={(e) => setDocContent(e.target.value)} />
                )}
                <button className="btn" disabled={addingDoc || (!docFile && (!docTitle.trim() || !docContent.trim()))} onClick={addDoc}>
                  {addingDoc ? 'Encrypting & recording…' : `+ Add to “${tierName(docTier)}”`}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── On-chain audit trail (founder / oversight lens) ── */}
        {(isSeller || current.role === 'regulator') && !noDeal && view?.lifecycle && (
          <section className="panel">
            <div className="panel-head">
              <h2>On-chain audit trail</h2>
              <span className="count mono">{view.lifecycle.length} ledger events</span>
            </div>
            <p className="panel-note">
              Every state change on Canton, in order: access grants · document disclosures ·
              capital commitments · governance approvals · settlement. Tamper-proof and ledger-timestamped —
              the complete record of how this deal reached close.
            </p>
            <ol className="audit">
              {view.lifecycle.map((e, i) => (
                <li key={i} className={`audit-item audit-${e.kind}`}>
                  <span className="audit-rail"><span className="audit-dot" /></span>
                  <span className="audit-time mono">{e.at || 'close'}</span>
                  <span className="audit-kind mono">{auditKindLabel(e.kind)}</span>
                  <span className="audit-body"><strong>{e.actor}</strong> {e.detail}</span>
                </li>
              ))}
              {view.lifecycle.length === 0 && <li className="empty">No ledger events recorded yet.</li>}
            </ol>
          </section>
        )}

        {/* ── Provable integrity (founder / oversight lens) ── */}
        {(isSeller || current.role === 'regulator') && !noDeal && (
          <section className="panel panel-integrity">
            <div className="panel-head">
              <h2>Provable integrity</h2>
              <span className={`chip mono ${integrity ? (integrity.allIntact ? 'settled' : 'breach') : ''}`}>
                {integrity ? (integrity.allIntact ? `● ${integrity.intactCount}/${integrity.total} verified` : `✗ ${integrity.total - integrity.intactCount} tampered`) : '○ not yet checked'}
              </span>
            </div>
            <p className="panel-note">
              Documents live encrypted off-chain, but Canton holds each blob's <code>contentHash</code>.
              This re-hashes every blob in the vault <strong>right now</strong> and proves byte-for-byte that it
              still matches the immutable hash on the ledger. Alter a blob off-chain and the ledger catches it.
            </p>

            <button className="btn solid wide" disabled={verifying} onClick={verifyIntegrity}>
              {verifying ? 'Re-hashing the vault & checking Canton…' : '🔐 Verify the vault against Canton'}
            </button>

            {integrity && (
              <>
                <div className={`integrity-verdict ${integrity.total === 0 ? '' : integrity.allIntact ? 'ok' : 'breach'}`}>
                  {integrity.total === 0 ? (
                    <>No documents in the vault yet — add one and its hash will be anchored on Canton, ready to verify.</>
                  ) : integrity.allIntact ? (
                    <><span className="iv-mark mono">✓ VERIFIED</span> all {integrity.total} documents match their on-ledger hash byte-for-byte. The off-chain vault is intact. <span className="mono iv-time">checked {integrity.checkedAt}</span></>
                  ) : (
                    <><span className="iv-mark mono">✗ INTEGRITY BREACH</span> {integrity.total - integrity.intactCount} document(s) no longer match the ledger — the off-chain blob was altered. <span className="mono iv-time">checked {integrity.checkedAt}</span></>
                  )}
                </div>

                <ul className="integrity-docs">
                  {integrity.documents.map((d) => (
                    <li key={d.docId} className={`idoc ${d.intact ? 'idoc-ok' : 'idoc-breach'}`}>
                      <div className="idoc-head">
                        <span className="idoc-status mono">{d.intact ? '✓' : '✗'}</span>
                        <span className="idoc-title">{d.title}</span>
                        <span className="idoc-tier mono">{d.tierLabel.toUpperCase()}</span>
                        <button
                          className="btn ghost idoc-tamper"
                          disabled={tampering === d.docId}
                          title="Demo: simulate altering this blob off-chain, then re-verify"
                          onClick={() => tamperVault(d.docId)}
                        >
                          {tampering === d.docId ? '…' : d.intact ? 'simulate tamper' : 'restore'}
                        </button>
                      </div>
                      <div className="idoc-hashes mono">
                        <div className={d.intact ? '' : 'idoc-mismatch'}><span className="idoc-lbl">ledger</span> {d.ledgerHash}</div>
                        <div className={d.intact ? '' : 'idoc-mismatch'}><span className="idoc-lbl">vault&nbsp;</span> {d.recomputedHash}</div>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="integrity-events mono">
                  Backing the audit trail on Canton:&nbsp;
                  {integrity.events.grants} grants · {integrity.events.disclosures} disclosures ·
                  {' '}{integrity.events.commitments} commitments · {integrity.events.approvals} approvals — each an immutable contract.
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Buyer: your own access trail ── */}
        {current.role === 'buyer' && !noDeal && (
          <section className="panel">
            <div className="panel-head">
              <h2>Access trail</h2>
              <span className="count mono">{view?.accessTrail.length ?? 0} events</span>
            </div>
            <p className="panel-note">
              You see only your own accesses. You cannot see who else is in the room.
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
        )}

        {/* ── Diligence copilot ── */}
        {!isApprover && !noDeal && (
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
        )}

        {/* ── Investor: commit capital (USDCx / cBTC / cETH) into the round ── */}
        {current.role === 'buyer' && !view?.settled && (
          <section className="panel">
            <div className="panel-head">
              <h2>Your position</h2>
              <span className="count mono">multi-asset commitment</span>
            </div>
            {view?.kyc && (
              <p className="panel-note kyc-line">
                Compliance: <span className="kyc-badge ok">✓ {view.kyc.level} · {view.kyc.jurisdiction}</span>
              </p>
            )}

            {view?.myCommitment ? (
              <>
                <div className="commit-status">
                  <span className="commit-amt mono">{view.myCommitment.amount} {view.myCommitment.asset}</span>
                  <span className="commit-label">= {fmtUsd(view.myCommitment.usdValue)} · locked on-ledger since {view.myCommitment.committedAt}</span>
                </div>
                <p className="panel-note">
                  Your equity is allocated <strong>pro-rata to your USD value committed</strong> — it appears in the cap table the instant the round closes.
                </p>
              </>
            ) : (
              <>
                <div className="commit-row">
                  <select className="field asset-sel" value={commitAsset} onChange={(e) => setCommitAsset(e.target.value as Asset)}>
                    {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <input
                    className="field"
                    inputMode="decimal"
                    placeholder={`${commitAsset} to commit`}
                    value={commitAmt}
                    onChange={(e) => setCommitAmt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && Number(commitAmt) > 0) commit() }}
                  />
                  <button className="btn solid" disabled={committing || !(Number(commitAmt) > 0) || !!liveCommitBlock} onClick={commit}>
                    {committing ? 'Locking…' : 'Commit'}
                  </button>
                </div>
                {Number(commitAmt) > 0 && view?.rates && (
                  <p className="panel-note commit-usd mono">
                    = {fmtUsd(Number(commitAmt) * (view.rates[commitAsset] ?? 0))} @ oracle {fmtUsd(view.rates[commitAsset] ?? 0)}/{commitAsset}
                  </p>
                )}
                {WALLET && (wallet.status === 'connected' ? (
                  <p className={`panel-note commit-wallet ${liveCommitBlock ? 'commit-wallet-warn' : ''}`}>
                    <span className="wallet-dot" /> Paying from your Loop wallet <span className="mono">{walletShort}</span>
                    {walletBalance
                      ? <> · {commitAsset} on hand: <span className="mono">{walletAvail.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>{liveCommitBlock === 'insufficient' && <> — not enough for this commit</>}</>
                      : <> · no {commitAsset} in this wallet {LIVE ? '— pick an asset you hold' : 'yet'}</>}
                  </p>
                ) : (
                  <p className={`panel-note ${LIVE ? 'commit-wallet-warn' : 'commit-wallet-idle'}`}>
                    {LIVE
                      ? <><strong>Connect your Loop wallet</strong> (left) to invest — every commitment settles as a real on-chain token transfer you sign.</>
                      : <>Connect your <strong>Loop wallet</strong> (left) to pay this leg from your own Canton party.</>}
                  </p>
                ))}
                <p className="panel-note">
                  A <strong>{fmtUsd(view?.deal?.raiseTarget ?? 0)}</strong> round for the {(view?.deal?.quantity ?? 120000).toLocaleString()}-share
                  stake. Commit in <strong>USDCx, cBTC, or cETH</strong> — valued in USD via the oracle; your equity is allocated pro-rata to that value at close. Rivals can’t see your commitment.
                </p>
              </>
            )}
          </section>
        )}

        {/* ── Deal Readiness Score (founder only) ── */}
        {isSeller && readiness && (
          <section className="panel panel-readiness">
            <div className="panel-head">
              <h2>Deal Readiness</h2>
              <span className={`readiness-score-chip mono ${readiness.score >= 100 ? 'chip settled' : 'chip'}`}>
                {readiness.score}%
              </span>
            </div>
            <div className="readiness-gauge-wrap">
              <div
                className={`readiness-gauge ${readiness.score >= 75 ? 'high' : ''} ${readiness.score >= 100 ? 'full' : ''}`}
                style={{ width: `${readiness.score}%` }}
              />
            </div>
            <p className="readiness-narration">{readiness.narration}</p>
            <ul className="readiness-signals">
              {readiness.signals.map((s) => (
                <li key={s.key} className={`signal-item ${s.pts === s.max ? 'signal-full' : s.pts > 0 ? 'signal-partial' : 'signal-zero'}`}>
                  <span className="signal-dot mono">{s.pts === s.max ? '●' : s.pts > 0 ? '◑' : '○'}</span>
                  <span className="signal-label">{s.label}</span>
                  <span className="signal-detail mono">{s.detail}</span>
                  <span className="signal-pts mono">{s.pts}/{s.max}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Founder: conditions panel + close ── */}
        {current.role === 'seller' && !noDeal && (
          <section className="panel">
            <div className="panel-head">
              <h2>Close conditions</h2>
              <span className={`chip mono ${allGreen ? 'settled' : ''}`}>
                {allGreen ? '● All green — ready to close' : '○ Conditions pending'}
              </span>
            </div>

            {conds && (
              <>
                <div className="conditions-bar-wrap">
                  <div className="conditions-bar" style={{ width: `${conds.percentFunded}%` }} />
                  <span className="conditions-bar-label mono">{fmtUsd(conds.totalCommitted)} / {fmtUsd(conds.raiseTarget)} raised ({conds.percentFunded}%)</span>
                </div>
                {conds.committedByAsset && conds.committedByAsset.length > 0 && (
                  <div className="asset-mix mono">
                    {conds.committedByAsset.map((a) => (
                      <span key={a.asset} className={`asset-chip asset-${a.asset}`}>{a.amount} {a.asset} · {fmtUsd(a.usdValue)}</span>
                    ))}
                  </div>
                )}

                <ul className="conditions-list">
                  {conds.conditions.map((c) => (
                    <li key={c.key} className={`cond-item ${c.done ? 'cond-done' : 'cond-pending'}`}>
                      <span className="cond-check mono">{c.done ? '✓' : '○'}</span>
                      <span className="cond-label">{c.label}</span>
                      {c.detail && <span className="cond-detail mono">{c.detail}</span>}
                      {c.approvedAt && <span className="cond-detail mono">{c.approvedAt}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* The round book: each committed investor + their pro-rata equity allocation */}
            {view?.investorsDetail && view.investorsDetail.length > 0 ? (() => {
              const totalUsd = view.investorsDetail.reduce((s, i) => s + (i.committedUsd ?? 0), 0) || 1
              const stakeShares = view.deal?.quantity ?? 120000
              const companyShares = (view.capTable ?? []).reduce((s, r) => s + r.shares, 0) || 1000000
              const stakePct = (stakeShares / companyShares) * 100
              return (
              <div className="inv-table-wrap">
                <div className="eyebrow" style={{ marginBottom: 8 }}>The round book — pro-rata by USD value</div>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Investor</th>
                      <th>Tier</th>
                      <th>Committed</th>
                      <th>USD value</th>
                      <th>Allocation ({stakePct.toFixed(0)}% round)</th>
                      <th>KYC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.investorsDetail.map((inv) => {
                      const shares = inv.committedUsd ? Math.round((inv.committedUsd / totalUsd) * stakeShares) : 0
                      const pct = inv.committedUsd ? (inv.committedUsd / totalUsd) * stakePct : 0
                      return (
                      <tr key={inv.name}>
                        <td className="inv-name">{inv.name}</td>
                        <td className="mono">T{inv.tier}</td>
                        <td className={`mono inv-cbtc${inv.committed === null ? ' none' : ''}`}>
                          {inv.committed !== null ? `${inv.committed} ${inv.asset}` : '—'}
                        </td>
                        <td className="mono">{inv.committedUsd !== null ? fmtUsd(inv.committedUsd) : <span className="muted-note">—</span>}</td>
                        <td className="mono">{shares ? `${shares.toLocaleString()} sh · ${pct.toFixed(2)}%` : <span className="muted-note">—</span>}</td>
                        <td>{inv.kyc ? <span className="kyc-badge ok">✓ KYB</span> : <span className="kyc-badge pending">Pending</span>}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              )
            })() : (
              <p className="panel-note round-empty">
                No investors in the round yet — invite one from the left rail. Each will appear here
                with their pro-rata allocation as they commit capital.
              </p>
            )}

            <div className={`close ${view?.settled ? 'is-settled' : ''} ${settling ? 'is-settling' : ''} ${rollback ? 'is-rollback' : ''}`}>
              <div className="legs">
                {view?.holdings.map((h, i) => (
                  <div key={i} className={`leg ${view?.settled ? 'leg-swapped' : ''}`}>
                    <div className="leg-amt mono">{h.instrument === 'USD' ? fmtUsd(h.amount) : h.amount.toLocaleString()}</div>
                    <div className="leg-inst mono">{h.instrument === 'USD' ? 'capital (USDCx·cBTC·cETH)' : h.instrument}</div>
                    <div className="leg-owner"><span className="leg-arrow">{view?.settled ? '→ ' : ''}</span>{h.ownerLabel}</div>
                  </div>
                ))}
                {settling && <div className="swap-pulse" aria-hidden />}
              </div>

              {!view?.settled && (
                <>
                  <button
                    className="btn solid wide"
                    disabled={settling || !allGreen}
                    title={allGreen ? '' : 'All 4 conditions must be green before closing'}
                    onClick={settle}
                  >
                    {settling ? 'Settling capital ↔ equity in one transaction…' : 'Close — capital ↔ equity, atomically'}
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
                  <strong>One transaction.</strong> Capital and equity swapped together — or not at all.
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Regulator attestation ── */}
        {current.role === 'regulator' && (
          <section className="panel">
            <div className="panel-head">
              <h2>Settlement attestation</h2>
              <span className={`chip mono ${view?.settled ? 'settled' : ''}`}>
                {view?.settled ? '● Settled atomically' : '○ Not settled'}
              </span>
            </div>
            <div className="attest">
              <button className="btn wide" onClick={verifyClose}>
                Verify the founder received exactly the committed capital
              </button>
              {attestation && (
                <div className={`attest-card ${attestation.matched ? 'ok' : 'pending'}`}>
                  {attestation.settled ? (
                    <>
                      <div className="attest-line">
                        <span className="mono">{attestation.matched ? '✓ VERIFIED' : '✗ MISMATCH'}</span>
                        settled raise {fmtUsd(attestation.settledCash)} {attestation.matched ? '=' : '≠'} investor commitments {fmtUsd(attestation.expectedCash)}
                      </div>
                      <div className="attest-sub">
                        Attested from the on-ledger commitments and the settlement legs — <strong>without any tier-2 document access</strong>.
                      </div>
                    </>
                  ) : (
                    <div className="attest-line">Not settled yet — nothing to attest.</div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {view?.capTable && view.capTable.length > 0 && !isApprover && (
          <section className="panel">
            <div className="panel-head">
              <h2>Cap table</h2>
              <span className="count mono">{current.role === 'seller' || current.role === 'regulator' ? 'Halden Robotics · share registry' : 'your position'}</span>
            </div>
            <ul className="captable">
              {view.capTable.map((r, i) => (
                <li key={i} className={view.settled && r.holderLabel !== 'Founders' && r.holderLabel !== 'ESOP' && r.holderLabel !== 'Halden' ? 'is-new' : ''}>
                  <span className="ct-holder">{r.holderLabel}</span>
                  <span className="ct-bar"><span className="ct-fill" style={{ width: `${r.pct}%` }} /></span>
                  <span className="ct-pct mono">{r.pct}%</span>
                  <span className="ct-shares mono">{r.shares.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="panel-note">
              {view.settled
                ? 'Settled — the 12% round was allocated pro-rata to each committed investor; the registry now reflects every new holder.'
                : current.role === 'seller'
                  ? 'At close, the round is allocated pro-rata to each committed investor — proportional to their USD value committed (any mix of USDCx / cBTC / cETH).'
                  : 'Your tokenized ownership appears here once the round closes, pro-rata to your commitment.'}
            </p>
          </section>
        )}

        {/* ── Post-close lifecycle: capital distribution ── */}
        {view?.settled && !isApprover && !noDeal && (
          <>
            {/* Founder: declare a pro-rata distribution, or review the one declared */}
            {isSeller && (
              <section className="panel panel-dist">
                <div className="panel-head">
                  <h2>Capital distribution</h2>
                  <span className={`chip mono ${view.distribution ? 'settled' : ''}`}>
                    {view.distribution ? `● ${fmtUsd(view.distribution.total)} declared` : '○ none declared'}
                  </span>
                </div>
                <p className="panel-note">
                  Atrium runs the ongoing cap table, not just the close. Declare a pro-rata
                  distribution (paid in <strong>USDCx</strong>) and every shareholder is paid in <strong>one atomic transaction</strong> — each
                  receiving a <strong>private receipt only they can see</strong>. Rival holders never learn each other's payouts.
                </p>

                {!view.distribution ? (() => {
                  const amt = Number(distAmount) || 0
                  const rows = view.capTable ?? []
                  const totalShares = rows.reduce((s, r) => s + r.shares, 0) || 1
                  const perShare = amt / totalShares
                  return (
                    <>
                      <div className="bid-row">
                        <input className="field" inputMode="decimal" placeholder="Total USD to distribute (in USDCx)" value={distAmount} onChange={(e) => setDistAmount(e.target.value)} />
                        <button className="btn solid" disabled={declaring || !(amt > 0)} onClick={declareDistribution}>
                          {declaring ? 'Paying every holder atomically…' : 'Declare distribution'}
                        </button>
                      </div>
                      <table className="inv-table dist-preview">
                        <thead><tr><th>Holder</th><th>Shares</th><th>Pro-rata payout</th></tr></thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.holderLabel}>
                              <td className="inv-name">{r.holderLabel}</td>
                              <td className="mono">{r.shares.toLocaleString()}</td>
                              <td className="mono">{fmtUsd(r.shares * perShare)} USDCx</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="panel-note dist-rate mono">@ {fmtUsd(perShare)} / share · {rows.length} holders · one atomic fan-out</p>
                    </>
                  )
                })() : <DistributionTable d={view.distribution} />}
              </section>
            )}

            {/* Regulator: read-only oversight of the distribution */}
            {current.role === 'regulator' && view.distribution && (
              <section className="panel panel-dist">
                <div className="panel-head">
                  <h2>Capital distribution</h2>
                  <span className="chip mono settled">● {fmtUsd(view.distribution.total)}</span>
                </div>
                <DistributionTable d={view.distribution} />
              </section>
            )}

            {/* Holder: their own private receipt (rivals' payouts invisible) */}
            {current.role === 'buyer' && view.myDistribution && (
              <section className="panel panel-dist">
                <div className="panel-head">
                  <h2>Your distribution</h2>
                  <span className="chip mono settled">● paid</span>
                </div>
                <div className="dist-receipt">
                  <span className="dist-amt mono">{fmtUsd(view.myDistribution.amount)} USDCx</span>
                  <span className="dist-receipt-sub">
                    on {view.myDistribution.shares.toLocaleString()} shares · @ {fmtUsd(view.myDistribution.perShare)}/share · {view.myDistribution.declaredAt}
                  </span>
                </div>
                <p className="panel-note">
                  This receipt is yours alone — you cannot see what other shareholders received, and they cannot see yours.
                </p>
              </section>
            )}
          </>
        )}

        <footer className="verified">
          <span className={`mode-pill ${LIVE ? 'live' : ''}`}>{LIVE ? '● LIVE on Canton' : '○ in-browser mock'}</span>
          <span className="verified-note">
            Privacy, atomicity, conditional close &amp; distribution are proven by <code>daml test</code> —
            <code>testPrivacyProjection</code>, <code>testAtomicDvP</code>, <code>testAtomicityHolds</code>, <code>testConditionalClose</code>, <code>testDistribution</code>.
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
              {doc.dataUrl && doc.mime?.startsWith('image/') ? (
                <img className="doc-image" src={doc.dataUrl} alt={doc.title} />
              ) : doc.dataUrl && doc.mime === 'application/pdf' ? (
                <iframe className="doc-frame" src={doc.dataUrl} title={doc.title} />
              ) : doc.content ? (
                <pre className="doc-content">{doc.content}</pre>
              ) : (
                <div className="doc-nopreview">
                  <span className="doc-nopreview-icon">📄</span>
                  Decrypted — this file type can’t be previewed inline. Download it below.
                </div>
              )}
              {doc.dataUrl && (
                <a className="btn ghost doc-download" href={doc.dataUrl} download={doc.title + extFor(doc.mime)}>⬇ Download decrypted file</a>
              )}
              <div className="doc-modal-foot mono">
                🔓 AES-256-GCM · {doc.bytes.toLocaleString()} bytes ciphertext · {doc.hash.slice(0, 23)}… — the key service
                released this because the ledger confirms your grant covers tier {doc.tier}.
              </div>
            </div>
          </div>
        )}

        {/* ── e-signature ceremony (Board / Legal / Compliance) ── */}
        {signing && isApprover && (
          <div className="doc-modal-backdrop" onClick={() => { if (!approving) setSigning(false) }}>
            <div className="doc-modal sign-modal" onClick={(e) => e.stopPropagation()}>
              <div className="doc-modal-head">
                <div>
                  <div className="eyebrow">e-signature · modeled (DocuSign in production)</div>
                  <h3>{approverRole} resolution</h3>
                </div>
                <button className="btn ghost" disabled={approving} onClick={() => setSigning(false)}>Cancel</button>
              </div>
              <pre className="doc-content">{resolutionText(approverRole, signerName.trim() || '—')}</pre>
              <div className="sign-row">
                <input
                  className="field"
                  placeholder="Type your full name to sign"
                  value={signerName}
                  autoFocus
                  onChange={(e) => setSignerName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && signerName.trim()) signAndApprove() }}
                />
                <button className="btn solid" disabled={approving || !signerName.trim()} onClick={signAndApprove}>
                  {approving ? 'Signing & recording…' : '✍ Sign & record on Canton'}
                </button>
              </div>
              <div className="doc-modal-foot mono">
                Signing generates a PDF resolution, encrypts it in the data room, anchors its hash on Canton,
                and creates the on-ledger Approval the conditional close verifies.
              </div>
            </div>
          </div>
        )}

        {/* ── Confirm: start a new deal (in-app, replaces the native alert) ── */}
        {confirmNew && (
          <div className="doc-modal-backdrop" onClick={() => setConfirmNew(false)}>
            <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Start a new deal?</h3>
              <p>This clears the current round so you can set one up from scratch — tiers, raise target, stake, and investors.</p>
              <div className="confirm-actions">
                <button className="btn ghost" onClick={() => setConfirmNew(false)}>Cancel</button>
                <button className="btn solid" onClick={startNewDeal}>⟲ Start a new deal</button>
              </div>
            </div>
          </div>
        )}

        {msg && <div className="toast" onClick={() => setMsg(null)}>{msg}</div>}
      </main>
    </div>
  )
}

function DistributionTable({ d }: { d: DistributionSummary }) {
  return (
    <>
      <div className="dist-summary mono">
        <span><strong>{fmtUsd(d.total)}</strong> paid in USDCx · {d.recipients.length} holders · @ {fmtUsd(d.perShare)} / share · {d.declaredAt}</span>
      </div>
      <table className="inv-table dist-preview">
        <thead><tr><th>Holder</th><th>Shares</th><th>Received</th></tr></thead>
        <tbody>
          {d.recipients.map((r) => (
            <tr key={r.holderLabel}>
              <td className="inv-name">{r.holderLabel}</td>
              <td className="mono">{r.shares.toLocaleString()}</td>
              <td className="mono">{fmtUsd(r.amount)} USDCx</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="panel-note">Every row was created in the same transaction — all holders paid, or none. Each holder's receipt is private to them.</p>
    </>
  )
}

function auditKindLabel(kind: LifecycleKind) {
  switch (kind) {
    case 'grant':      return 'GRANT'
    case 'disclosure': return 'DISCLOSE'
    case 'commitment': return 'COMMIT'
    case 'approval':   return 'APPROVE'
    case 'settlement': return 'SETTLE'
    case 'distribution': return 'DISTRIBUTE'
  }
}

function viewerBlurb(role: string) {
  if (role === 'seller')     return 'You see every investor, every document, the full trail, and the conditional close gate.'
  if (role === 'regulator')  return 'You can verify the close matched the recorded bids — without seeing tier-2 contents.'
  if (role === 'board')      return 'You must approve before the founder can close. Your signature is recorded on Canton.'
  if (role === 'legal')      return 'You must approve before the founder can close. Your signature is recorded on Canton.'
  if (role === 'compliance') return 'KYC/AML clearance. Your on-ledger approval is required for the conditional close.'
  return 'You see only your tier and your own activity. Rival investors are invisible to you.'
}
