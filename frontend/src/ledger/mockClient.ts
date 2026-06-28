import type { LedgerClient, PartyId } from './LedgerClient'
import type { AccessEvent, AskResult, CapTableRow, CloseAttestation, Deal, DealSetup, DealView, DistributionSummary, DocContent, Document, Holding, IntegrityReport, MyDistribution, Offer, ReadinessResult, Viewer } from '../types'

// ---------------------------------------------------------------------------
// In-browser mock of the Atrium ledger, seeded with the Halden Robotics demo.
// It mimics Canton's selective disclosure by FILTERING each view to what a party
// is entitled to see. The real ledger enforces this at the node level; here it's
// a faithful stand-in so the UI (and the three-view demo) runs with no backend.
// ---------------------------------------------------------------------------

const SELLER = 'Halden'
const BUYER_A = 'Boranic'
const BUYER_B = 'Meridian'
const OPERATOR = 'AtriumApp'

let VIEWERS: Viewer[] = [
  { party: SELLER, label: 'Halden (Seller)', role: 'seller' },
  { party: BUYER_A, label: 'Boranic (Buyer · tier 1)', role: 'buyer' },
  { party: BUYER_B, label: 'Meridian (Buyer · tier 1+2)', role: 'buyer' },
  { party: 'Regulator', label: 'Regulator (observer)', role: 'regulator' },
]

const tierLabel = (t: number) => (t >= 2 ? 'tier 1+2' : 'tier 1')

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

type RawDoc = { docId: string; title: string; tier: number; contentHash: string; content: string }
const docs: RawDoc[] = [
  {
    docId: 'teaser', title: 'Investment teaser', tier: 1, contentHash: 'sha256:b52e8f7e1d344718',
    content: `HALDEN ROBOTICS — INVESTMENT TEASER (Tier 1)\n\nProject Halden — 12% secondary sale of Halden Robotics, a warehouse-automation company.\nFounded 2019 · Oslo & Austin · 140 FTE. Category: autonomous mobile robots for 3PL.\n\n• 3-year revenue CAGR ~70%; gross margin expanding with the Gen-3 fleet.\n• Blue-chip logistics customers; multi-year contracted backlog.\n• Stake on offer: 120,000 shares (~12% fully diluted).\n\nAudited financials and the cap table are in Tier 2, for verified deep-diligence buyers.`,
  },
  {
    docId: 'financials', title: 'Audited financials', tier: 2, contentHash: 'sha256:6add8e4565209a06',
    content: `HALDEN ROBOTICS — AUDITED FINANCIALS (Tier 2 · CONFIDENTIAL)\n\nFY2025 (audited, USD)\n  Revenue                 41,800,000\n  YoY growth                    +68%\n  Gross profit            24,300,000   (58.1% margin)\n  Adj. EBITDA              6,900,000   (16.5% margin)\n  Net cash                12,400,000\n  Contracted backlog      57,000,000\n\nImplied valuation at the offered terms\n  Price / share                35.00\n  Stake (120,000 sh)       4,200,000\n  Implied equity value    35,000,000   (~0.84x FY25 revenue)\n\nIf you can read this, the key service released your AES-256-GCM key —\nwhich it only does because the ledger confirms your grant covers Tier 2.`,
  },
]

// buyer -> max tier they may access
const grants: Record<PartyId, number> = { [BUYER_A]: 1, [BUYER_B]: 2 }

