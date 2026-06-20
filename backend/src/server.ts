// Atrium executor app — REAL Canton JSON Ledger API integration.
//
// Holds no secrets of its own: it resolves the demo parties on the ledger, serves each
// caller a view SCOPED BY THE LEDGER (selective disclosure is enforced by Canton, not by
// filtering here), drives RecordAccess / Accept as the acting party, and runs the atomic
// payment-vs-ownership close via the Atrium.Dvp settlement coordinator.
//
// Runs today against `daml sandbox --json-api-port 7575` (no Docker). Point LEDGER_API_URL
// + LEDGER_TOKEN at LocalNet for Stage 3; the Dvp leg swaps for the real Splice registry.

import express from 'express'
import {
  activeContracts, allocatePartyByHint, create, entityOf, exercise, listParties, resolveParty, type CreatedEvent,
} from './ledgerApi.js'

const app = express()
app.use(express.json())

// readable demo handles → resolved at request time to full party ids on the ledger
const SELLER = 'Halden'
const DEAL_ID = 'HALDEN-2026-A'

// Package id of the atrium DAR, learned from any contract's templateId (pkg:Module:Entity).
let PKG: string | null = null
const DVP_ENTITIES = new Set(['Holding', 'Allocation', 'AllocationFactory', 'SettlementCoordinator'])
function tid(entity: string): string {
  if (!PKG) throw new Error('package id not resolved yet')
  const mod = DVP_ENTITIES.has(entity) ? 'Dvp' : 'DealRoom'
  return `${PKG}:Atrium.${mod}:${entity}`
}
async function ensurePkg(): Promise<void> {
  if (PKG) return
  const seller = await resolveParty(SELLER)
  const cs = await activeContracts(seller)
  const any = cs[0]
  if (!any) throw new Error('No contracts on ledger — run `daml start` with init-script setupDemo')
  PKG = any.templateId.split(':')[0]
}

const num = (s: any) => Number(s)
const labelFor = (full: string) => full.split('-')[0].split('::')[0]

// --- party-scoped read: the same deal, projected per party by the ledger itself ---

