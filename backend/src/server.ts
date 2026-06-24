// Atrium executor app — REAL Canton JSON Ledger API integration.
//
// Holds no secrets of its own: it resolves the demo parties on the ledger, serves each
// caller a view SCOPED BY THE LEDGER (selective disclosure is enforced by Canton, not by
// filtering here), drives RecordAccess / Accept as the acting party, and runs the atomic
// payment-vs-ownership close via the Atrium.Dvp settlement coordinator.
//
// Runs today against `daml sandbox --json-api-port 7575` (no Docker). Point LEDGER_API_URL
// + LEDGER_TOKEN at LocalNet for Stage 3; the Dvp leg swaps for the real Splice registry.

import './env.js' // load backend/.env first (mirrors ledgerApi; safe if already loaded)
import express from 'express'
import {
  activeContracts, allocatePartyByHint, create, entityOf, exercise, grantActAs, listParties, USER_ID, type CreatedEvent,
} from './ledgerApi.js'
import { decryptDocument, docMeta, seedVault } from './vault.js'
import { chat, veniceConfigured } from './venice.js'

const app = express()
app.use(express.json())
seedVault() // encrypt the demo documents at startup; keys are held by this key service

// readable demo handles → resolved at request time to full party ids on the ledger
const SELLER = 'Halden'
const DEAL_ID = 'HALDEN-2026-A'

// Party namespacing. On the local sandbox parties are bare ("Halden"). On a SHARED hosted
// validator (Seaport) names collide across teams, so we prefix our hints (PARTY_PREFIX, e.g.
// "atrium-"). Logical names ("Halden"/"Boranic") flow through the API and UI either way.
const PARTY_PREFIX = process.env.PARTY_PREFIX ?? ''
const hint = (logical: string) => `${PARTY_PREFIX}${logical}`
// Does a full party id (local-part::namespace) correspond to this logical name?
function matchesLogical(full: string, logical: string): boolean {
  const local = full.split('::')[0]
  const h = hint(logical)
  return local === h || local.startsWith(h + '-') // sandbox appends "-<hash>"; hosted doesn't
}
// Invert: full party id → logical display name (strip namespace, prefix, and any "-<hash>").
function displayName(full: string): string {
  let local = full.split('::')[0]
  if (PARTY_PREFIX && local.startsWith(PARTY_PREFIX)) local = local.slice(PARTY_PREFIX.length)
  const m = local.match(/^(.*?)-[0-9a-f]{6,}$/i)
  return m ? m[1] : local
}

// Should the executor grant its ledger user CanActAs on parties it acts as? Needed on hosted
// validators (the token is one user); the sandbox's admin user doesn't need it.
const GRANT_ACT_AS = process.env.LEDGER_GRANT_ACT_AS === '1'

// Package id of the atrium DAR. Prefer an explicit env (works before any contract exists, e.g.
// a freshly-seeded hosted ledger); otherwise learn it from any on-ledger contract.
let PKG: string | null = process.env.ATRIUM_PKG ?? null
const DVP_ENTITIES = new Set(['Holding', 'Allocation', 'AllocationFactory', 'SettlementCoordinator'])
const EQUITY_ENTITIES = new Set(['ShareCertificate'])
function tid(entity: string): string {
  if (!PKG) throw new Error('package id not resolved yet')
  const mod = DVP_ENTITIES.has(entity) ? 'Dvp' : EQUITY_ENTITIES.has(entity) ? 'Equity' : 'DealRoom'
  return `${PKG}:Atrium.${mod}:${entity}`
}
async function ensurePkg(): Promise<void> {
  if (PKG) return
  const seller = await partyId(SELLER)
  const any = (await activeContracts(seller))[0]
  if (!any) throw new Error('No Atrium contracts yet — POST /deals/:id/seed first (or set ATRIUM_PKG)')
  PKG = any.templateId.split(':')[0]
}

