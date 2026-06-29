import { useEffect, useRef, useState } from 'react'
import { mockClient } from './ledger/mockClient'
import { httpClient } from './ledger/httpClient'
import { AtriumMark } from './AtriumMark'
import { Landing } from './Landing'
import type { AskResult, CloseAttestation, DealView, DistributionSummary, DocContent, IntegrityReport, LifecycleKind, ReadinessResult, Viewer } from './types'

const DEMO_TIERS = ['Teaser', 'Financials', 'Legal']

const LIVE = import.meta.env.VITE_LIVE === '1'
const client = LIVE ? httpClient : mockClient

// Format a per-share cBTC rate readably even when it's a small fraction.
function fmtRate(n: number) {
  return n >= 1 ? n.toFixed(2) : n.toPrecision(2)
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
  const [bid, setBid] = useState('')
  const [commitAmt, setCommitAmt] = useState('')
  const [committing, setCommitting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [tampering, setTampering] = useState<string | null>(null)
  const [distAmount, setDistAmount] = useState('10')
  const [declaring, setDeclaring] = useState(false)
  // Founder "set up the room" flow
  const [setupTitle, setSetupTitle] = useState('Halden Robotics — 25 cBTC Series A')
  const [setupInstrument, setSetupInstrument] = useState('HALDEN-EQUITY')
  const [setupTarget, setSetupTarget] = useState('25')
  const [setupTiers, setSetupTiers] = useState<string[]>([...DEMO_TIERS])
  const [creatingDeal, setCreatingDeal] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)

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
  }
  useEffect(() => { load() }, [viewer])

  const current = viewers.find((v) => v.party === viewer)
  const isApprover = current?.role === 'board' || current?.role === 'legal' || current?.role === 'compliance'
  const approverRole = current?.role === 'board' ? 'BOARD' : current?.role === 'legal' ? 'LEGAL' : 'COMPLIANCE'
  const isSeller = current?.role === 'seller'
  useEffect(() => {
    if (!isSeller) { setReadiness(null); return }
    client.getReadiness().then(setReadiness).catch(() => {})
  }, [view, isSeller])

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

  async function makeOffer() {
    try {
      await client.submitOffer(viewer, Number(bid))
      setBid('')
      await load(true)
    } catch (e) { setMsg((e as Error).message) }
  }

  async function commitCBTC() {
    const amt = Number(commitAmt)
    if (!(amt > 0)) return
    setCommitting(true)
    setMsg(null)
    try {
      await client.commitCBTC(viewer, amt)
      setCommitAmt('')
      await load(true)
      setMsg(`Committed ${amt} cBTC on-ledger — the founder can see your commitment toward the raise target.`)
    } catch (e) { setMsg((e as Error).message) } finally { setCommitting(false) }
  }

  async function approve() {
    setApproving(true)
    setMsg(null)
    try {
      await client.approve(viewer, approverRole)
      await load(true)
      setMsg(`${approverRole} approval recorded on-ledger — the founder's close gate now reflects this.`)
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
    if (!(amt > 0)) { setMsg('Set a total cBTC amount to distribute.'); return }
    setDeclaring(true); setMsg(null)
    try {
      await client.distribute(viewer, amt)
      await load(true)
      setMsg(`Declared a ${amt.toLocaleString()} cBTC distribution — every shareholder was paid pro-rata in one atomic transaction; each sees only their own receipt.`)
    } catch (e) { setMsg((e as Error).message) } finally { setDeclaring(false) }
  }

  async function createDeal() {
    const target = Number(setupTarget)
    const tiers = setupTiers.map((t) => t.trim()).filter(Boolean)
    if (!(target > 0) || tiers.length === 0) { setMsg('Set a raise target and at least one named tier.'); return }
    setCreatingDeal(true); setMsg(null)
    try {
      await client.createDeal(viewer, { title: setupTitle, instrument: setupInstrument, raiseTarget: target, tiers })
      await load(true)
      setMsg(`Deal room created — named tiers ${tiers.join(' · ')}. Now add documents per tier and invite investors.`)
    } catch (e) { setMsg((e as Error).message) } finally { setCreatingDeal(false) }
  }

  async function loadDemo() {
    setLoadingDemo(true); setMsg(null)
    try {
      await client.loadDemo()
      await refreshViewers()
      await load(true)
      setMsg('Fundraise demo loaded — investors, documents, bids, commitments and governance roles are live.')
    } catch (e) { setMsg((e as Error).message) } finally { setLoadingDemo(false) }
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

  async function accept(offerId: string) {
    await client.acceptOffer(viewer, offerId)
    await load()
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

        {view?.deal && (
          <div className="deal-card">
            <div className="eyebrow">Active fundraise</div>
            <h1 className="deal-title">{view.deal.title}</h1>
            <dl className="deal-meta">
              <div><dt>Instrument</dt><dd className="mono">{view.deal.instrument}</dd></div>
              <div><dt>Equity on offer</dt><dd className="mono">{view.deal.quantity.toLocaleString()} units</dd></div>
              {view.deal.raiseTarget ? <div><dt>Raise target</dt><dd className="mono">{view.deal.raiseTarget} cBTC</dd></div> : null}
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
          </div>
        )}
      </aside>

      <main className="stage">
        <header className="seeing">
          You are <strong>{current.label}</strong>. {viewerBlurb(current.role)}
        </header>

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
                <span className="setup-lbl">Raise target (cBTC)</span>
                <input className="field" inputMode="decimal" value={setupTarget} onChange={(e) => setSetupTarget(e.target.value)} placeholder="25" />
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
              The demo seeds three investors, multi-tier documents, sealed bids, cBTC commitments
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
              <p className="panel-note">
                Your <strong>{view.myApproval.role}</strong> approval was recorded on-ledger at {view.myApproval.approvedAt}.
                The founder's close gate will include this when all conditions are met.
              </p>
            ) : (
              <>
                <p className="panel-note">
                  Review the fundraise. If satisfied, record your on-ledger approval — the founder cannot
                  close the deal until all required roles have signed.
                </p>
                <button className="btn solid wide" disabled={approving} onClick={approve}>
                  {approving ? 'Recording approval on-ledger…' : `Record ${approverRole} approval`}
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
              cBTC commitments · governance approvals · settlement. Tamper-proof and ledger-timestamped —
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
                <div className={`integrity-verdict ${integrity.allIntact ? 'ok' : 'breach'}`}>
                  {integrity.allIntact ? (
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

        {/* ── Investor: commit cBTC + sealed bid ── */}
        {current.role === 'buyer' && !view?.settled && (
          <section className="panel">
            <div className="panel-head">
              <h2>Your position</h2>
              <span className="count mono">cBTC commitment + sealed bid</span>
            </div>
            {view?.kyc && (
              <p className="panel-note kyc-line">
                Compliance: <span className="kyc-badge ok">✓ {view.kyc.level} · {view.kyc.jurisdiction}</span>
              </p>
            )}

            {view?.myCommitment ? (
              <div className="commit-status">
                <span className="commit-amt mono">{view.myCommitment.amount} cBTC</span>
                <span className="commit-label">locked on-ledger since {view.myCommitment.committedAt}</span>
              </div>
            ) : (
              <div className="bid-row">
                <input
                  className="field"
                  inputMode="decimal"
                  placeholder="cBTC to commit (e.g. 25)"
                  value={commitAmt}
                  onChange={(e) => setCommitAmt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && Number(commitAmt) > 0) commitCBTC() }}
                />
                <button className="btn solid" disabled={committing || !(Number(commitAmt) > 0)} onClick={commitCBTC}>
                  {committing ? 'Locking cBTC…' : 'Commit cBTC'}
                </button>
              </div>
            )}

            {/* Sealed bid */}
            {view?.offers.length === 0 && !view?.myCommitment ? null : (
              <>
                {view?.offers.length === 0 ? (
                  <div className="bid-row" style={{ marginTop: 12 }}>
                    <input
                      className="field"
                      inputMode="decimal"
                      placeholder="Bid price / equity unit"
                      value={bid}
                      onChange={(e) => setBid(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && Number(bid) > 0) makeOffer() }}
                    />
                    <button className="btn" disabled={!(Number(bid) > 0)} onClick={makeOffer}>
                      Submit sealed bid
                    </button>
                  </div>
                ) : (
                  <ul className="offers" style={{ marginTop: 12 }}>
                    {view?.offers.map((o) => (
                      <li key={o.offerId} className="offer status-open">
                        <div>
                          <div className="o-buyer">Your sealed bid</div>
                          <div className="o-terms mono">{o.quantity.toLocaleString()} units · submitted {o.submittedAt}</div>
                        </div>
                        <span className="o-flag mono">SEALED</span>
                      </li>
                    ))}
                  </ul>
                )}
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
                  <span className="conditions-bar-label mono">{conds.totalCommitted} / {conds.raiseTarget} cBTC raised ({conds.percentFunded}%)</span>
                </div>

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

            {/* Competing investors table (merged: grants + commitments + bids) */}
            {view?.investorsDetail && view.investorsDetail.length > 0 ? (
              <div className="inv-table-wrap">
                <div className="eyebrow" style={{ marginBottom: 8 }}>Competing investors</div>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Investor</th>
                      <th>Tier</th>
                      <th>cBTC committed</th>
                      <th>Sealed bid</th>
                      <th>KYC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.investorsDetail.map((inv) => (
                      <tr key={inv.name}>
                        <td className="inv-name">{inv.name}</td>
                        <td className="mono">T{inv.tier}</td>
                        <td className={`mono inv-cbtc${inv.committed === null ? ' none' : ''}`}>
                          {inv.committed !== null ? `${inv.committed} cBTC` : '—'}
                        </td>
                        <td>{inv.hasBid ? <span className="o-flag mono">SEALED</span> : <span className="muted-note">—</span>}</td>
                        <td>{inv.kyc ? <span className="kyc-badge ok">✓ KYB</span> : <span className="kyc-badge pending">Pending</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (view?.offers && view.offers.length > 0 && (
              <ul className="offers" style={{ marginTop: 16 }}>
                {view.offers.map((o) => (
                  <li key={o.offerId} className="offer status-open">
                    <div>
                      <div className="o-buyer">
                        {o.buyerLabel}
                        {o.kyc
                          ? <span className="kyc-badge ok" title={`${o.kyc.level} · ${o.kyc.jurisdiction}`}>✓ KYC</span>
                          : <span className="kyc-badge pending">KYC pending</span>}
                      </div>
                      <div className="o-terms mono">{o.quantity.toLocaleString()} units · {o.submittedAt}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ))}

            <div className={`close ${view?.settled ? 'is-settled' : ''} ${settling ? 'is-settling' : ''} ${rollback ? 'is-rollback' : ''}`}>
              <div className="legs">
                {view?.holdings.map((h, i) => (
                  <div key={i} className={`leg ${view?.settled ? 'leg-swapped' : ''}`}>
                    <div className="leg-amt mono">{h.instrument === 'cBTC' ? `${h.amount.toLocaleString()} cBTC` : h.amount.toLocaleString()}</div>
                    <div className="leg-inst mono">{h.instrument}</div>
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
                    {settling ? 'Settling cBTC ↔ equity in one transaction…' : 'Close — cBTC ↔ equity, atomically'}
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
                  <strong>One transaction.</strong> cBTC and equity swapped together — or not at all.
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
                Verify the founder received exactly the committed cBTC
              </button>
              {attestation && (
                <div className={`attest-card ${attestation.matched ? 'ok' : 'pending'}`}>
                  {attestation.settled ? (
                    <>
                      <div className="attest-line">
                        <span className="mono">{attestation.matched ? '✓ VERIFIED' : '✗ MISMATCH'}</span>
                        settled raise {attestation.settledCash} cBTC {attestation.matched ? '=' : '≠'} investor commitments {attestation.expectedCash} cBTC
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
                  ? 'The 12% stake on offer transfers to the winning investor the instant the deal closes.'
                  : 'Your tokenized ownership appears here once the founder closes the deal.'}
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
                    {view.distribution ? `● ${view.distribution.total.toLocaleString()} cBTC declared` : '○ none declared'}
                  </span>
                </div>
                <p className="panel-note">
                  Atrium runs the ongoing cap table, not just the close. Declare a pro-rata cBTC
                  distribution and every shareholder is paid in <strong>one atomic transaction</strong> — each
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
                        <input className="field" inputMode="decimal" placeholder="Total cBTC to distribute" value={distAmount} onChange={(e) => setDistAmount(e.target.value)} />
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
                              <td className="mono">{Math.round(r.shares * perShare).toLocaleString()} cBTC</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="panel-note dist-rate mono">@ {fmtRate(perShare)} cBTC / share · {rows.length} holders · one atomic fan-out</p>
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
                  <span className="chip mono settled">● {view.distribution.total.toLocaleString()} cBTC</span>
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
                  <span className="dist-amt mono">{view.myDistribution.amount.toLocaleString()} cBTC</span>
                  <span className="dist-receipt-sub">
                    on {view.myDistribution.shares.toLocaleString()} shares · @ {fmtRate(view.myDistribution.perShare)} cBTC/share · {view.myDistribution.declaredAt}
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
                <a className="btn ghost doc-download" href={doc.dataUrl} download={doc.title}>⬇ Download decrypted file</a>
              )}
              <div className="doc-modal-foot mono">
                🔓 AES-256-GCM · {doc.bytes.toLocaleString()} bytes ciphertext · {doc.hash.slice(0, 23)}… — the key service
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

function DistributionTable({ d }: { d: DistributionSummary }) {
  return (
    <>
      <div className="dist-summary mono">
        <span><strong>{d.total.toLocaleString()} cBTC</strong> paid · {d.recipients.length} holders · @ {fmtRate(d.perShare)} / share · {d.declaredAt}</span>
      </div>
      <table className="inv-table dist-preview">
        <thead><tr><th>Holder</th><th>Shares</th><th>Received</th></tr></thead>
        <tbody>
          {d.recipients.map((r) => (
            <tr key={r.holderLabel}>
              <td className="inv-name">{r.holderLabel}</td>
              <td className="mono">{r.shares.toLocaleString()}</td>
              <td className="mono">{r.amount.toLocaleString()} cBTC</td>
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
