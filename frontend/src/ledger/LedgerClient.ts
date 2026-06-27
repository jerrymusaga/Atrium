import type { AskResult, CloseAttestation, DealSetup, DealView, DocContent, ReadinessResult, Viewer } from '../types'

// The seam between UI and ledger. The mock implements this entirely in-browser.
// In Stage 3, implement this same interface against the Canton JSON Ledger API
// (queries scoped per party + the executor app driving the AllocationV1 close).
export interface LedgerClient {
  // The lenses available right now. Async + re-fetchable because the seller can onboard
  // new buyers at runtime (each becomes a real ledger party).
  listViewers(): Promise<Viewer[]>
  // Returns the deal AS SEEN BY `viewer` — documents redacted, trail/offers scoped.
  getDealView(viewer: PartyId): Promise<DealView>
  // Founder sets up the room from scratch: creates the on-ledger Deal with NAMED tiers +
  // raise target. The founder then adds docs per named tier and invites investors.
  createDeal(viewer: PartyId, setup: DealSetup): Promise<void>
  // One-click "load the fundraise demo" — seeds the full deterministic deal (investors,
  // docs, bids, commitments, governance, settlement legs) for recording.
  loadDemo(): Promise<void>
  // Seller adds a document at ANY tier: encrypted off-ledger, hash + tier recorded on-ledger.
  addDocument(viewer: PartyId, draft: { title: string; tier: number; content: string }): Promise<void>
  // Seller onboards a buyer to the deal: ensures the buyer party exists on the ledger and
  // issues an AccessGrant at the given tier. Returns the new party id.
  inviteBuyer(viewer: PartyId, buyerName: string, tier: number): Promise<PartyId>
  // Buyer submits a bid (price per unit; quantity defaults to the whole stake on offer).
  submitOffer(viewer: PartyId, pricePerUnit: number): Promise<void>
  // Investor locks cBTC toward the raise (creates on-ledger Commitment).
  commitCBTC(viewer: PartyId, amount: number): Promise<void>
  // Governance role (Board / Legal / Compliance) approves the close.
  approve(viewer: PartyId, role: string): Promise<void>
  // Open a document: the key service releases the decryption key and returns the plaintext ONLY
  // if the ledger confirms the viewer's grant covers the tier (else it throws "Sealed…"). An
  // authorized open also appends an AccessEvent — the audit trail logs every real decryption.
  openDocument(viewer: PartyId, docId: string): Promise<DocContent>
  // Ask the diligence copilot. It only receives the documents this viewer's grant authorizes,
  // so it cannot answer about a higher tier they can't see.
  ask(viewer: PartyId, question: string): Promise<AskResult>
  // Seller accepts a winning offer.
  acceptOffer(viewer: PartyId, offerId: string): Promise<void>
  // Executor settles payment-vs-ownership atomically. Returns when balances have flipped.
  settle(viewer: PartyId): Promise<void>
  // Stress the guarantee: attempt the close with one leg pulled. Mirrors the Daml proof
  // `testAtomicityHolds` — resolves with the rollback, leaving every balance untouched.
  attemptBrokenClose(viewer: PartyId): Promise<void>
  // Regulator attestation: did the close move exactly the recorded winning bid? Verifiable
  // without any tier-2 document access.
  attestClose(viewer: PartyId): Promise<CloseAttestation>
  // Deal Readiness Score: composite % from on-chain signals + Venice narration (founder only).
  getReadiness(): Promise<ReadinessResult>
}

export type PartyId = string