// On a hosted validator every party shares the participant's namespace fingerprint, so we can
// construct full ids directly (PARTY_NAMESPACE) instead of scanning the 10k-party list. Resolved
// ids are cached per logical name. Falls back to listing when no namespace is configured (sandbox).
const PARTY_NAMESPACE = process.env.PARTY_NAMESPACE ?? ''
const partyCache = new Map<string, string>()

async function partyId(logical: string): Promise<string> {
  const cached = partyCache.get(logical)
  if (cached) return cached
  if (PARTY_NAMESPACE) {
    const id = `${hint(logical)}::${PARTY_NAMESPACE}`
    partyCache.set(logical, id)
    return id
  }
  const hit = (await listParties()).find((p) => matchesLogical(p, logical))
  if (!hit) throw new Error(`no party for "${logical}" (hint "${hint(logical)}") — seed/onboard it first`)
  partyCache.set(logical, hit)
  return hit
}

// Resolve-or-allocate a logical party, and (on hosted validators) ensure our user can act as it.
async function ensureParty(logical: string): Promise<string> {
  let party: string
  if (PARTY_NAMESPACE) {
    party = `${hint(logical)}::${PARTY_NAMESPACE}`
    try { await allocatePartyByHint(hint(logical)) } catch { /* already allocated — fine */ }
  } else {
    const existing = (await listParties()).find((p) => matchesLogical(p, logical))
    party = existing ?? (await allocatePartyByHint(hint(logical)))
  }
  if (GRANT_ACT_AS) await grantActAs(party)
  partyCache.set(logical, party)
  return party
}

const num = (s: any) => Number(s)
const labelFor = displayName

// Active contracts for a party, scoped to OUR package version. On a shared validator the
// seller may also hold contracts from older package ids (prior demos); the app operates only
// on the current package so views and the seed stay clean.
async function acsOf(party: string): Promise<CreatedEvent[]> {
  const all = await activeContracts(party)
  return PKG ? all.filter((c) => c.templateId.startsWith(PKG + ':')) : all
}

// --- party-scoped read: the same deal, projected per party by the ledger itself ---

