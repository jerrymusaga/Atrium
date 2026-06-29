import type { LedgerClient, PartyId } from './LedgerClient'
import type { AccessEvent, AskResult, CapTableRow, CloseAttestation, ConditionItem, Deal, DealSetup, DealView, DistributionSummary, DocContent, Document, Holding, IntegrityReport, InvestorSummary, MyDistribution, Offer, ReadinessResult, Viewer } from '../types'

// ---------------------------------------------------------------------------
// In-browser mock of the Atrium ledger — the full Capital Markets OS fundraise,
// at PARITY with the live Canton backend so a static deploy is a faithful,
// no-auth, fully clickable walkthrough: cBTC commitments, governance approvals,
// the 4-condition conditional close, dynamic Deal Readiness, provable integrity
// and the post-close distribution. It mimics Canton's selective disclosure by
// FILTERING each view to what a party is entitled to see.
// ---------------------------------------------------------------------------

const SELLER = 'Halden'
const BUYER_A = 'Boranic'
const BUYER_B = 'Meridian'
const BUYER_C = 'Prometheus'

let VIEWERS: Viewer[] = [
  { party: SELLER, label: 'Halden (Founder)', role: 'seller' },
  { party: BUYER_A, label: 'Boranic (Investor · tier 1)', role: 'buyer' },
  { party: BUYER_B, label: 'Meridian (Investor · tier 1+2)', role: 'buyer' },
  { party: BUYER_C, label: 'Prometheus (Investor · tier 1)', role: 'buyer' },
  { party: 'Board', label: 'Board (Approver)', role: 'board' },
  { party: 'Legal', label: 'Legal (Approver)', role: 'legal' },
  { party: 'Compliance', label: 'Compliance (Approver)', role: 'compliance' },
  { party: 'Regulator', label: 'Regulator (observer)', role: 'regulator' },
]

const tierLabel = (t: number) => (t >= 2 ? 'tier 1+2' : 'tier 1')
const roleOf = (viewer: PartyId) => VIEWERS.find((v) => v.party === viewer)?.role

let deal: Deal = {
  dealId: 'HALDEN-2026-A',
  title: 'Halden Robotics — 25 cBTC Series A',
  seller: SELLER,
  instrument: 'HALDEN-EQUITY',
  quantity: 120000,
  raiseTarget: 25,
  tiers: ['Teaser', 'Financials', 'Legal'],
}
const tierName = (t: number) => deal.tiers?.[t - 1] ?? `Tier ${t}`

type RawDoc = { docId: string; title: string; tier: number; contentHash: string; content: string; mime?: string; dataUrl?: string }
const docs: RawDoc[] = [
  {
    docId: 'teaser', title: 'Investment teaser', tier: 1, contentHash: 'sha256:b52e8f7e1d344718',
    content: `HALDEN ROBOTICS — INVESTMENT TEASER (Tier 1)\n\nProject Halden — 25 cBTC Series A in Halden Robotics, a warehouse-automation company.\nFounded 2019 · Oslo & Austin · 140 FTE. Category: autonomous mobile robots for 3PL.\n\n• 3-year revenue CAGR ~70%; gross margin expanding with the Gen-3 fleet.\n• Blue-chip logistics customers; multi-year contracted backlog.\n• Stake on offer: 120,000 shares (~12% fully diluted).\n\nAudited financials and the cap table are in Tier 2, for verified deep-diligence investors.`,
  },
  {
    docId: 'financials', title: 'Audited financials', tier: 2, contentHash: 'sha256:6add8e4565209a06',
    content: `HALDEN ROBOTICS — AUDITED FINANCIALS (Tier 2 · CONFIDENTIAL)\n\nFY2025 (audited)\n  Revenue                 41,800,000\n  YoY growth                    +68%\n  Gross profit            24,300,000   (58.1% margin)\n  Adj. EBITDA              6,900,000   (16.5% margin)\n  Net cash                12,400,000\n  Contracted backlog      57,000,000\n\nSeries A terms\n  Raise target              25 cBTC\n  Stake on offer        120,000 shares (~12%)\n\nIf you can read this, the key service released your AES-256-GCM key —\nwhich it only does because the ledger confirms your grant covers Tier 2.`,
  },
]

