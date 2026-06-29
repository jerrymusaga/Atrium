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

// A real uploaded file (read in the browser as a data URL) attached to a document draft.
export type DocFile = { name: string; mime: string; dataUrl: string }
export type DocContent = {
  docId: string; title: string; tier: number; hash: string; bytes: number
  content: string         // decrypted text (for text docs); '' for binary files
  mime?: string           // when set, the doc is a real file (pdf/image/…)
  dataUrl?: string        // data: URL for previewing / downloading the decrypted file
}
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

// One on-ledger event in the unified audit trail (founder / oversight lens).
export type LifecycleKind = 'grant' | 'disclosure' | 'commitment' | 'approval' | 'settlement'
export type LifecycleEvent = {
  at: string          // HH:MM ledger timestamp ('' for the synthetic settlement cap)
  kind: LifecycleKind
  actor: string       // who acted (investor / role / registry)
  detail: string      // human-readable description of the ledger event
}

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
  lifecycle?: LifecycleEvent[]          // founder / oversight lens: unified on-chain audit trail
  distribution?: DistributionSummary | null   // founder / regulator: declared capital distribution
  myDistribution?: MyDistribution | null       // holder lens: their own private payout receipt
}

// Provable integrity — proof that the off-chain vault still matches what Canton recorded.
export type IntegrityDoc = {
  docId: string
  title: string
  tier: number
  tierLabel: string
  ledgerHash: string      // Document.contentHash, immutable on Canton
  recomputedHash: string  // sha256 of the ciphertext on disk right now
  intact: boolean         // ledgerHash === recomputedHash
}

export type IntegrityReport = {
  documents: IntegrityDoc[]
  allIntact: boolean
  intactCount: number
  total: number
  // counts of the consequential ledger events backing the audit trail (tamper-evident on Canton)
  events: { grants: number; disclosures: number; commitments: number; approvals: number }
  checkedAt: string
}

// Post-close lifecycle — a pro-rata cBTC distribution to the cap table.
export type DistributionRecipient = { holderLabel: string; shares: number; amount: number }
export type DistributionSummary = {
  distributionId: string
  perShare: number
  total: number
  declaredAt: string
  recipients: DistributionRecipient[]   // founder / regulator only
}
export type MyDistribution = { amount: number; shares: number; perShare: number; declaredAt: string }

export type CloseAttestation = {
  settled: boolean
  winningBuyerLabel: string | null
  bidPricePerUnit: number
  bidQuantity: number
  expectedCash: number
  settledCash: number
  matched: boolean
}
