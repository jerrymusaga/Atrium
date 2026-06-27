// Domain types — mirror the Daml templates in ledger/daml/Atrium.
export type PartyId = string

export type Viewer = {
  party: PartyId
  label: string
  role: 'seller' | 'buyer' | 'regulator' | 'board' | 'legal' | 'compliance'
  live?: boolean
}

export type Deal = {
  dealId: string
  title: string
  seller: PartyId
  instrument: string
  quantity: number
  raiseTarget?: number
}

export type Document = {
  docId: string
  title: string
  tier: number
  contentHash: string
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

export type DocContent = { docId: string; title: string; tier: number; hash: string; bytes: number; content: string }
export type AskResult = { answer: string; authorizedDocs: string[]; tier: string }

export type Offer = {
  offerId: string
  buyer: PartyId
  buyerLabel: string
  pricePerUnit: number
  quantity: number
  submittedAt: string
  status: 'open' | 'accepted' | 'withdrawn'
  kyc?: KYC | null
}

export type Holding = {
  owner: PartyId
  ownerLabel: string
  instrument: string
  amount: number
}

export type CapTableRow = { holderLabel: string; shares: number; pct: number }

export type ConditionItem = {
  key: string
  label: string
  done: boolean
  detail?: string
  approvedAt?: string
}

export type DealConditions = {
  raiseTarget: number
  totalCommitted: number
  percentFunded: number
  conditions: ConditionItem[]
  allGreen: boolean
  commitmentCids?: string[]
  approvalCids?: string[]
}

export type DealView = {
  deal: Deal
  documents: Document[]
  accessTrail: AccessEvent[]
  offers: Offer[]
  holdings: Holding[]
  capTable?: CapTableRow[]
  settled: boolean
  kyc?: KYC | null
  conditions?: DealConditions        // founder view: close gate status
  myCommitment?: { amount: number; committedAt: string } | null  // investor view
  myApproval?: { role: string; approvedAt: string } | null       // approver view
}

export type CloseAttestation = {
  settled: boolean
  winningBuyerLabel: string | null
  bidPricePerUnit: number
  bidQuantity: number
  expectedCash: number
  settledCash: number
  matched: boolean
}
