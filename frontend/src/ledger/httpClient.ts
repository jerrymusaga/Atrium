import type { LedgerClient, PartyId } from './LedgerClient'
import type { CloseAttestation, DealView, Viewer } from '../types'

// Live client — talks to the Atrium executor (backend/), which in turn drives the real
// Canton JSON Ledger API. Selective disclosure, RecordAccess, Accept and the atomic close
// are all enforced on the ledger. Enable with `VITE_LIVE=1` (see frontend/README or Makefile).
//
// Note: the live demo runs the three on-ledger parties (Halden + 2 buyers). The Regulator
// lens is a demo persona (no party is onboarded for it in setupDemo), so regulator
// attestation stays available in the mock client.

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
const DEAL = 'HALDEN-2026-A'

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as any).error ?? `${path} → ${res.status}`)
  return body as T
}
const post = (path: string, data: unknown) =>
  j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

let viewerCache: Viewer[] = [
  { party: 'Halden', label: 'Halden (Seller)', role: 'seller' },
  { party: 'Boranic', label: 'Boranic (Buyer · tier 1)', role: 'buyer' },
  { party: 'Meridian', label: 'Meridian (Buyer · tier 1+2)', role: 'buyer' },
]

export const httpClient: LedgerClient = {
  viewers: () => viewerCache,

  async getDealView(viewer: PartyId): Promise<DealView> {
    return j<DealView>(`/deals/${DEAL}/view?party=${encodeURIComponent(viewer)}`)
  },
  async recordAccess(viewer: PartyId, docId: string) {
    await post(`/deals/${DEAL}/access`, { party: viewer, docId })
  },
  async acceptOffer(viewer: PartyId, offerId: string) {
    await post(`/deals/${DEAL}/accept`, { party: viewer, offerId })
  },
  async settle(viewer: PartyId) {
    await post(`/deals/${DEAL}/settle`, { party: viewer })
  },
  async attemptBrokenClose(viewer: PartyId) {
    const r = await post(`/deals/${DEAL}/settle`, { party: viewer, break: true }) as any
    throw new Error(r.note ?? 'One leg was pulled mid-close → settlement reverted → neither side moved.')
  },
  async attestClose(): Promise<CloseAttestation> {
    return { settled: false, winningBuyerLabel: null, bidPricePerUnit: 0, bidQuantity: 0, expectedCash: 0, settledCash: 0, matched: false }
  },
}

// Best-effort: replace the static viewer list with whatever the executor reports.
void fetch(`${BASE}/viewers`).then((r) => r.ok && r.json()).then((v) => { if (Array.isArray(v) && v.length) viewerCache = v }).catch(() => {})
