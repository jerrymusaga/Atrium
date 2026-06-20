import type { LedgerClient, PartyId } from './LedgerClient'
import type { AccessEvent, Deal, DealView, Document, Holding, Offer, Viewer } from '../types'

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

const VIEWERS: Viewer[] = [
  { party: SELLER, label: 'Halden (Seller)', role: 'seller' },
  { party: BUYER_A, label: 'Boranic (Buyer · tier 1)', role: 'buyer' },
  { party: BUYER_B, label: 'Meridian (Buyer · tier 1+2)', role: 'buyer' },
  { party: 'Regulator', label: 'Regulator (observer)', role: 'regulator' },
]

const deal: Deal = {
  dealId: 'HALDEN-2026-A',
  title: 'Halden Robotics — 12% secondary',
  seller: SELLER,
  instrument: 'HALDEN-EQUITY',
  quantity: 120000,
}

type RawDoc = { docId: string; title: string; tier: number; contentHash: string }
const docs: RawDoc[] = [
  { docId: 'teaser', title: 'Investment teaser', tier: 1, contentHash: 'sha256:aa11' },
  { docId: 'financials', title: 'Audited financials', tier: 2, contentHash: 'sha256:bb22' },
]

// buyer -> max tier they may access
const grants: Record<PartyId, number> = { [BUYER_A]: 1, [BUYER_B]: 2 }

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
let acceptedBuyer: PartyId | null = null

function holdings(): Holding[] {
  if (!settled) {
    return [
      { owner: BUYER_B, ownerLabel: 'Meridian', instrument: 'USD-CASH', amount: 4200000 },
      { owner: SELLER, ownerLabel: 'Halden', instrument: 'HALDEN-EQUITY', amount: 120000 },
    ]
  }
  return [
    { owner: SELLER, ownerLabel: 'Halden', instrument: 'USD-CASH', amount: 4200000 },
    { owner: BUYER_B, ownerLabel: 'Meridian', instrument: 'HALDEN-EQUITY', amount: 120000 },
  ]
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const mockClient: LedgerClient = {
  viewers: () => VIEWERS,

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
    const visibleOffers = isSeller || isRegulator ? offers : offers.filter((o) => o.buyer === viewer)

    // Balances: a party sees holdings they own; seller/regulator see both sides.
    const allHoldings = holdings()
    const visibleHoldings =
      isSeller || isRegulator ? allHoldings : allHoldings.filter((h) => h.owner === viewer)

    return { deal, documents, accessTrail: trail, offers: visibleOffers, holdings: visibleHoldings, settled }
  },

  async recordAccess(viewer: PartyId, docId: string) {
    await wait(80)
    const maxTier = grants[viewer] ?? 0
    const doc = docs.find((d) => d.docId === docId)
    if (!doc || maxTier < doc.tier) throw new Error('Sealed — not in your tier')
    const label = viewer === BUYER_A ? 'Boranic' : viewer === BUYER_B ? 'Meridian' : viewer
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    accessTrail = [...accessTrail, { buyer: viewer, buyerLabel: label, docId, docTitle: doc.title, accessedAt: stamp }]
  },

  async acceptOffer(viewer: PartyId, offerId: string) {
    await wait(120)
    if (viewer !== SELLER) throw new Error('Only the seller can accept an offer')
    offers = offers.map((o) => (o.offerId === offerId ? { ...o, status: 'accepted' } : o))
    acceptedBuyer = offers.find((o) => o.offerId === offerId)?.buyer ?? null
  },

  async settle() {
    await wait(700) // the atomic swap
    if (!acceptedBuyer) throw new Error('Accept the winning offer before settling')
    settled = true
  },
}