// buyer -> max tier they may access
const grants: Record<PartyId, number> = { [BUYER_A]: 1, [BUYER_B]: 2, [BUYER_C]: 1 }

// buyer -> KYC/KYB attestation (issued by an independent provider). The compliance gate.
const kyc: Record<PartyId, { level: string; jurisdiction: string }> = {
  [BUYER_A]: { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' },
  [BUYER_B]: { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' },
  [BUYER_C]: { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' },
}

// investor -> locked cBTC commitment toward the raise. Seeded at 20/25 (80%); Prometheus
// commits the final 5 during the demo to tip the raise over its target.
let commitments: Record<PartyId, { amount: number; committedAt: string }> = {
  [BUYER_A]: { amount: 8, committedAt: '10:15' },
  [BUYER_B]: { amount: 12, committedAt: '10:40' },
}

// governance role -> approval. Seeded empty so judges click Board / Legal / Compliance through.
let approvals: Record<string, { role: string; approvedAt: string }> = {}

let accessTrail: AccessEvent[] = [
  { buyer: BUYER_A, buyerLabel: 'Boranic', docId: 'teaser', docTitle: 'Investment teaser', accessedAt: '09:14' },
  { buyer: BUYER_B, buyerLabel: 'Meridian', docId: 'teaser', docTitle: 'Investment teaser', accessedAt: '09:31' },
  { buyer: BUYER_B, buyerLabel: 'Meridian', docId: 'financials', docTitle: 'Audited financials', accessedAt: '10:02' },
]

let offers: Offer[] = [
  { offerId: 'o1', buyer: BUYER_B, buyerLabel: 'Meridian', pricePerUnit: 35, quantity: 120000, submittedAt: '11:20', status: 'open' },
  { offerId: 'o2', buyer: BUYER_A, buyerLabel: 'Boranic', pricePerUnit: 31, quantity: 120000, submittedAt: '11:48', status: 'open' },
  { offerId: 'o3', buyer: BUYER_C, buyerLabel: 'Prometheus', pricePerUnit: 33, quantity: 120000, submittedAt: '12:05', status: 'open' },
]

let settled = false
let acceptedOffer: Offer | null = null
// simulated off-chain tampering set (mock only) — docIds whose blob has been "corrupted"
const tampered = new Set<string>()
// post-close capital distribution (mock) — null until the founder declares one
let distribution: DistributionSummary | null = null

const EQUITY = 120000   // the on-offer stake, in shares

const labelOf = (party: PartyId) => (party === SELLER ? 'Halden' : party)
const investorParties = () => Object.keys(grants)

// The conditional-close gate, computed live from commitments + approvals (mirrors Deal.Close).
function committedTotal() {
  return Object.values(commitments).reduce((s, c) => s + c.amount, 0)
}
function conditionList(): ConditionItem[] {
  const target = deal.raiseTarget ?? 0
  const tc = committedTotal()
  return [
    { key: 'FUNDED',     label: `Raise target (${target} cBTC)`, done: tc >= target, detail: `${tc} / ${target} cBTC` },
    { key: 'BOARD',      label: 'Board approval',     done: !!approvals['BOARD'],      approvedAt: approvals['BOARD']?.approvedAt },
    { key: 'LEGAL',      label: 'Legal approval',     done: !!approvals['LEGAL'],      approvedAt: approvals['LEGAL']?.approvedAt },
    { key: 'COMPLIANCE', label: 'Compliance / KYC',   done: !!approvals['COMPLIANCE'], approvedAt: approvals['COMPLIANCE']?.approvedAt },
  ]
}
const isAllGreen = () => conditionList().every((c) => c.done)

// The winning investor (accepted bid, else the highest sealed bid) — receives the stake at close.
function winningBuyer(): PartyId {
  if (acceptedOffer) return acceptedOffer.buyer
  return [...offers].sort((a, b) => b.pricePerUnit - a.pricePerUnit)[0]?.buyer ?? BUYER_B
}

function holdings(): Holding[] {
  const wb = winningBuyer()
  const raised = committedTotal()
  if (!settled) {
    return [
      { owner: wb, ownerLabel: labelOf(wb), instrument: 'cBTC', amount: raised },
      { owner: SELLER, ownerLabel: 'Halden', instrument: 'HALDEN-EQUITY', amount: EQUITY },
    ]
  }
  // post-close: founder holds the raised cBTC treasury; the winning investor holds the equity
  return [
    { owner: SELLER, ownerLabel: 'Halden', instrument: 'cBTC', amount: raised },
    { owner: wb, ownerLabel: labelOf(wb), instrument: 'HALDEN-EQUITY', amount: EQUITY },
  ]
}

// Halden Robotics cap table: 1,000,000 shares. The 120,000-share (12%) stake on offer is held
// by the founder until the close, then by the winning investor. Founder/regulator see all.
function capTableFor(viewer: PartyId, privileged: boolean): CapTableRow[] {
  const stakeHolder = settled ? labelOf(winningBuyer()) : 'Halden'
  const rows: CapTableRow[] = [
    { holderLabel: 'Founders', shares: 600000, pct: 60 },
    { holderLabel: 'ESOP', shares: 280000, pct: 28 },
    { holderLabel: stakeHolder, shares: 120000, pct: 12 },
  ]
  if (privileged) return rows
  return rows.filter((r) => r.holderLabel === labelOf(viewer))
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const mockClient: LedgerClient = {
  async listViewers() {
    await wait(40)
    return VIEWERS
  },

  // Seller adds a document at any tier — encrypted off-ledger (mocked), gated by tier.
  // Accepts typed text OR a real uploaded file (pdf/image/…), stored as a data URL in-browser.
  async addDocument(viewer: PartyId, draft: { title: string; tier: number; content?: string; file?: { name: string; mime: string; dataUrl: string } }) {
    if (viewer !== SELLER) throw new Error('Only the founder can add documents')
    const title = (draft.title || draft.file?.name || '').trim()
    if (!title) throw new Error('title required')
    if (!draft.file && !draft.content?.trim()) throw new Error('add file or text content')
    await wait(200)
    const t = Math.max(1, Math.floor(draft.tier || 1))
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'doc'
    docs.push({
      docId: `${slug}-${Date.now().toString(36).slice(-4)}`,
      title, tier: t,
      contentHash: 'sha256:' + Math.random().toString(16).slice(2, 18),
      content: draft.file ? '' : (draft.content ?? ''),
      mime: draft.file?.mime,
      dataUrl: draft.file?.dataUrl,
    })
  },

  // Seller onboards an investor at runtime: register the party + issue an access grant at the
  // chosen tier. The new lens appears immediately (inserted before the governance/observer lenses).
  async inviteBuyer(viewer: PartyId, buyerName: string, tier: number) {
    if (viewer !== SELLER) throw new Error('Only the founder can invite investors')
    const name = buyerName.trim()
    if (!name) throw new Error('Give the investor a name')
    if (VIEWERS.some((v) => v.party.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already in the room`)
    await wait(150)
    const t = tier >= 2 ? 2 : 1
    grants[name] = t
    kyc[name] = { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' } // cleared on onboarding
    const buyers = VIEWERS.filter((v) => v.role === 'buyer')
    const seller = VIEWERS.filter((v) => v.role === 'seller')
    const rest = VIEWERS.filter((v) => v.role !== 'buyer' && v.role !== 'seller')
    VIEWERS = [...seller, ...buyers, { party: name, label: `${name} (Investor · ${tierLabel(t)})`, role: 'buyer' }, ...rest]
    return name
  },

  // Investor locks cBTC toward the raise (creates an on-ledger Commitment in the live version).
  async commitCBTC(viewer: PartyId, amount: number) {
    if (roleOf(viewer) !== 'buyer') throw new Error('Only an investor can commit cBTC')
    if (!(amount > 0)) throw new Error('Enter a cBTC amount')
    await wait(150)
    commitments = { ...commitments, [viewer]: { amount, committedAt: new Date().toTimeString().slice(0, 5) } }
  },

  // Governance role records its on-ledger approval — required for the conditional close.
  async approve(viewer: PartyId, role: string) {
    const r = String(role).toUpperCase()
    if (!['BOARD', 'LEGAL', 'COMPLIANCE'].includes(r)) throw new Error('Unknown approval role')
    await wait(150)
    approvals = { ...approvals, [r]: { role: r, approvedAt: new Date().toTimeString().slice(0, 5) } }
  },

  // Founder sets up the room: rename tiers, set the raise target + title. Mutates the
  // in-browser deal so named tiers flow through documents and the AI exactly like live.
  async createDeal(viewer: PartyId, setup: DealSetup) {
    if (viewer !== SELLER) throw new Error('Only the founder can set up a deal')
    if (!(setup.raiseTarget > 0)) throw new Error('Set a raise target in cBTC')
    const tiers = setup.tiers.map((t) => t.trim()).filter(Boolean)
    if (tiers.length === 0) throw new Error('Name at least one tier')
    await wait(150)
    deal = { ...deal, title: setup.title.trim() || deal.title, instrument: setup.instrument.trim() || deal.instrument, raiseTarget: setup.raiseTarget, tiers }
  },
  // Mock is always seeded — "load demo" just restores the canonical demo config.
  async loadDemo() {
    await wait(150)
    deal = { ...deal, title: 'Halden Robotics — 25 cBTC Series A', instrument: 'HALDEN-EQUITY', raiseTarget: 25, tiers: ['Teaser', 'Financials', 'Legal'] }
  },

  // Investor submits a sealed bid for the stake on offer. Visible to the founder only.
  async submitOffer(viewer: PartyId, pricePerUnit: number) {
    if (roleOf(viewer) !== 'buyer') throw new Error('Only an investor can submit a bid')
    if (!(pricePerUnit > 0)) throw new Error('Enter a price per unit')
    await wait(150)
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    offers = [...offers, { offerId: `o${offers.length + 1}`, buyer: viewer, buyerLabel: labelOf(viewer), pricePerUnit, quantity: deal.quantity, submittedAt: stamp, status: 'open' }]
  },

  async getDealView(viewer: PartyId): Promise<DealView> {
    await wait(120)
    const isSeller = viewer === SELLER
    const isRegulator = viewer === 'Regulator'
    const role = roleOf(viewer)
    const isBuyer = role === 'buyer'
    const privileged = isSeller || isRegulator
    const maxTier = grants[viewer] ?? 0

    // Documents: founder sees all; an investor sees only up to their granted tier;
    // regulator sees that documents exist but not their tier-2 contents.
    const documents: Document[] = docs.map((d) => ({
      docId: d.docId,
      title: d.title,
      tier: d.tier,
      tierLabel: tierName(d.tier),
      contentHash: d.contentHash,
      accessible: isSeller || (maxTier >= d.tier) || (isRegulator && d.tier === 1),
    }))

    // Access trail: founder/regulator see the whole trail; an investor sees only their own.
    const trail = privileged ? accessTrail : accessTrail.filter((e) => e.buyer === viewer)

    // Offers: founder/regulator see all; an investor sees only their own sealed bid.
    const visibleOffers = (privileged ? offers : offers.filter((o) => o.buyer === viewer))
      .map((o) => ({ ...o, kyc: kyc[o.buyer] ?? null }))

    // Balances: a party sees holdings they own; founder/regulator see both sides.
    const allHoldings = holdings()
    const visibleHoldings = privileged ? allHoldings : allHoldings.filter((h) => h.owner === viewer)

    // Conditional-close panel + competing-investors table (founder lens).
    let conditions: DealView['conditions'] = undefined
    let investorsDetail: InvestorSummary[] | undefined = undefined
    if (isSeller) {
      const target = deal.raiseTarget ?? 0
      const tc = committedTotal()
      const list = conditionList()
      conditions = {
        raiseTarget: target,
        totalCommitted: tc,
        percentFunded: target > 0 ? Math.min(100, Math.round((tc / target) * 100)) : 0,
        conditions: list,
        allGreen: list.every((c) => c.done),
        commitmentsDetail: Object.entries(commitments).map(([p, c]) => ({ investorLabel: labelOf(p), amount: c.amount, committedAt: c.committedAt })),
      }
      investorsDetail = investorParties().map((p) => ({
        name: labelOf(p),
        tier: grants[p] ?? 1,
        committed: commitments[p]?.amount ?? null,
        committedAt: commitments[p]?.committedAt ?? null,
        hasBid: offers.some((o) => o.buyer === p),
        kyc: kyc[p] ?? null,
      }))
    }

    // Investor's own commitment; governance role's own approval.
    const myCommitment = isBuyer && commitments[viewer] ? { amount: commitments[viewer].amount, committedAt: commitments[viewer].committedAt } : null
    const myApprovalRole = role === 'board' ? 'BOARD' : role === 'legal' ? 'LEGAL' : role === 'compliance' ? 'COMPLIANCE' : null
    const myApproval = myApprovalRole && approvals[myApprovalRole] ? { role: myApprovalRole, approvedAt: approvals[myApprovalRole].approvedAt } : null

    // Unified on-chain audit trail (founder / oversight lens): the whole lifecycle in order.
    const lifecycle = privileged
      ? [
          ...investorParties().map((p, i) => ({ at: `09:0${i + 1}`, kind: 'grant' as const, actor: labelOf(p), detail: `granted access up to “${tierName(grants[p] ?? 1)}”` })),
          ...accessTrail.map((e) => ({ at: e.accessedAt, kind: 'disclosure' as const, actor: e.buyerLabel, detail: `opened “${e.docTitle}”` })),
          ...Object.entries(commitments).map(([p, c]) => ({ at: c.committedAt, kind: 'commitment' as const, actor: labelOf(p), detail: `committed ${c.amount} cBTC toward the raise` })),
          ...Object.values(approvals).map((a) => ({ at: a.approvedAt, kind: 'approval' as const, actor: a.role, detail: `${a.role} approval recorded on-ledger` })),
          ...(settled ? [{ at: '', kind: 'settlement' as const, actor: 'Registry', detail: 'cBTC ↔ equity swapped atomically — conditional close executed' }] : []),
        ].sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : 1))
      : undefined

    // Capital distribution: founder/regulator see the whole declaration; a holder sees only theirs.
    const mineDist = distribution?.recipients.find((r) => r.holderLabel === labelOf(viewer))
    const myDistribution: MyDistribution | null = mineDist
      ? { amount: mineDist.amount, shares: mineDist.shares, perShare: distribution!.perShare, declaredAt: distribution!.declaredAt }
      : null

    return {
      deal,
      documents,
      accessTrail: trail,
      offers: visibleOffers,
      holdings: visibleHoldings,
      capTable: capTableFor(viewer, privileged),
      settled,
      kyc: privileged ? null : kyc[viewer] ?? null,
      conditions,
      investorsDetail,
      myCommitment,
      myApproval,
      lifecycle,
      distribution: privileged ? distribution : null,
      myDistribution,
    }
  },

  async openDocument(viewer: PartyId, docId: string): Promise<DocContent> {
    await wait(120)
    const isSeller = viewer === SELLER
    const maxTier = grants[viewer] ?? 0
    const doc = docs.find((d) => d.docId === docId)
    if (!doc) throw new Error('unknown document')
    if (!isSeller && maxTier < doc.tier) {
      throw new Error(`Access restricted — insufficient privileges. Your grant covers tier ${maxTier}; "${doc.title}" is tier ${doc.tier}. The key service will not release the key.`)
    }
    if (!isSeller) {
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      accessTrail = [...accessTrail, { buyer: viewer, buyerLabel: labelOf(viewer), docId, docTitle: doc.title, accessedAt: stamp }]
    }
    const bytes = doc.dataUrl ? Math.floor((doc.dataUrl.split(',')[1]?.length ?? 0) * 0.75) : doc.content.length
    return { docId, title: doc.title, tier: doc.tier, hash: doc.contentHash, bytes, content: doc.content, mime: doc.mime, dataUrl: doc.dataUrl }
  },

  // Offline copilot stand-in (the live backend uses Venice AI). Still demonstrates the key point:
  // it can only answer from the tiers this party is granted.
  async ask(viewer: PartyId, question: string): Promise<AskResult> {
    await wait(500)
    const tier = viewer === SELLER ? 99 : grants[viewer] ?? 0
    const authorized = docs.filter((d) => tier >= d.tier)
    const wantsTier2 = /ebitda|revenue|margin|valuation|cash|backlog|financ|profit/i.test(question)
    const answer = wantsTier2 && tier < 2
      ? `Access restricted — insufficient privileges. The audited financials (revenue, EBITDA, margins, valuation) sit in the “${tierName(2)}” tier. Your grant covers “${tierName(tier)}”, so the copilot was never given those documents and cannot answer. Request that tier from the founder.`
      : `(offline copilot) Based on the ${authorized.length} document(s) your grant authorizes: ${authorized.map((d) => d.title).join(', ')}. ${tier >= 2 ? 'FY2025 revenue was 41.8M (+68% YoY) with 6.9M adj. EBITDA; the Series A raises 25 cBTC for the 120,000-share (~12%) stake.' : 'Halden Robotics is a warehouse-automation company; the teaser covers growth and the 25 cBTC Series A. Deeper figures are gated to tier 2.'}`
    return { answer, authorizedDocs: authorized.map((d) => d.title), tier: viewer === SELLER ? 'all tiers' : `tier ${tier}` }
  },

  async acceptOffer(viewer: PartyId, offerId: string) {
    await wait(120)
    if (viewer !== SELLER) throw new Error('Only the founder can accept a bid')
    offers = offers.map((o) => (o.offerId === offerId ? { ...o, status: 'accepted' } : o))
    acceptedOffer = offers.find((o) => o.offerId === offerId) ?? null
  },

  // The conditional close: enforces all 4 on-ledger conditions (mirrors Deal.Close), then swaps
  // cBTC ↔ equity atomically. Picks the highest sealed bid as the winner if none was accepted.
  async settle(viewer: PartyId) {
    if (viewer !== SELLER) throw new Error('Only the founder drives the close')
    if (!isAllGreen()) throw new Error('Close blocked — all 4 conditions (raise target + Board + Legal + Compliance) must be green.')
    await wait(900) // the atomic swap
    if (!acceptedOffer) acceptedOffer = offers.find((o) => o.buyer === winningBuyer()) ?? null
    settled = true
  },

  // Mirrors the Daml proof `testAtomicityHolds`: the executor tries to settle, but one
  // allocation leg has been pulled. The whole transaction rolls back — no partial close
  // is representable. State is left exactly as it was.
  async attemptBrokenClose(viewer: PartyId) {
    if (viewer !== SELLER) throw new Error('Only the founder drives settlement')
    if (settled) throw new Error('Already settled')
    await wait(900)
    throw new Error('One leg was pulled mid-close → settlement reverted → neither side moved.')
  },

  // Deal Readiness — composite % from the SAME on-chain signals as live, computed dynamically so
  // the gauge rises as the founder drives the deal (commitments + approvals tip it to 100%).
  async getReadiness(): Promise<ReadinessResult> {
    await wait(180)
    const target = deal.raiseTarget ?? 1
    const tc = committedTotal()
    const nApprovals = Object.keys(approvals).length
    const docsPts = 15
    const invPts = 15
    const bidsPts = offers.length > 0 ? 20 : 0
    const fundPts = Math.round(Math.min(1, tc / target) * 30)
    const apprPts = Math.round((nApprovals / 3) * 20)
    const score = docsPts + invPts + bidsPts + fundPts + apprPts
    const narration = score >= 100
      ? 'Deal is 100% ready — fully funded, all governance approvals in. The founder can close.'
      : `Deal is ${score}% ready — ${Math.round(Math.min(100, (tc / target) * 100))}% funded, ${nApprovals}/3 approvals in${tc >= target ? '' : `, ${target - tc} cBTC to target`}.`
    return {
      score,
      narration,
      signals: [
        { key: 'DOCS',      label: 'Documents in data room', pts: docsPts, max: 15, detail: `${docs.length} docs, multi-tier` },
        { key: 'INVESTORS', label: 'Investors invited',      pts: invPts,  max: 15, detail: `${investorParties().length} investors granted access` },
        { key: 'BIDS',      label: 'Sealed bids received',   pts: bidsPts, max: 20, detail: `${offers.length} sealed bids in` },
        { key: 'FUNDING',   label: `Raise target (${target} cBTC)`, pts: fundPts, max: 30, detail: `${tc} / ${target} cBTC (${Math.round((tc / target) * 100)}%)` },
        { key: 'APPROVALS', label: 'Governance approvals',   pts: apprPts, max: 20, detail: `${nApprovals} / 3 required` },
      ],
    }
  },

  // Regulator attestation: verify the founder received exactly the cBTC investors committed —
  // provable from the on-ledger commitments + settlement, with NO tier-2 document access.
  async attestClose(): Promise<CloseAttestation> {
    await wait(200)
    const committed = committedTotal()
    const raised = settled ? committed : 0
    return {
      settled,
      winningBuyerLabel: labelOf(winningBuyer()),
      bidPricePerUnit: 0,
      bidQuantity: EQUITY,
      expectedCash: committed,
      settledCash: raised,
      matched: settled && raised === committed,
    }
  },

  // Provable integrity (mock): recompute each blob's "hash" and compare to the ledger value.
  // A tampered doc recomputes to a different hash, so the ledger detects the off-chain change.
  async verifyIntegrity(viewer: PartyId): Promise<IntegrityReport> {
    if (viewer !== SELLER && viewer !== 'Regulator') throw new Error('Only the founder or a regulator can run an integrity check')
    await wait(700)
    const documents = docs.map((d) => {
      const ledgerHash = d.contentHash
      const recomputedHash = tampered.has(d.docId) ? d.contentHash.replace(/.$/, (c) => (c === 'f' ? 'a' : 'f')) : d.contentHash
      return { docId: d.docId, title: d.title, tier: d.tier, tierLabel: tierName(d.tier), ledgerHash, recomputedHash, intact: ledgerHash === recomputedHash }
    })
    return {
      documents,
      allIntact: documents.every((d) => d.intact),
      intactCount: documents.filter((d) => d.intact).length,
      total: documents.length,
      events: { grants: investorParties().length, disclosures: accessTrail.length, commitments: Object.keys(commitments).length, approvals: Object.keys(approvals).length },
      checkedAt: new Date().toTimeString().slice(0, 8),
    }
  },

  // DEMO ONLY: toggle a simulated off-chain tamper on one blob.
  async tamperVault(viewer: PartyId, docId: string) {
    if (viewer !== SELLER && viewer !== 'Regulator') throw new Error('Only the founder or a regulator can run the tamper demo')
    await wait(150)
    if (tampered.has(docId)) tampered.delete(docId)
    else tampered.add(docId)
  },

  // Post-close: founder declares a pro-rata cBTC distribution to the whole cap table.
  async distribute(viewer: PartyId, amount: number) {
    if (viewer !== SELLER) throw new Error('Only the founder can declare a distribution')
    if (!settled) throw new Error('No cBTC treasury — close the deal first.')
    if (!(amount > 0)) throw new Error('amount must be > 0')
    if (amount > committedTotal()) throw new Error(`Treasury holds ${committedTotal()} cBTC; cannot distribute ${amount}.`)
    await wait(700)
    const rows = capTableFor(SELLER, true)            // Founders / ESOP / winning investor
    const totalShares = rows.reduce((s, r) => s + r.shares, 0) || 1
    const perShare = amount / totalShares
    distribution = {
      distributionId: 'DIST-HALDEN-2026-A',
      perShare,
      total: amount,
      declaredAt: new Date().toTimeString().slice(0, 5),
      recipients: rows.map((r) => ({ holderLabel: r.holderLabel, shares: r.shares, amount: Math.round(r.shares * perShare * 100) / 100 })),
    }
  },
}
