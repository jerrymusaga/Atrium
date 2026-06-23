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

export type KYC = { level: string; jurisdiction: string }

// Decrypted document content, returned only when the ledger authorized the key release.
export type DocContent = { docId: string; title: string; tier: number; hash: string; bytes: number; content: string }

// A diligence-copilot answer. `authorizedDocs` is exactly what the model was allowed to read.
export type AskResult = { answer: string; authorizedDocs: string[]; tier: string }

export type Offer = {
  offerId: string
  buyer: PartyId
  buyerLabel: string
  pricePerUnit: number
  quantity: number
  submittedAt: string
  status: 'open' | 'accepted' | 'withdrawn'
  kyc?: KYC | null // current KYC/KYB attestation for the bidder, if any
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
  kyc?: KYC | null // the viewing buyer's own KYC/KYB clearance (null for seller/regulator)
}

// What a regulator (scoped choice-observer on the close) can attest to: that the
// settlement moved exactly the winning bid — WITHOUT ever seeing tier-2 contents.
export type CloseAttestation = {
  settled: boolean
  winningBuyerLabel: string | null
  bidPricePerUnit: number
  bidQuantity: number
  expectedCash: number // price × quantity, from the recorded bid
  settledCash: number // what the cash leg actually moved
  matched: boolean // settledCash === expectedCash
}