// buyer -> current KYC/KYB attestation (issued by an independent provider). The compliance
// gate: an offer can only be accepted from a KYC-cleared bidder.
const kyc: Record<PartyId, { level: string; jurisdiction: string }> = {
  [BUYER_A]: { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' },
  [BUYER_B]: { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' },
}

let accessTrail: AccessEvent[] = [
  { buyer: BUYER_A, buyerLabel: 'Boranic', docId: 'teaser', docTitle: 'Investment teaser', accessedAt: '09:14' },
  { buyer: BUYER_B, buyerLabel: 'Meridian', docId: 'teaser', docTitle: 'Investment teaser', accessedAt: '09:31' },
  { buyer: BUYER_B, buyerLabel: 'Meridian', docId: 'financials', docTitle: 'Audited financials', accessedAt: '10:02' },
]

let offers: Offer[] = [
  { offerId: 'o1', buyer: BUYER_B, buyerLabel: 'Meridian', pricePerUnit: 35, quantity: 120000, submittedAt: '11:20', status: 'open' },
  { offerId: 'o2', buyer: BUYER_A, buyerLabel: 'Boranic', pricePerUnit: 31, quantity: 120000, submittedAt: '11:48', status: 'open' },
]

let settled = false
let acceptedOffer: Offer | null = null
// simulated off-chain tampering set (mock only) — docIds whose blob has been "corrupted"
const tampered = new Set<string>()
// post-close capital distribution (mock) — null until the founder declares one
let distribution: DistributionSummary | null = null

const CASH = 4200000
const EQUITY = 120000

function holdings(): Holding[] {
  // Buyer of record is whoever the seller accepted (defaults to Meridian for the seed view).
  const buyer = acceptedOffer?.buyer ?? BUYER_B
  const buyerLabel = buyer === BUYER_A ? 'Boranic' : 'Meridian'
  if (!settled) {
    return [
      { owner: buyer, ownerLabel: buyerLabel, instrument: 'USD-CASH', amount: CASH },
      { owner: SELLER, ownerLabel: 'Halden', instrument: 'HALDEN-EQUITY', amount: EQUITY },
    ]
  }
  return [
    { owner: SELLER, ownerLabel: 'Halden', instrument: 'USD-CASH', amount: CASH },
    { owner: buyer, ownerLabel: buyerLabel, instrument: 'HALDEN-EQUITY', amount: EQUITY },
  ]
}

// Halden Robotics cap table: 1,000,000 shares. The 120,000-share (12%) stake on offer is held by
// the seller until the close, then by the winning buyer. Seller/regulator see all; a buyer sees only their line.
const TOTAL_SHARES = 1000000
function capTableFor(viewer: PartyId, privileged: boolean): CapTableRow[] {
  const stakeHolder = settled ? acceptedOffer?.buyerLabel ?? 'Meridian' : 'Halden'
  const rows: CapTableRow[] = [
    { holderLabel: 'Founders', shares: 600000, pct: 60 },
    { holderLabel: 'ESOP', shares: 280000, pct: 28 },
    { holderLabel: stakeHolder, shares: 120000, pct: 12 },
  ]
  void TOTAL_SHARES
  if (privileged) return rows
  const myLabel = viewer === BUYER_A ? 'Boranic' : viewer === BUYER_B ? 'Meridian' : viewer
  return rows.filter((r) => r.holderLabel === myLabel)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const mockClient: LedgerClient = {
  async listViewers() {
    await wait(40)
    return VIEWERS
  },

  // Seller adds a document at any tier — encrypted off-ledger (mocked), gated by tier.
  async addDocument(viewer: PartyId, draft: { title: string; tier: number; content: string }) {
    if (viewer !== SELLER) throw new Error('Only the seller can add documents')
    const title = draft.title.trim()
    if (!title || !draft.content.trim()) throw new Error('title and content required')
    await wait(150)
    const t = Math.max(1, Math.floor(draft.tier || 1))
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'doc'
    docs.push({ docId: `${slug}-${Date.now().toString(36).slice(-4)}`, title, tier: t, contentHash: 'sha256:' + Math.random().toString(16).slice(2, 18), content: draft.content })
  },

  // Seller onboards a buyer at runtime: register the party (insert before the Regulator)
  // and issue an access grant at the chosen tier. The new lens appears immediately.
  async inviteBuyer(viewer: PartyId, buyerName: string, tier: number) {
    if (viewer !== SELLER) throw new Error('Only the seller can invite buyers')
    const name = buyerName.trim()
    if (!name) throw new Error('Give the buyer a name')
    if (VIEWERS.some((v) => v.party.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already in the room`)
    await wait(150)
    const t = tier >= 2 ? 2 : 1
    grants[name] = t
    kyc[name] = { level: 'KYB-INSTITUTIONAL', jurisdiction: 'US' } // cleared on onboarding
    const reg = VIEWERS.filter((v) => v.role === 'regulator')
    const rest = VIEWERS.filter((v) => v.role !== 'regulator')
    VIEWERS = [...rest, { party: name, label: `${name} (Buyer · ${tierLabel(t)})`, role: 'buyer' }, ...reg]
    return name
  },

  async commitCBTC(_viewer: PartyId, _amount: number) { await wait(150) },
  async approve(_viewer: PartyId, _role: string) { await wait(150) },

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

  // Buyer submits a bid for the whole stake on offer. Visible to the seller only.
  async submitOffer(viewer: PartyId, pricePerUnit: number) {
    const me = VIEWERS.find((v) => v.party === viewer)
    if (!me || me.role !== 'buyer') throw new Error('Only a buyer can submit an offer')
    if (!(pricePerUnit > 0)) throw new Error('Enter a price per unit')
    await wait(150)
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    offers = [...offers, { offerId: `o${offers.length + 1}`, buyer: viewer, buyerLabel: viewer, pricePerUnit, quantity: deal.quantity, submittedAt: stamp, status: 'open' }]
  },

  async getDealView(viewer: PartyId): Promise<DealView> {
    await wait(120)
    const isSeller = viewer === SELLER
    const isRegulator = viewer === 'Regulator'
    const maxTier = grants[viewer] ?? 0

    // Documents: seller sees all; a buyer sees only up to their granted tier;
    // regulator sees that documents exist but not their tier-2 contents.
    const documents: Document[] = docs.map((d) => ({
      docId: d.docId,
      title: d.title,
      tier: d.tier,
      tierLabel: tierName(d.tier),
      contentHash: d.contentHash,
      accessible: isSeller || (maxTier >= d.tier) || (isRegulator && d.tier === 1),
    }))

    // Access trail: seller (and regulator) see the whole trail; a buyer sees only
    // their own accesses — and never learns the other buyer exists.
    const trail = isSeller || isRegulator ? accessTrail : accessTrail.filter((e) => e.buyer === viewer)

    // Offers: seller sees all; regulator sees them (supervisory); a buyer sees only
    // their own bid, never a rival's.
    const visibleOffers = (isSeller || isRegulator ? offers : offers.filter((o) => o.buyer === viewer))
      .map((o) => ({ ...o, kyc: kyc[o.buyer] ?? null }))

    // Balances: a party sees holdings they own; seller/regulator see both sides.
    const allHoldings = holdings()
    const visibleHoldings =
      isSeller || isRegulator ? allHoldings : allHoldings.filter((h) => h.owner === viewer)

    // Unified on-chain audit trail (founder / oversight lens): grants → disclosures → settlement.
    const lifecycle = isSeller || isRegulator
      ? [
          { at: '09:02', kind: 'grant' as const, actor: 'Boranic', detail: `granted access up to “${tierName(1)}”` },
          { at: '09:05', kind: 'grant' as const, actor: 'Meridian', detail: `granted access up to “${tierName(2)}”` },
          ...accessTrail.map((e) => ({ at: e.accessedAt, kind: 'disclosure' as const, actor: e.buyerLabel, detail: `opened “${e.docTitle}”` })),
          ...(settled ? [{ at: '', kind: 'settlement' as const, actor: 'Registry', detail: 'cash ↔ equity swapped atomically — conditional close executed' }] : []),
        ].sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : 1))
      : undefined

    // Capital distribution: founder/regulator see the whole declaration; a holder sees only theirs.
    const myLabel = viewer === BUYER_A ? 'Boranic' : viewer === BUYER_B ? 'Meridian' : viewer
    const mine = distribution?.recipients.find((r) => r.holderLabel === myLabel)
    const myDistribution: MyDistribution | null = mine
      ? { amount: mine.amount, shares: mine.shares, perShare: distribution!.perShare, declaredAt: distribution!.declaredAt }
      : null

    return { deal, documents, accessTrail: trail, offers: visibleOffers, holdings: visibleHoldings, capTable: capTableFor(viewer, isSeller || isRegulator), settled, kyc: isSeller || isRegulator ? null : kyc[viewer] ?? null, lifecycle, distribution: isSeller || isRegulator ? distribution : null, myDistribution }
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
      const label = viewer === BUYER_A ? 'Boranic' : viewer === BUYER_B ? 'Meridian' : viewer
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      accessTrail = [...accessTrail, { buyer: viewer, buyerLabel: label, docId, docTitle: doc.title, accessedAt: stamp }]
    }
    return { docId, title: doc.title, tier: doc.tier, hash: doc.contentHash, bytes: doc.content.length, content: doc.content }
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
      : `(offline copilot) Based on the ${authorized.length} document(s) your grant authorizes: ${authorized.map((d) => d.title).join(', ')}. ${tier >= 2 ? 'FY2025 revenue was $41.8M (+68% YoY) with $6.9M adj. EBITDA; the 120,000-share stake is offered at $35.00 (~$4.2M).' : 'Halden Robotics is a warehouse-automation company; the teaser covers growth and the stake on offer. Deeper figures are gated to tier 2.'}`
    return { answer, authorizedDocs: authorized.map((d) => d.title), tier: viewer === SELLER ? 'all tiers' : `tier ${tier}` }
  },

  async acceptOffer(viewer: PartyId, offerId: string) {
    await wait(120)
    if (viewer !== SELLER) throw new Error('Only the seller can accept an offer')
    offers = offers.map((o) => (o.offerId === offerId ? { ...o, status: 'accepted' } : o))
    acceptedOffer = offers.find((o) => o.offerId === offerId) ?? null
  },

  async settle() {
    await wait(900) // the atomic swap
    if (!acceptedOffer) throw new Error('Accept the winning offer before settling')
    settled = true
  },

  // Mirrors the Daml proof `testAtomicityHolds`: the executor tries to settle, but one
  // allocation leg has been pulled. The whole transaction rolls back — no partial close
  // is representable. State is left exactly as it was.
  async attemptBrokenClose(viewer: PartyId) {
    if (viewer !== SELLER) throw new Error('Only the seller drives settlement')
    if (settled) throw new Error('Already settled')
    await wait(900)
    throw new Error('One leg was pulled mid-close → settlement reverted → neither side moved.')
  },

  async getReadiness(): Promise<ReadinessResult> {
    await wait(200)
    return {
      score: 50,
      narration: 'Deal is 50% ready — documents and competing bids in, cBTC not yet committed, approvals pending.',
      signals: [
        { key: 'DOCS',      label: 'Documents in data room', pts: 15, max: 15, detail: '2 docs, multi-tier' },
        { key: 'INVESTORS', label: 'Investors invited',      pts: 15, max: 15, detail: '2 investors granted access' },
        { key: 'BIDS',      label: 'Sealed bids received',  pts: 20, max: 20, detail: '2 sealed bids in' },
        { key: 'FUNDING',   label: 'Raise target (25 cBTC)', pts: 0,  max: 30, detail: '0 / 25 cBTC (0%)' },
        { key: 'APPROVALS', label: 'Governance approvals',  pts: 0,  max: 20, detail: '0 / 3 required' },
      ],
    }
  },

  async attestClose(): Promise<CloseAttestation> {
    await wait(200)
    const bid = acceptedOffer
    const expectedCash = bid ? bid.pricePerUnit * bid.quantity : 0
    return {
      settled,
      winningBuyerLabel: bid?.buyerLabel ?? null,
      bidPricePerUnit: bid?.pricePerUnit ?? 0,
      bidQuantity: bid?.quantity ?? 0,
      expectedCash,
      settledCash: settled ? CASH : 0,
      matched: settled && expectedCash === CASH,
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
      events: { grants: 2, disclosures: accessTrail.length, commitments: settled ? 3 : 1, approvals: settled ? 3 : 0 },
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
    await wait(700)
    const rows = capTableFor(SELLER, true)            // Founders / ESOP / winning investor
    const totalShares = rows.reduce((s, r) => s + r.shares, 0) || 1
    const perShare = amount / totalShares
    distribution = {
      distributionId: 'DIST-HALDEN-2026-A',
      perShare,
      total: amount,
      declaredAt: new Date().toTimeString().slice(0, 5),
      recipients: rows.map((r) => ({ holderLabel: r.holderLabel, shares: r.shares, amount: Math.round(r.shares * perShare) })),
    }
  },
}
