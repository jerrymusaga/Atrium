import type { DealView, Viewer } from '../types'

// The seam between UI and ledger. The mock implements this entirely in-browser.
// In Stage 3, implement this same interface against the Canton JSON Ledger API
// (queries scoped per party + the executor app driving the AllocationV1 close).
export interface LedgerClient {
  viewers(): Viewer[]
  // Returns the deal AS SEEN BY `viewer` — documents redacted, trail/offers scoped.
  getDealView(viewer: PartyId): Promise<DealView>
  // Buyer opens a document they're entitled to: appends an AccessEvent (audit trail).
  recordAccess(viewer: PartyId, docId: string): Promise<void>
  // Seller accepts a winning offer.
  acceptOffer(viewer: PartyId, offerId: string): Promise<void>
  // Executor settles payment-vs-ownership atomically. Returns when balances have flipped.
  settle(viewer: PartyId): Promise<void>
}

export type PartyId = string
