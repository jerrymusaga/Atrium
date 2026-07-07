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
  quantity: number      // stake on offer, in shares (the % of the company being raised)
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
export type LifecycleKind = 'grant' | 'disclosure' | 'commitment' | 'approval' | 'settlement' | 'distribution'
export type LifecycleEvent = {
  at: string          // HH:MM ledger timestamp ('' for the synthetic settlement cap)
  kind: LifecycleKind
  actor: string       // who acted (investor / role / registry)
  detail: string      // human-readable description of the ledger event
}

// Multi-asset: investors commit in any CIP-56 asset; the round is denominated in USD.
export type Asset = 'USDCx' | 'cBTC' | 'cETH'
export const ASSETS: Asset[] = ['USDCx', 'cBTC', 'cETH']
export type Rates = Record<Asset, number>   // USD price per unit (oracle; USDCx = 1)

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

export type AssetTotal = { asset: Asset; amount: number; usdValue: number }

export type DealConditions = {
  raiseTarget: number        // USD
  totalCommitted: number     // USD
  percentFunded: number
  conditions: ConditionItem[]
  allGreen: boolean
  commitmentCids?: string[]
  approvalCids?: string[]
  commitmentsDetail?: CommitmentDetail[]
  committedByAsset?: AssetTotal[]   // the USD-denominated round, broken down by CIP-56 asset
}

export type InvestorSummary = {
  name: string
  tier: number
  asset: Asset | null        // the asset this investor committed in
  committed: number | null   // amount in that asset
  committedUsd: number | null
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
  myCommitment?: { asset: Asset; amount: number; usdValue: number; committedAt: string } | null
  myApproval?: { role: string; approvedAt: string; envelopeId?: string; documentHash?: string } | null
  investorsDetail?: InvestorSummary[]   // founder lens: per-investor competing bids table
  lifecycle?: LifecycleEvent[]          // founder / oversight lens: unified on-chain audit trail
  distribution?: DistributionSummary | null   // founder / regulator: declared capital distribution
  myDistribution?: MyDistribution | null       // holder lens: their own private payout receipt
  rates?: Rates                          // the price oracle (USD per unit) used to value commitments
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

// A real Canton write, surfaced so judges watch transactions land on-ledger live.
export type LedgerTxn = { updateId: string; summary: string; actor: string; at: string }

// Where an investor's real token payment leg is sent (the deal escrow party).
export type PayToParty = { party: string; label: string }
// Reference to a real CIP-56 token transfer the investor signed in their own Loop wallet,
// anchoring the on-ledger Commitment to the genuine on-chain payment.
export type CommitPayment = { updateId?: string; walletParty?: string; symbol?: string }

export type CloseAttestation = {
  settled: boolean
  winningBuyerLabel: string | null
  bidPricePerUnit: number
  bidQuantity: number
  expectedCash: number
  settledCash: number
  matched: boolean
}
