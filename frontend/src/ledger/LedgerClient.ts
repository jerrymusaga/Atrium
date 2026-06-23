import type { AskResult, CloseAttestation, DealView, DocContent, Viewer } from '../types'

// The seam between UI and ledger. The mock implements this entirely in-browser.
// In Stage 3, implement this same interface against the Canton JSON Ledger API
// (queries scoped per party + the executor app driving the AllocationV1 close).
export interface LedgerClient {
  // The lenses available right now. Async + re-fetchable because the seller can onboard
  // new buyers at runtime (each becomes a real ledger party).
  listViewers(): Promise<Viewer[]>
  // Returns the deal AS SEEN BY `viewer` — documents redacted, trail/offers scoped.
  getDealView(viewer: PartyId): Promise<DealView>
  // Seller onboards a buyer to the deal: ensures the buyer party exists on the ledger and
  // issues an AccessGrant at the given tier. Returns the new party id.
  inviteBuyer(viewer: PartyId, buyerName: string, tier: number): Promise<PartyId>
  // Buyer submits a bid (price per unit; quantity defaults to the whole stake on offer).
  submitOffer(viewer: PartyId, pricePerUnit: number): Promise<void>
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
}

export type PartyId = string
