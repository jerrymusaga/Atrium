import type { LedgerClient, PartyId } from './LedgerClient'
import type { AccessEvent, CloseAttestation, Deal, DealView, DocContent, Document, Holding, Offer, Viewer } from '../types'

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

const deal: Deal = {
  dealId: 'HALDEN-2026-A',
  title: 'Halden Robotics — 12% secondary',
  seller: SELLER,
  instrument: 'HALDEN-EQUITY',
  quantity: 120000,
}

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const mockClient: LedgerClient = {
  async listViewers() {
    await wait(40)
    return VIEWERS
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

    return { deal, documents, accessTrail: trail, offers: visibleOffers, holdings: visibleHoldings, settled, kyc: isSeller || isRegulator ? null : kyc[viewer] ?? null }
  },

  async openDocument(viewer: PartyId, docId: string): Promise<DocContent> {
    await wait(120)
    const isSeller = viewer === SELLER
    const maxTier = grants[viewer] ?? 0
    const doc = docs.find((d) => d.docId === docId)
    if (!doc) throw new Error('unknown document')
    if (!isSeller && maxTier < doc.tier) {
      throw new Error(`Sealed. Your grant covers tier ${maxTier}; "${doc.title}" is tier ${doc.tier}. The key service will not release the key.`)
    }
    if (!isSeller) {
      const label = viewer === BUYER_A ? 'Boranic' : viewer === BUYER_B ? 'Meridian' : viewer
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      accessTrail = [...accessTrail, { buyer: viewer, buyerLabel: label, docId, docTitle: doc.title, accessedAt: stamp }]
    }
    return { docId, title: doc.title, tier: doc.tier, hash: doc.contentHash, bytes: doc.content.length, content: doc.content }
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
}
