// Domain types — mirror the Daml templates in ledger/daml/Atrium.
export type PartyId = string

export type Viewer = {
  party: PartyId
  label: string
  role: 'seller' | 'buyer' | 'regulator'
}

export type Deal = {
  dealId: string
  title: string
  seller: PartyId
  instrument: string
  quantity: number
}

export type Document = {
  docId: string
  title: string
  tier: number // 1 = teaser, 2 = deep
  contentHash: string
  // Whether THIS viewer may see the contents. In production this is enforced by the
  // ledger (the viewer's node simply lacks the data); here the mock filters to mimic it.
  accessible: boolean
}

export type AccessEvent = {
  buyer: PartyId
  buyerLabel: string
  docId: string
  docTitle: string
  accessedAt: string
}

export type Offer = {
  offerId: string
  buyer: PartyId
  buyerLabel: string
  pricePerUnit: number
  quantity: number
  submittedAt: string
  status: 'open' | 'accepted' | 'withdrawn'
}

export type Holding = {
  owner: PartyId
  ownerLabel: string
  instrument: string
  amount: number
}

export type DealView = {
  deal: Deal
  documents: Document[]
  accessTrail: AccessEvent[] // only the events this viewer is entitled to see
  offers: Offer[] // only the offers this viewer is entitled to see
  holdings: Holding[] // balances this viewer can see
  settled: boolean
}