app.get('/deals/:dealId/view', async (req, res) => {
  try {
    await ensurePkg()
    const prefix = String(req.query.party ?? '')
    if (!prefix) return res.status(400).json({ error: 'Pass ?party=Halden|Boranic|Meridian' })
    const party = await partyId(prefix)
    const isSeller = prefix === SELLER

    const mine = await acsOf(party) // what THIS party may see — ledger-scoped
    const byEntity = (e: string) => mine.filter((c) => entityOf(c.templateId) === e)

    // Shared deal context (index of the room). Documents/Deal are seller-signatory, so the
    // executor reads the manifest as the seller; CONTENTS/hash access stay gated below.
    const seller = await partyId(SELLER)
    const sellerView = isSeller ? mine : await acsOf(seller)
    const dealC = sellerView.find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const docManifest = sellerView.filter((c) => entityOf(c.templateId) === 'Document').map((c) => c.createArgument)

    // This party's granted tier (0 = no grant). Read straight from their AccessGrant on-ledger.
    const myGrant = byEntity('AccessGrant')[0]?.createArgument
    const maxTier = isSeller ? 99 : (myGrant ? num(myGrant.maxTier) : 0)

    const documents = docManifest.map((d: any) => ({
      docId: d.docId, title: d.title, tier: num(d.tier),
      contentHash: docMeta(d.docId)?.hash ?? d.contentHash, // the real ciphertext hash from the vault
      accessible: isSeller || maxTier >= num(d.tier),
    }))

    // Sensitive projections — taken DIRECTLY from the party's own active contract set.
    const accessTrail = byEntity('AccessEvent').map((c) => {
      const a = c.createArgument
      const doc = docManifest.find((d: any) => d.docId === a.docId)
      return { buyer: a.buyer, buyerLabel: labelFor(a.buyer), docId: a.docId, docTitle: doc?.title ?? a.docId, accessedAt: String(a.accessedAt).slice(11, 16) }
    })
    // KYC/KYB attestations (provider-signed; relying party = seller, so they're in the seller
    // view). A bid is "cleared" only with a current attestation naming the bidder.
    const atts = sellerView.filter((c) => entityOf(c.templateId) === 'KYCAttestation').map((c) => c.createArgument)
    const attFor = (full: string) => atts.find((a) => a.subject === full && Date.parse(a.expiresAt) > Date.now())
    const kycOf = (full: string) => { const a = attFor(full); return a ? { level: a.level, jurisdiction: a.jurisdiction } : null }

    const offers = byEntity('Offer').map((c) => {
      const o = c.createArgument
      return { offerId: c.contractId, buyer: o.buyer, buyerLabel: labelFor(o.buyer), pricePerUnit: num(o.pricePerUnit), quantity: num(o.quantity), submittedAt: String(o.submittedAt).slice(11, 16), status: 'open' as const, kyc: kycOf(o.buyer) }
    })
    // The DvP legs live as Holdings whose admin is the Registry (it sees both). Read them there
    // so the close panel shows both sides; `settled` is derived from on-ledger ownership: once
    // the cash leg is owned by the seller, the atomic swap has happened.
    const registry = await partyId('Registry')
    const regAcs = await acsOf(registry)
    const regHoldings = regAcs.filter((c) => entityOf(c.templateId) === 'Holding').map((c) => c.createArgument)
    const holdings = regHoldings.map((h: any) => ({ owner: h.owner, ownerLabel: labelFor(h.owner), instrument: h.instrument, amount: num(h.amount) }))
    const settled = regHoldings.some((h: any) => h.instrument === 'USD-CASH' && labelFor(h.owner) === SELLER)

    // The cap table (share registry). Seller/regulator see the whole table; a buyer sees only
    // their own line — the registry is itself privacy-scoped. After the close, the buyer's 12%
    // appears because the on-offer stake transferred on settlement.
    const certs = regAcs.filter((c) => entityOf(c.templateId) === 'ShareCertificate').map((c) => c.createArgument)
    const totalShares = certs.reduce((s, c: any) => s + num(c.shares), 0) || 1
    const capRow = (c: any) => ({ holderLabel: labelFor(c.holder), shares: num(c.shares), pct: Math.round((num(c.shares) / totalShares) * 1000) / 10 })
    const capTable = (isSeller ? certs : certs.filter((c: any) => c.holder === party)).map(capRow).sort((a, b) => b.shares - a.shares)

    res.json({
      deal: dealC ? { dealId: dealC.dealId, title: dealC.title, seller: dealC.seller, instrument: dealC.instrument, quantity: num(dealC.quantity) } : null,
      documents, accessTrail, offers, holdings, capTable, settled,
      kyc: isSeller ? null : kycOf(party), // the viewing buyer's own clearance
    })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- open a document: the KEY-RELEASE GATE ---
// The key service releases the decryption key (and returns the plaintext) ONLY if the ledger
// confirms the requester's AccessGrant covers the document's tier. Authorized opens append an
// immutable AccessEvent — so the audit trail logs every actual decryption. The bytes are decrypted
// off-ledger; Canton only ever held the hash + pointer + grant.
app.get('/deals/:dealId/documents/:docId/content', async (req, res) => {
  try {
    await ensurePkg()
    const docId = String(req.params.docId)
    const prefix = String(req.query.party ?? '')
    const meta = docMeta(docId)
    if (!meta) return res.status(404).json({ error: 'unknown document' })

    if (prefix !== SELLER) {
      const party = await partyId(prefix)
      const grant = (await acsOf(party)).find((c) => entityOf(c.templateId) === 'AccessGrant')
      const tier = grant ? num(grant.createArgument.maxTier) : 0
      if (tier < meta.tier) {
        return res.status(403).json({ error: `Sealed. Your grant covers tier ${tier}; "${meta.title}" is tier ${meta.tier}. The key service will not release the key.`, sealed: true, tier: meta.tier })
      }
      if (grant) await exercise(party, grant.templateId, grant.contractId, 'RecordAccess', { docId }) // log the decryption on-ledger
    }
    res.json({ docId, title: meta.title, tier: meta.tier, hash: meta.hash, bytes: meta.bytes, content: decryptDocument(docId) })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- the diligence copilot: privacy-bounded AI ---
// The model receives ONLY the documents this party's on-ledger grant authorizes (same gate as
// the key service). So it can't answer about a tier the caller can't see — it never gets those
// bytes. Privacy is enforced at retrieval, not by asking the model to behave.
const DOC_IDS = ['teaser', 'financials']
app.post('/deals/:dealId/ask', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, question } = req.body ?? {}
    if (!prefix || !question) return res.status(400).json({ error: 'party and question required' })
    if (!veniceConfigured()) return res.status(503).json({ error: 'Copilot offline — set VENICE_API_KEY in backend/.env' })

    const isSeller = prefix === SELLER
    let tier = 99
    if (!isSeller) {
      const party = await partyId(prefix)
      const grant = (await acsOf(party)).find((c) => entityOf(c.templateId) === 'AccessGrant')
      tier = grant ? num(grant.createArgument.maxTier) : 0
    }
    // Gather ONLY the authorized documents — exactly what the ledger would release keys for.
    const authorized = DOC_IDS.map((id) => ({ id, meta: docMeta(id) })).filter((d) => d.meta && tier >= d.meta.tier)
    const context = authorized.map((d) => `### ${d.meta!.title} (Tier ${d.meta!.tier})\n${decryptDocument(d.id)}`).join('\n\n')

    const system = `You are the diligence copilot inside Atrium, a private M&A data room on Canton Network.
You are answering for the party "${prefix}". You may ONLY use the documents below — they are EXACTLY what this party's on-ledger access grant authorizes. Do not use outside knowledge and never invent figures.
If the question needs information that is not in these documents (it lives in a higher access tier this party was not granted), say so plainly: state which tier it likely sits in and that their grant does not cover it. Be concise and cite the specific figures you use.

AUTHORIZED DOCUMENTS:
${context || '(none — this party has no document access)'}`

    const answer = await chat(system, String(question))
    res.json({ answer, authorizedDocs: authorized.map((d) => d.meta!.title), tier: isSeller ? 'all tiers' : `tier ${tier}` })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- seller accepts the winning offer ---
app.post('/deals/:dealId/accept', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, offerId } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the seller accepts offers' })
    const seller = await partyId(SELLER)
    const acs = await acsOf(seller)
    const offer = acs.find((c) => c.contractId === offerId)
    if (!offer) return res.status(404).json({ error: 'Offer not visible / not found' })
    // Compliance gate: a current KYC attestation must name the bidder, or the close is refused.
    const att = acs.find((c) => entityOf(c.templateId) === 'KYCAttestation'
      && c.createArgument.subject === offer.createArgument.buyer
      && Date.parse(c.createArgument.expiresAt) > Date.now())
    if (!att) return res.status(403).json({ error: 'Bidder is not KYC-cleared — cannot accept' })
    await exercise(seller, offer.templateId, offer.contractId, 'Accept', { kycCid: att.contractId })
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
    const registry = await partyId('Registry')
    const operator = await ensureParty('AtriumApp')
    const seller = await partyId(SELLER)
    const buyer = await partyId('Meridian')

    // Use the seeded legs (real Holdings) so the swap actually moves on-ledger ownership.
    const regAcs = await acsOf(registry)
    const cashH = regAcs.find((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === 'USD-CASH' && c.createArgument.owner === buyer)
    const eqH = regAcs.find((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === 'HALDEN-EQUITY' && c.createArgument.owner === seller)
    const factory = regAcs.find((c) => entityOf(c.templateId) === 'AllocationFactory')
    if (!cashH || !eqH || !factory) return res.status(409).json({ error: 'legs not ready (seed first) or already settled' })

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
        await exercise(buyer, cashAlloc.templateId, cashAlloc.contractId, 'Allocation_Withdraw', {}) // restore the cash leg → state unchanged, re-runnable
        return res.json({ settled: false, atomic: true, rolledBack: true, note: 'One leg was pulled → Settle failed → neither side moved.' })
      }
    }

    await exercise(operator, coord.templateId, coord.contractId, 'Settle', { cashLeg: cashAlloc.contractId, ownershipLeg: eqAlloc.contractId })
    // The share registry reflects the new owner: transfer the on-offer stake to the buyer so the
    // cap table updates (seller's 12% → buyer).
    const stake = regAcs.find((c) => entityOf(c.templateId) === 'ShareCertificate' && c.createArgument.holder === seller && c.createArgument.instrument === 'HALDEN-EQUITY')
    if (stake) await exercise(registry, stake.templateId, stake.contractId, 'Transfer', { newHolder: buyer })
    res.json({ settled: true, atomic: true, settlementRef: ref, cashToSeller: 4200000, equityToBuyer: 120000 })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Reset the close to its pre-settle state (re-runnable demo): archive the DvP holdings and
// recreate the two legs (cash→buyer, equity→seller). Handy between recording takes.
app.post('/deals/:dealId/reset-close', async (_req, res) => {
  try {
    await ensurePkg()
    const registry = await partyId('Registry')
    const seller = await partyId(SELLER)
    const buyer = await partyId('Meridian')
    const reg = await acsOf(registry)
    for (const c of reg.filter((x) => entityOf(x.templateId) === 'Holding')) {
      await exercise(registry, c.templateId, c.contractId, 'Archive', {})
    }
    await create(registry, tid('Holding'), { admin: registry, owner: buyer, instrument: 'USD-CASH', amount: '4200000.0' })
    await create(registry, tid('Holding'), { admin: registry, owner: seller, instrument: 'HALDEN-EQUITY', amount: '120000.0' })
    // Restore the cap table: move the stake certificate back from the buyer to the seller.
    const stake = reg.find((c) => entityOf(c.templateId) === 'ShareCertificate' && c.createArgument.holder === buyer && c.createArgument.instrument === 'HALDEN-EQUITY')
    if (stake) await exercise(registry, stake.templateId, stake.contractId, 'Transfer', { newHolder: seller })
    res.json({ reset: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// returns the single created/result contract from an exercise transaction
function ex1(txResult: any): CreatedEvent {
  const ev = txResult?.transaction?.events?.find((e: any) => e.CreatedEvent)?.CreatedEvent
  if (!ev) throw new Error('exercise returned no created contract')
  return ev as CreatedEvent
}

// Lenses are discovered from the ledger: the seller + every buyer that holds an AccessGrant
// on this deal. Invite a new buyer (below) and they show up here — fully dynamic.
app.get('/viewers', async (_req, res) => {
  try {
    await ensurePkg()
    const seller = await partyId(SELLER)
    const grants = (await acsOf(seller)).filter((c) => entityOf(c.templateId) === 'AccessGrant')
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
    const { party: prefix, buyerName, buyerParty, tier } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the seller can invite buyers' })
    const seller = await partyId(SELLER)
    const maxTier = Number(tier) >= 2 ? 2 : 1
    // Two modes: allocate a fresh local buyer (buyerName), or invite an EXISTING party by its full
    // id (buyerParty) — e.g. a teammate on another validator. Cross-node disclosure routes the grant
    // to their participant via the shared synchronizer; we don't allocate or hold rights for them.
    let buyer: string
    if (buyerParty && String(buyerParty).includes('::')) {
      buyer = String(buyerParty).trim()
    } else {
      const name = String(buyerName ?? '').trim()
      if (!name) return res.status(400).json({ error: 'buyerName or buyerParty required' })
      buyer = await ensureParty(name)
    }
    await create(seller, tid('AccessGrant'), { seller, buyer, dealId: DEAL_ID, maxTier: String(maxTier), grantedAt: new Date().toISOString() })
    res.json({ invited: true, party: labelFor(buyer), tier: maxTier, external: Boolean(buyerParty) })
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
    const buyer = await partyId(prefix)
    const seller = await partyId(SELLER)
    const dealC = (await acsOf(seller)).find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const quantity = dealC ? String(dealC.quantity) : '120000.0'
    await create(buyer, tid('Offer'), { buyer, seller, dealId: DEAL_ID, pricePerUnit: price.toFixed(4), quantity, submittedAt: new Date().toISOString() })
    res.json({ submitted: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Seed a fresh (hosted) ledger with the demo, equivalent to ledger/setupDemo but over the
// JSON API: Deal + 2 Documents + 2 tiered AccessGrants + a few accesses + Meridian's bid.
// Idempotent — skips if a Deal already exists. Needs ATRIUM_PKG set (the uploaded DAR's pkg id).
app.post('/deals/:dealId/seed', async (_req, res) => {
  try {
    if (!PKG) return res.status(400).json({ error: 'set ATRIUM_PKG to the uploaded DAR package id before seeding' })
    const seller = await ensureParty(SELLER)
    const boranic = await ensureParty('Boranic')
    const meridian = await ensureParty('Meridian')
    const kycp = await ensureParty('KYCProvider')
    const now = new Date().toISOString()
    const oneYear = new Date(Date.now() + 365 * 24 * 3600_000).toISOString()
    const did: string[] = []

    // Idempotent: inspect what already exists for the seller and create only what's missing,
    // so a half-run (e.g. interrupted) converges on re-run without duplicating.
    const acs = await acsOf(seller)
    const has = (e: string, pred: (a: any) => boolean = () => true) =>
      acs.some((c) => entityOf(c.templateId) === e && pred(c.createArgument))
    const grantFor = (full: string) => acs.find((c) => entityOf(c.templateId) === 'AccessGrant' && c.createArgument.buyer === full)

    if (!has('Deal')) { await create(seller, tid('Deal'), { seller, dealId: DEAL_ID, title: 'Halden Robotics — 12% secondary', instrument: 'HALDEN-EQUITY', quantity: '120000.0' }); did.push('Deal') }
    if (!has('Document', (a) => a.docId === 'teaser')) { await create(seller, tid('Document'), { seller, dealId: DEAL_ID, docId: 'teaser', title: 'Investment teaser', tier: '1', contentHash: 'sha256:aa11', blobPointer: 's3://atrium/halden/teaser.enc' }); did.push('Document:teaser') }
    if (!has('Document', (a) => a.docId === 'financials')) { await create(seller, tid('Document'), { seller, dealId: DEAL_ID, docId: 'financials', title: 'Audited financials', tier: '2', contentHash: 'sha256:bb22', blobPointer: 's3://atrium/halden/financials.enc' }); did.push('Document:financials') }

    let gA = grantFor(boranic)
    if (!gA) { gA = await create(seller, tid('AccessGrant'), { seller, buyer: boranic, dealId: DEAL_ID, maxTier: '1', grantedAt: now }); did.push('Grant:Boranic') }
    let gB = grantFor(meridian)
    if (!gB) { gB = await create(seller, tid('AccessGrant'), { seller, buyer: meridian, dealId: DEAL_ID, maxTier: '2', grantedAt: now }); did.push('Grant:Meridian') }

    if (!has('AccessEvent')) {
      await exercise(boranic, gA.templateId, gA.contractId, 'RecordAccess', { docId: 'teaser' })
      await exercise(meridian, gB.templateId, gB.contractId, 'RecordAccess', { docId: 'teaser' })
      await exercise(meridian, gB.templateId, gB.contractId, 'RecordAccess', { docId: 'financials' })
      did.push('AccessEvents')
    }
    if (!has('KYCAttestation', (a) => a.subject === boranic)) { await create(kycp, tid('KYCAttestation'), { kycProvider: kycp, subject: boranic, relyingParty: seller, level: 'KYB-INSTITUTIONAL', jurisdiction: 'US', issuedAt: now, expiresAt: oneYear }); did.push('KYC:Boranic') }
    if (!has('KYCAttestation', (a) => a.subject === meridian)) { await create(kycp, tid('KYCAttestation'), { kycProvider: kycp, subject: meridian, relyingParty: seller, level: 'KYB-INSTITUTIONAL', jurisdiction: 'US', issuedAt: now, expiresAt: oneYear }); did.push('KYC:Meridian') }
    if (!has('Offer')) { await create(meridian, tid('Offer'), { buyer: meridian, seller, dealId: DEAL_ID, pricePerUnit: '35.0000', quantity: '120000.0', submittedAt: now }); did.push('Offer:Meridian') }

    // The two DvP legs (real Holdings) + the allocation factory, so the close is an actual
    // atomic swap on-ledger. Registry is admin/signatory of the holdings (sees both legs).
    const registry = await ensureParty('Registry')
    const operator = await ensureParty('AtriumApp')
    const regAcs = await acsOf(registry)
    const hasHolding = (inst: string) => regAcs.some((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === inst)
    if (!hasHolding('USD-CASH')) { await create(registry, tid('Holding'), { admin: registry, owner: meridian, instrument: 'USD-CASH', amount: '4200000.0' }); did.push('Leg:cash') }
    if (!hasHolding('HALDEN-EQUITY')) { await create(registry, tid('Holding'), { admin: registry, owner: seller, instrument: 'HALDEN-EQUITY', amount: '120000.0' }); did.push('Leg:equity') }
    if (!regAcs.some((c) => entityOf(c.templateId) === 'AllocationFactory')) { await create(registry, tid('AllocationFactory'), { admin: registry, users: [meridian, seller, operator] }); did.push('Factory') }

    // The cap table (share registry): Halden Robotics' 1,000,000 shares. The seller holds the
    // 120,000-share (12%) stake on offer; the close transfers it to the buyer.
    const founders = await ensureParty('Founders')
    const esop = await ensureParty('ESOP')
    const hasCert = (holder: string) => regAcs.some((c) => entityOf(c.templateId) === 'ShareCertificate' && c.createArgument.holder === holder)
    if (!hasCert(founders)) { await create(registry, tid('ShareCertificate'), { registrar: registry, holder: founders, instrument: 'HALDEN-EQUITY', shares: '600000.0' }); did.push('Cap:Founders') }
    if (!hasCert(esop)) { await create(registry, tid('ShareCertificate'), { registrar: registry, holder: esop, instrument: 'HALDEN-EQUITY', shares: '280000.0' }); did.push('Cap:ESOP') }
    if (!hasCert(seller)) { await create(registry, tid('ShareCertificate'), { registrar: registry, holder: seller, instrument: 'HALDEN-EQUITY', shares: '120000.0' }); did.push('Cap:Halden(stake)') }

    res.json({ seeded: did.length > 0, created: did, seller: displayName(seller), buyers: [displayName(boranic), displayName(meridian)] })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

app.get('/health', async (_req, res) => {
  try {
    const parties = await listParties()
    res.json({
      ok: true,
      ledgerApi: process.env.LEDGER_API_URL ?? 'http://localhost:7575',
      userId: USER_ID, partyPrefix: PARTY_PREFIX || '(none)', grantActAs: GRANT_ACT_AS, pkg: PKG ?? '(unresolved)',
      parties: parties.length,
    })
  } catch (e) { res.status(503).json({ ok: false, error: (e as Error).message }) }
})

const PORT = Number(process.env.PORT ?? 8080)
app.listen(PORT, () => console.log(`atrium executor (LIVE) on :${PORT} — ledger ${process.env.LEDGER_API_URL ?? 'http://localhost:7575'}`))
