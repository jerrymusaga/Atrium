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
  tiers?: string[]   // named access tiers, ordered; tier N's label = tiers[N-1]
}

export type Document = {
  docId: string
  title: string
  tier: number
  tierLabel?: string
  contentHash: string
  accessible: boolean
}

// Founder's "set up the room" config — creates the on-ledger Deal with named tiers.
export type DealSetup = {
  title: string
  instrument: string
  raiseTarget: number
  tiers: string[]
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

export type CommitmentDetail = {
  investorLabel: string
  amount: number
  committedAt: string
}

export type DealConditions = {
  raiseTarget: number
  totalCommitted: number
  percentFunded: number
  conditions: ConditionItem[]
  allGreen: boolean
  commitmentCids?: string[]
  approvalCids?: string[]
  commitmentsDetail?: CommitmentDetail[]
}

export type InvestorSummary = {
  name: string
  tier: number
  committed: number | null
  committedAt: string | null
  hasBid: boolean
  kyc: KYC | null
}

export type ReadinessSignal = {
  key: string
  label: string
  pts: number
  max: number
  detail: string
}

export type ReadinessResult = {
  score: number
  signals: ReadinessSignal[]
  narration: string
}

export type DealView = {
  deal: Deal | null
  documents: Document[]
  accessTrail: AccessEvent[]
  offers: Offer[]
  holdings: Holding[]
  capTable?: CapTableRow[]
  settled: boolean
  kyc?: KYC | null
  conditions?: DealConditions
  myCommitment?: { amount: number; committedAt: string } | null
  myApproval?: { role: string; approvedAt: string } | null
  investorsDetail?: InvestorSummary[]   // founder lens: per-investor competing bids table
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
