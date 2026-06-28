import type { LedgerClient, PartyId } from './LedgerClient'
import type { AskResult, CloseAttestation, DealSetup, DealView, DocContent, IntegrityReport, ReadinessResult, Viewer } from '../types'

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

export const httpClient: LedgerClient = {
  async listViewers(): Promise<Viewer[]> {
    return j<Viewer[]>(`/viewers`)
  },

  async addDocument(viewer: PartyId, draft: { title: string; tier: number; content: string }) {
    await post(`/deals/${DEAL}/documents`, { party: viewer, ...draft })
  },
  async inviteBuyer(viewer: PartyId, buyerName: string, tier: number): Promise<PartyId> {
    const r = await post(`/deals/${DEAL}/invite`, { party: viewer, buyerName, tier }) as any
    return r.party as PartyId
  },
  async submitOffer(viewer: PartyId, pricePerUnit: number) {
    await post(`/deals/${DEAL}/offer`, { party: viewer, pricePerUnit })
  },
  async commitCBTC(viewer: PartyId, amount: number) {
    await post(`/deals/${DEAL}/commit`, { party: viewer, amount })
  },
  async approve(viewer: PartyId, role: string) {
    await post(`/deals/${DEAL}/approve`, { party: viewer, role })
  },

  async getDealView(viewer: PartyId): Promise<DealView> {
    return j<DealView>(`/deals/${DEAL}/view?party=${encodeURIComponent(viewer)}`)
  },
  async createDeal(viewer: PartyId, setup: DealSetup) {
    await post(`/deals`, { party: viewer, ...setup })
  },
  async loadDemo() {
    await post(`/deals/${DEAL}/seed`, {})
  },
  async openDocument(viewer: PartyId, docId: string): Promise<DocContent> {
    return j<DocContent>(`/deals/${DEAL}/documents/${docId}/content?party=${encodeURIComponent(viewer)}`)
  },
  async ask(viewer: PartyId, question: string): Promise<AskResult> {
    return post(`/deals/${DEAL}/ask`, { party: viewer, question }) as Promise<AskResult>
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
  async getReadiness(): Promise<ReadinessResult> {
    return j<ReadinessResult>(`/deals/${DEAL}/readiness`)
  },
  async verifyIntegrity(viewer: PartyId): Promise<IntegrityReport> {
    return j<IntegrityReport>(`/deals/${DEAL}/verify?party=${encodeURIComponent(viewer)}`)
  },
  async tamperVault(viewer: PartyId, docId: string) {
    await post(`/deals/${DEAL}/tamper`, { party: viewer, docId })
  },
}