app.get('/deals/:dealId/view', async (req, res) => {
  try {
    await ensurePkg()
    const prefix = String(req.query.party ?? '')
    if (!prefix) return res.status(400).json({ error: 'Pass ?party=Halden|Boranic|Meridian' })
    const party = await resolveParty(prefix)
    const isSeller = prefix === SELLER

    const mine = await activeContracts(party) // what THIS party may see — ledger-scoped
    const byEntity = (e: string) => mine.filter((c) => entityOf(c.templateId) === e)

    // Shared deal context (index of the room). Documents/Deal are seller-signatory, so the
    // executor reads the manifest as the seller; CONTENTS/hash access stay gated below.
    const seller = await resolveParty(SELLER)
    const sellerView = isSeller ? mine : await activeContracts(seller)
    const dealC = sellerView.find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const docManifest = sellerView.filter((c) => entityOf(c.templateId) === 'Document').map((c) => c.createArgument)

    // This party's granted tier (0 = no grant). Read straight from their AccessGrant on-ledger.
    const myGrant = byEntity('AccessGrant')[0]?.createArgument
    const maxTier = isSeller ? 99 : (myGrant ? num(myGrant.maxTier) : 0)

    const documents = docManifest.map((d: any) => ({
      docId: d.docId, title: d.title, tier: num(d.tier), contentHash: d.contentHash,
      accessible: isSeller || maxTier >= num(d.tier),
    }))

    // Sensitive projections — taken DIRECTLY from the party's own active contract set.
    const accessTrail = byEntity('AccessEvent').map((c) => {
      const a = c.createArgument
      const doc = docManifest.find((d: any) => d.docId === a.docId)
      return { buyer: a.buyer, buyerLabel: labelFor(a.buyer), docId: a.docId, docTitle: doc?.title ?? a.docId, accessedAt: String(a.accessedAt).slice(11, 16) }
    })
    const offers = byEntity('Offer').map((c) => {
      const o = c.createArgument
      return { offerId: c.contractId, buyer: o.buyer, buyerLabel: labelFor(o.buyer), pricePerUnit: num(o.pricePerUnit), quantity: num(o.quantity), submittedAt: String(o.submittedAt).slice(11, 16), status: 'open' as const }
    })
    const holdings = byEntity('Holding').map((c) => {
      const h = c.createArgument
      return { owner: h.owner, ownerLabel: labelFor(h.owner), instrument: h.instrument, amount: num(h.amount) }
    })

    res.json({
      deal: dealC ? { dealId: dealC.dealId, title: dealC.title, seller: dealC.seller, instrument: dealC.instrument, quantity: num(dealC.quantity) } : null,
      documents, accessTrail, offers, holdings, settled: false,
    })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- buyer opens a document → RecordAccess (appends an immutable AccessEvent) ---
app.post('/deals/:dealId/access', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, docId } = req.body ?? {}
    if (!prefix || !docId) return res.status(400).json({ error: 'party and docId required' })
    const party = await resolveParty(prefix)
    const mine = await activeContracts(party)
    const grant = mine.find((c) => entityOf(c.templateId) === 'AccessGrant')
    if (!grant) return res.status(403).json({ error: 'No access grant for this party' })
    await exercise(party, grant.templateId, grant.contractId, 'RecordAccess', { docId })
    res.json({ recorded: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- seller accepts the winning offer ---
app.post('/deals/:dealId/accept', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, offerId } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the seller accepts offers' })
    const seller = await resolveParty(SELLER)
    const offer = (await activeContracts(seller)).find((c) => c.contractId === offerId)
    if (!offer) return res.status(404).json({ error: 'Offer not visible / not found' })
    await exercise(seller, offer.templateId, offer.contractId, 'Accept', {})
    res.json({ accepted: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- the atomic close: both legs settle in ONE transaction, or not at all ---
// Drives Atrium.Dvp on the live ledger (mirrors testAtomicDvP). `break: true` pulls one leg
// first to demonstrate all-or-nothing (mirrors testAtomicityHolds) — nothing moves.
app.post('/deals/:dealId/settle', async (req, res) => {
  try {
    await ensurePkg()
    const breakLeg = Boolean(req.body?.break)
    const ref = `${DEAL_ID}-${Date.now()}`
    const registry = await ensureParty('Registry')
    const operator = await ensureParty('AtriumApp')
    const seller = await resolveParty(SELLER)
    const buyer = await resolveParty('Meridian')

    const cashH = await create(registry, tid('Holding'), { admin: registry, owner: buyer, instrument: 'USD-CASH', amount: '4200000.0' })
    const eqH = await create(registry, tid('Holding'), { admin: registry, owner: seller, instrument: 'HALDEN-EQUITY', amount: '120000.0' })
    const factory = await create(registry, tid('AllocationFactory'), { admin: registry, users: [buyer, seller] })
    const settleBefore = new Date(Date.now() + 24 * 3600_000).toISOString()
    const coord = await create(operator, tid('SettlementCoordinator'), { executor: operator, settlementRef: ref, settleBefore })

    const cashAlloc = ex1(await exercise(buyer, factory.templateId, factory.contractId, 'Allocate', { holdingCid: cashH.contractId, settlementRef: ref, legId: 'cash', sender: buyer, receiver: seller, executor: operator }))
    const eqAlloc = ex1(await exercise(seller, factory.templateId, factory.contractId, 'Allocate', { holdingCid: eqH.contractId, settlementRef: ref, legId: 'ownership', sender: seller, receiver: buyer, executor: operator }))

    if (breakLeg) {
      await exercise(seller, eqAlloc.templateId, eqAlloc.contractId, 'Allocation_Withdraw', {}) // pull the ownership leg
      try {
        await exercise(operator, coord.templateId, coord.contractId, 'Settle', { cashLeg: cashAlloc.contractId, ownershipLeg: eqAlloc.contractId })
        return res.status(500).json({ error: 'expected the broken close to fail' })
      } catch {
        return res.json({ settled: false, atomic: true, rolledBack: true, note: 'One leg was pulled → Settle failed → neither side moved.' })
      }
    }

    await exercise(operator, coord.templateId, coord.contractId, 'Settle', { cashLeg: cashAlloc.contractId, ownershipLeg: eqAlloc.contractId })
    res.json({ settled: true, atomic: true, settlementRef: ref, cashToSeller: 4200000, equityToBuyer: 120000 })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// returns the single created/result contract from an exercise transaction
function ex1(txResult: any): CreatedEvent {
  const ev = txResult?.transaction?.events?.find((e: any) => e.CreatedEvent)?.CreatedEvent
  if (!ev) throw new Error('exercise returned no created contract')
  return ev as CreatedEvent
}

async function ensureParty(prefix: string): Promise<string> {
  const all = await listParties()
  const hit = all.find((p) => p.startsWith(prefix + '-') || p.startsWith(prefix + '::') || p === prefix)
  if (hit) return hit
  return allocatePartyByHint(prefix)
}

// Lenses are discovered from the ledger: the seller + every buyer that holds an AccessGrant
// on this deal. Invite a new buyer (below) and they show up here — fully dynamic.
app.get('/viewers', async (_req, res) => {
  try {
    await ensurePkg()
    const seller = await resolveParty(SELLER)
    const grants = (await activeContracts(seller)).filter((c) => entityOf(c.templateId) === 'AccessGrant')
    const seen = new Set<string>()
    const buyers = grants
      .map((c) => ({ name: labelFor(c.createArgument.buyer), tier: num(c.createArgument.maxTier) }))
      .filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)))
      .map((b) => ({ party: b.name, label: `${b.name} (Buyer · ${b.tier >= 2 ? 'tier 1+2' : 'tier 1'})`, role: 'buyer' as const }))
    res.json([{ party: SELLER, label: 'Halden (Seller)', role: 'seller' }, ...buyers])
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Seller onboards a buyer: ensure the buyer party exists on the ledger, then issue an
// AccessGrant at the chosen tier (signed by the seller, observed by the buyer).
app.post('/deals/:dealId/invite', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, buyerName, tier } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the seller can invite buyers' })
    const name = String(buyerName ?? '').trim()
    if (!name) return res.status(400).json({ error: 'buyerName required' })
    const seller = await resolveParty(SELLER)
    const buyer = await ensureParty(name)
    const maxTier = Number(tier) >= 2 ? 2 : 1
    await create(seller, tid('AccessGrant'), { seller, buyer, dealId: DEAL_ID, maxTier, grantedAt: new Date().toISOString() })
    res.json({ invited: true, party: labelFor(buyer), tier: maxTier })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Buyer submits a bid for the whole stake on offer (signed by the buyer, observed by the seller).
app.post('/deals/:dealId/offer', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, pricePerUnit } = req.body ?? {}
    if (!prefix) return res.status(400).json({ error: 'party required' })
    const price = Number(pricePerUnit)
    if (!(price > 0)) return res.status(400).json({ error: 'pricePerUnit must be > 0' })
    const buyer = await resolveParty(prefix)
    const seller = await resolveParty(SELLER)
    const dealC = (await activeContracts(seller)).find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const quantity = dealC ? String(dealC.quantity) : '120000.0'
    await create(buyer, tid('Offer'), { buyer, seller, dealId: DEAL_ID, pricePerUnit: price.toFixed(4), quantity, submittedAt: new Date().toISOString() })
    res.json({ submitted: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

app.get('/health', async (_req, res) => {
  try { const parties = await listParties(); res.json({ ok: true, ledgerApi: process.env.LEDGER_API_URL ?? 'http://localhost:7575', parties: parties.length }) }
  catch (e) { res.status(503).json({ ok: false, error: (e as Error).message }) }
})

const PORT = Number(process.env.PORT ?? 8080)
app.listen(PORT, () => console.log(`atrium executor (LIVE) on :${PORT} — ledger ${process.env.LEDGER_API_URL ?? 'http://localhost:7575'}`))
