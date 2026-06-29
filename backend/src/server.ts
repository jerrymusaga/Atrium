// Atrium executor app — REAL Canton JSON Ledger API integration.
//
// Holds no secrets of its own: it resolves the demo parties on the ledger, serves each
// caller a view SCOPED BY THE LEDGER (selective disclosure is enforced by Canton, not by
// filtering here), drives RecordAccess / Accept / Close as the acting party, and runs
// the atomic payment-vs-ownership close via the Atrium.Dvp settlement coordinator.

import './env.js'
import express from 'express'
import {
  activeContracts, allocatePartyByHint, create, createMulti, defaultConn, entityOf, exercise, grantActAs, listParties, makeConn, USER_ID, type Conn, type CreatedEvent,
} from './ledgerApi.js'
import { decryptDocument, docMeta, loadVault, readDocument, recomputeHash, registerDocument, seedVault, tamperDocument } from './vault.js'
import { chat, veniceConfigured } from './venice.js'

const app = express()
app.use(express.json({ limit: '12mb' }))  // headroom for base64-encoded file uploads
loadVault()
seedVault()

const SELLER = 'Halden'
const DEAL_ID = 'HALDEN-2026-A'
const DEFAULT_TIERS = ['Teaser', 'Financials', 'Legal']
const tierLabelOf = (tiers: string[], tier: number) => tiers[tier - 1] ?? `Tier ${tier}`

const PARTY_PREFIX = process.env.PARTY_PREFIX ?? ''
const hint = (logical: string) => `${PARTY_PREFIX}${logical}`
function matchesLogical(full: string, logical: string): boolean {
  const local = full.split('::')[0]
  const h = hint(logical)
  return local === h || local.startsWith(h + '-')
}
function displayName(full: string): string {
  let local = full.split('::')[0]
  if (PARTY_PREFIX && local.startsWith(PARTY_PREFIX)) local = local.slice(PARTY_PREFIX.length)
  const m = local.match(/^(.*?)-[0-9a-f]{6,}$/i)
  return m ? m[1] : local
}

const GRANT_ACT_AS = process.env.LEDGER_GRANT_ACT_AS === '1'

const REMOTE = (process.env.REMOTE_PARTY && process.env.REMOTE_LEDGER_API_URL)
  ? {
      label: process.env.REMOTE_PARTY_LABEL || 'Guest',
      party: process.env.REMOTE_PARTY,
      tier: Number(process.env.REMOTE_TIER || '1') >= 2 ? 2 : 1,
      conn: makeConn({
        baseUrl: process.env.REMOTE_LEDGER_API_URL,
        userId: process.env.REMOTE_LEDGER_USER_ID || 'participant_admin',
        staticToken: process.env.REMOTE_LEDGER_TOKEN || undefined,
        oidc: {
          tokenUrl: process.env.REMOTE_OIDC_TOKEN_URL, clientId: process.env.REMOTE_OIDC_CLIENT_ID,
          clientSecret: process.env.REMOTE_OIDC_CLIENT_SECRET, audience: process.env.REMOTE_OIDC_AUDIENCE,
          scope: process.env.REMOTE_OIDC_SCOPE,
        },
      }) as Conn,
    }
  : null

let PKG: string | null = process.env.ATRIUM_PKG ?? null
const DVP_ENTITIES = new Set(['Holding', 'Allocation', 'AllocationFactory', 'SettlementCoordinator', 'Distribution', 'DistributionPool'])
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

async function ensureParty(logical: string): Promise<string> {
  let party: string
  if (PARTY_NAMESPACE) {
    party = `${hint(logical)}::${PARTY_NAMESPACE}`
    try { await allocatePartyByHint(hint(logical)) } catch { /* already allocated */ }
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

async function acsOf(party: string, conn: Conn = defaultConn): Promise<CreatedEvent[]> {
  const all = await activeContracts(party, conn)
  return PKG ? all.filter((c) => c.templateId.startsWith(PKG + ':')) : all
}

// --- party-scoped read: the same deal, projected per party by the ledger itself ---

app.get('/deals/:dealId/view', async (req, res) => {
  try {
    await ensurePkg()
    const prefix = String(req.query.party ?? '')
    if (!prefix) return res.status(400).json({ error: 'Pass ?party=Halden|Boranic|Meridian|Board|Legal|KYCProvider' })
    const isSeller = prefix === SELLER
    const remote = REMOTE && prefix === REMOTE.label ? REMOTE : null
    const party = remote ? remote.party : await partyId(prefix)

    const mine = remote ? await acsOf(party, remote.conn) : await acsOf(party)
    const byEntity = (e: string) => mine.filter((c) => entityOf(c.templateId) === e)

    const seller = await partyId(SELLER)
    const sellerView = isSeller ? mine : await acsOf(seller)
    const dealC = sellerView.find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const docManifest = sellerView.filter((c) => entityOf(c.templateId) === 'Document').map((c) => c.createArgument)

    const myGrant = byEntity('AccessGrant')[0]?.createArgument
    const maxTier = isSeller ? 99 : (myGrant ? num(myGrant.maxTier) : 0)

    const dealTiers: string[] = (dealC?.tiers as string[] | undefined) ?? DEFAULT_TIERS
    const documents = docManifest.map((d: any) => ({
      docId: d.docId, title: d.title, tier: num(d.tier),
      tierLabel: tierLabelOf(dealTiers, num(d.tier)),
      contentHash: docMeta(d.docId)?.hash ?? d.contentHash,
      accessible: isSeller || maxTier >= num(d.tier),
    }))

    const accessTrail = byEntity('AccessEvent').map((c) => {
      const a = c.createArgument
      const doc = docManifest.find((d: any) => d.docId === a.docId)
      return { buyer: a.buyer, buyerLabel: labelFor(a.buyer), docId: a.docId, docTitle: doc?.title ?? a.docId, accessedAt: String(a.accessedAt).slice(11, 16) }
    })

    const atts = sellerView.filter((c) => entityOf(c.templateId) === 'KYCAttestation').map((c) => c.createArgument)
    const attFor = (full: string) => atts.find((a) => a.subject === full && Date.parse(a.expiresAt) > Date.now())
    const kycOf = (full: string) => { const a = attFor(full); return a ? { level: a.level, jurisdiction: a.jurisdiction } : null }

    const offers = byEntity('Offer').map((c) => {
      const o = c.createArgument
      return { offerId: c.contractId, buyer: o.buyer, buyerLabel: labelFor(o.buyer), pricePerUnit: num(o.pricePerUnit), quantity: num(o.quantity), submittedAt: String(o.submittedAt).slice(11, 16), status: 'open' as const, kyc: kycOf(o.buyer) }
    })

    const registry = await partyId('Registry')
    const regAcs = await acsOf(registry)
    const regHoldings = regAcs.filter((c) => entityOf(c.templateId) === 'Holding').map((c) => c.createArgument)
    const holdings = regHoldings.map((h: any) => ({ owner: h.owner, ownerLabel: labelFor(h.owner), instrument: h.instrument, amount: num(h.amount) }))
    const settled = regHoldings.some((h: any) => h.instrument === 'cBTC' && labelFor(h.owner) === SELLER)

    const certs = regAcs.filter((c) => entityOf(c.templateId) === 'ShareCertificate').map((c) => c.createArgument)
    const totalShares = certs.reduce((s, c: any) => s + num(c.shares), 0) || 1
    const capRow = (c: any) => ({ holderLabel: labelFor(c.holder), shares: num(c.shares), pct: Math.round((num(c.shares) / totalShares) * 1000) / 10 })
    const capTable = (isSeller ? certs : certs.filter((c: any) => c.holder === party)).map(capRow).sort((a, b) => b.shares - a.shares)

    // Capital distribution (post-close lifecycle): per-holder private payout receipts.
    // Founder/regulator see the whole declared distribution; a holder sees ONLY their own slice.
    const distContracts = regAcs.filter((c) => entityOf(c.templateId) === 'Distribution').map((c) => c.createArgument)
    let distribution: any = undefined
    let myDistribution: any = undefined
    if (distContracts.length > 0) {
      if (isSeller || prefix === 'Regulator') {
        const recips = distContracts
          .map((d: any) => ({ holderLabel: labelFor(d.holder), shares: num(d.shares), amount: num(d.amount) }))
          .sort((a, b) => b.amount - a.amount)
        distribution = {
          distributionId: distContracts[0].distributionId,
          perShare: num(distContracts[0].perShare),
          total: recips.reduce((s, r) => s + r.amount, 0),
          declaredAt: String(distContracts[0].declaredAt).slice(11, 16),
          recipients: recips,
        }
      }
      const own = distContracts.find((d: any) => d.holder === party)
      if (own) myDistribution = { amount: num(own.amount), shares: num(own.shares), perShare: num(own.perShare), declaredAt: String(own.declaredAt).slice(11, 16) }
    }

    // Conditions panel + per-investor summary (for the founder / seller lens)
    let conditions: any = undefined
    let investorsDetail: any[] | undefined = undefined
    let lifecycle: any[] | undefined = undefined
    if (isSeller && dealC) {
      const raiseTarget = num(dealC.raiseTarget ?? 0)
      const commitments = sellerView.filter((c) => entityOf(c.templateId) === 'Commitment')
      const approvals = sellerView.filter((c) => entityOf(c.templateId) === 'Approval')
      const totalCommitted = commitments.reduce((sum, c) => sum + num(c.createArgument.amount), 0)
      const percentFunded = raiseTarget > 0 ? Math.min(100, Math.round((totalCommitted / raiseTarget) * 100)) : 0
      const approvalMap = Object.fromEntries(approvals.map((c) => [c.createArgument.role, c]))
      const conditionsList = [
        { key: 'FUNDED',      label: `Raise target (${raiseTarget} cBTC)`, done: totalCommitted >= raiseTarget, detail: `${totalCommitted} / ${raiseTarget} cBTC` },
        { key: 'BOARD',       label: 'Board approval',       done: !!approvalMap['BOARD'],       approvedAt: approvalMap['BOARD']?.createArgument.approvedAt?.slice(11, 16) },
        { key: 'LEGAL',       label: 'Legal approval',       done: !!approvalMap['LEGAL'],       approvedAt: approvalMap['LEGAL']?.createArgument.approvedAt?.slice(11, 16) },
        { key: 'COMPLIANCE',  label: 'Compliance / KYC',     done: !!approvalMap['COMPLIANCE'],  approvedAt: approvalMap['COMPLIANCE']?.createArgument.approvedAt?.slice(11, 16) },
      ]
      conditions = {
        raiseTarget, totalCommitted, percentFunded,
        conditions: conditionsList,
        allGreen: conditionsList.every((c) => c.done),
        commitmentCids: commitments.map((c) => c.contractId),
        approvalCids: approvals.map((c) => c.contractId),
        commitmentsDetail: commitments.map((c) => ({
          investorLabel: labelFor(c.createArgument.investor),
          amount: num(c.createArgument.amount),
          committedAt: String(c.createArgument.committedAt).slice(11, 16),
        })),
      }

      // Merge grants + commitments + offers into a per-investor summary for the competing bids table
      const grantContracts = sellerView.filter((c) => entityOf(c.templateId) === 'AccessGrant')
      const offerContracts = sellerView.filter((c) => entityOf(c.templateId) === 'Offer')
      const investorMap = new Map<string, { name: string; tier: number; committed: number | null; committedAt: string | null; hasBid: boolean; kyc: any }>()
      for (const g of grantContracts) {
        const name = labelFor(g.createArgument.buyer)
        if (!investorMap.has(name)) investorMap.set(name, { name, tier: num(g.createArgument.maxTier), committed: null, committedAt: null, hasBid: false, kyc: kycOf(g.createArgument.buyer) })
      }
      for (const c of commitments) {
        const name = labelFor(c.createArgument.investor)
        const entry = investorMap.get(name)
        if (entry) { entry.committed = num(c.createArgument.amount); entry.committedAt = String(c.createArgument.committedAt).slice(11, 16) }
      }
      for (const o of offerContracts) {
        const name = labelFor(o.createArgument.buyer)
        const entry = investorMap.get(name)
        if (entry) entry.hasBid = true
      }
      investorsDetail = Array.from(investorMap.values())

      // Unified on-chain audit trail — every ledger event in one timeline.
      // Grants · disclosures · commitments · approvals · settlement, in the order they hit Canton.
      const ev: { at: string; kind: string; actor: string; detail: string }[] = []
      for (const g of grantContracts) {
        const a = g.createArgument
        ev.push({ at: String(a.grantedAt), kind: 'grant', actor: labelFor(a.buyer), detail: `granted access up to “${tierLabelOf(dealTiers, num(a.maxTier))}”` })
      }
      for (const c of byEntity('AccessEvent')) {
        const a = c.createArgument
        const doc = docManifest.find((d: any) => d.docId === a.docId)
        ev.push({ at: String(a.accessedAt), kind: 'disclosure', actor: labelFor(a.buyer), detail: `opened “${doc?.title ?? a.docId}”` })
      }
      for (const c of commitments) {
        const a = c.createArgument
        ev.push({ at: String(a.committedAt), kind: 'commitment', actor: labelFor(a.investor), detail: `committed ${num(a.amount)} cBTC toward the raise` })
      }
      for (const c of approvals) {
        const a = c.createArgument
        ev.push({ at: String(a.approvedAt), kind: 'approval', actor: a.role, detail: `${a.role} approval recorded on-ledger` })
      }
      ev.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
      // Settlement caps the timeline (Holding carries no timestamp; it is always the last event).
      if (settled) ev.push({ at: '', kind: 'settlement', actor: 'Registry', detail: 'cBTC ↔ equity swapped atomically — conditional close executed' })
      lifecycle = ev.map((e) => ({ ...e, at: e.at ? e.at.slice(11, 16) : '' }))
    }

    // Commitment for a buyer lens
    const myCommitmentC = !isSeller ? byEntity('Commitment')[0] : null
    const myCommitment = myCommitmentC ? { amount: num(myCommitmentC.createArgument.amount), committedAt: String(myCommitmentC.createArgument.committedAt).slice(11, 16) } : null

    // Approval for a governance role lens
    const myApprovalC = byEntity('Approval')[0]
    const myApproval = myApprovalC ? { role: myApprovalC.createArgument.role, approvedAt: String(myApprovalC.createArgument.approvedAt).slice(11, 16) } : null

    res.json({
      deal: dealC ? { dealId: dealC.dealId, title: dealC.title, seller: dealC.seller, instrument: dealC.instrument, quantity: num(dealC.quantity), raiseTarget: num(dealC.raiseTarget ?? 0), tiers: dealTiers } : null,
      documents, accessTrail, offers, holdings, capTable, settled,
      kyc: isSeller ? null : kycOf(party),
      conditions, myCommitment, myApproval, investorsDetail, lifecycle,
      distribution, myDistribution,
    })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- open a document: the KEY-RELEASE GATE ---
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
        return res.status(403).json({ error: `Access restricted — insufficient privileges. Your grant covers tier ${tier}; "${meta.title}" is tier ${meta.tier}. The key service will not release the key.`, sealed: true, tier: meta.tier })
      }
      if (grant) await exercise(party, grant.templateId, grant.contractId, 'RecordAccess', { docId })
    }
    // Serve text inline; serve real files (pdf/image/…) as base64 + mime for in-browser preview/download.
    const mime = meta.mime ?? 'text/plain'
    const isText = mime.startsWith('text/') || mime === 'application/json'
    if (isText) {
      res.json({ docId, title: meta.title, tier: meta.tier, hash: meta.hash, bytes: meta.bytes, content: decryptDocument(docId) ?? '', mime })
    } else {
      const read = readDocument(docId)
      res.json({ docId, title: meta.title, tier: meta.tier, hash: meta.hash, bytes: meta.bytes, content: '', mime, dataBase64: read ? read.buffer.toString('base64') : '' })
    }
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- seller uploads a document at ANY tier: typed text OR a real file (pdf/image/…) ---
app.post('/deals/:dealId/documents', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, title, tier, content, fileBase64, mime, fileName } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the seller can add documents' })
    const name = String(title ?? fileName ?? '').trim()
    const t = Math.max(1, Math.floor(Number(tier) || 1))
    const hasFile = typeof fileBase64 === 'string' && fileBase64.length > 0
    const body = String(content ?? '')
    if (!name) return res.status(400).json({ error: 'title required' })
    if (!hasFile && !body) return res.status(400).json({ error: 'content or file required' })
    const seller = await partyId(SELLER)
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'doc'
    const docId = `${slug}-${Date.now().toString(36).slice(-4)}`
    const data = hasFile ? Buffer.from(fileBase64, 'base64') : body
    const docMime = hasFile ? String(mime || 'application/octet-stream') : 'text/plain'
    const { hash, pointer } = registerDocument(docId, name, t, data, docMime)
    await create(seller, tid('Document'), { seller, dealId: DEAL_ID, docId, title: name, tier: String(t), contentHash: hash, blobPointer: pointer })
    res.json({ docId, title: name, tier: t, hash, mime: docMime })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- provable integrity: prove the off-chain vault still matches Canton ---
// Recompute each blob's hash from the ciphertext on disk RIGHT NOW and compare it to the
// immutable Document.contentHash on-ledger. If a blob was altered off-chain, the hashes diverge
// and the ledger detects it. This closes the "documents live off-chain" honesty gap: Canton is
// the tamper-evident source of truth, the vault is just storage.
app.get('/deals/:dealId/verify', async (req, res) => {
  try {
    await ensurePkg()
    const prefix = String(req.query.party ?? '')
    if (prefix !== SELLER && prefix !== 'Regulator') return res.status(403).json({ error: 'Only the founder or a regulator can run an integrity check' })
    const seller = await partyId(SELLER)
    const sellerAcs = await acsOf(seller)
    const dealC = sellerAcs.find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const dealTiers: string[] = (dealC?.tiers as string[] | undefined) ?? DEFAULT_TIERS

    const docContracts = sellerAcs.filter((c) => entityOf(c.templateId) === 'Document')
    const documents = docContracts.map((c) => {
      const d = c.createArgument
      const ledgerHash = String(d.contentHash)
      const recomputedHash = recomputeHash(d.docId) ?? '(blob missing)'
      return {
        docId: d.docId, title: d.title, tier: num(d.tier),
        tierLabel: tierLabelOf(dealTiers, num(d.tier)),
        ledgerHash, recomputedHash, intact: ledgerHash === recomputedHash,
      }
    })

    const countOf = (e: string) => sellerAcs.filter((c) => entityOf(c.templateId) === e).length
    res.json({
      documents,
      allIntact: documents.every((d) => d.intact),
      intactCount: documents.filter((d) => d.intact).length,
      total: documents.length,
      events: {
        grants: countOf('AccessGrant'),
        disclosures: countOf('AccessEvent'),
        commitments: countOf('Commitment'),
        approvals: countOf('Approval'),
      },
      checkedAt: new Date().toISOString().slice(11, 19),
    })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- DEMO ONLY: simulate an off-chain tamper so the next /verify catches it ---
// Flips one ciphertext byte in the vault WITHOUT touching the on-ledger hash. Idempotent toggle —
// call again to restore. Demonstrates that altering the off-chain blob is detectable against Canton.
app.post('/deals/:dealId/tamper', async (req, res) => {
  try {
    const { party: prefix, docId } = req.body ?? {}
    if (prefix !== SELLER && prefix !== 'Regulator') return res.status(403).json({ error: 'Only the founder or a regulator can run the tamper demo' })
    if (!docId) return res.status(400).json({ error: 'docId required' })
    const ok = tamperDocument(String(docId))
    if (!ok) return res.status(404).json({ error: 'unknown document blob' })
    res.json({ tampered: true, docId })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- post-close lifecycle: founder declares a pro-rata cBTC distribution ---
// One atomic transaction (DistributionPool.Declare) pays every cap-table holder their pro-rata
// slice from the founder's post-close cBTC treasury and issues each a PRIVATE receipt — holders
// see only their own. Atrium runs the ongoing cap table, not just the one-shot close.
app.post('/deals/:dealId/distribute', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, amount } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the founder can declare a distribution' })
    const total = Number(amount)
    if (!(total > 0)) return res.status(400).json({ error: 'amount (total cBTC to distribute) must be > 0' })

    const registry = await partyId('Registry')
    const seller = await partyId(SELLER)
    const regAcs = await acsOf(registry)

    // Recipients = the current cap table (every ShareCertificate holder + their share count).
    const certs = regAcs.filter((c) => entityOf(c.templateId) === 'ShareCertificate')
    if (certs.length === 0) return res.status(400).json({ error: 'No shareholders on the cap table yet' })
    const totalShares = certs.reduce((s, c) => s + num(c.createArgument.shares), 0)
    const perShare = total / totalShares
    const recipients = certs.map((c) => ({ _1: c.createArgument.holder, _2: num(c.createArgument.shares).toFixed(1) }))

    // Treasury = the founder's cBTC holding (received at the close). No close ⇒ no treasury.
    const treasury = regAcs.find((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === 'cBTC' && c.createArgument.owner === seller)
    if (!treasury) return res.status(400).json({ error: 'No cBTC treasury — the founder receives cBTC only at the close. Close the deal first.' })
    if (num(treasury.createArgument.amount) < total) return res.status(400).json({ error: `Treasury holds ${num(treasury.createArgument.amount)} cBTC; cannot distribute ${total}.` })

    // The distribution facility — created once, reused for future distributions.
    let pool = regAcs.find((c) => entityOf(c.templateId) === 'DistributionPool')
    if (!pool) pool = await create(registry, tid('DistributionPool'), { registrar: registry, company: seller, instrument: 'cBTC', distributionId: `DIST-${DEAL_ID}` })

    await exercise(registry, pool.templateId, pool.contractId, 'Declare', {
      treasuryCid: treasury.contractId,
      recipients,
      perShare: perShare.toFixed(10),
      declaredAt: new Date().toISOString(),
    })
    res.json({ declared: true, total, perShare, recipients: certs.length })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- diligence copilot: privacy-bounded AI ---
const DOC_IDS = ['teaser', 'financials']
app.post('/deals/:dealId/ask', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, question } = req.body ?? {}
    if (!prefix || !question) return res.status(400).json({ error: 'party and question required' })
    if (!veniceConfigured()) return res.status(503).json({ error: 'Copilot offline — set VENICE_API_KEY in backend/.env' })

    const isSeller = prefix === SELLER
    const seller = await partyId(SELLER)
    const dealC = (await acsOf(seller)).find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    const dealTiers: string[] = (dealC?.tiers as string[] | undefined) ?? DEFAULT_TIERS
    let tier = 99
    if (!isSeller) {
      const party = await partyId(prefix)
      const grant = (await acsOf(party)).find((c) => entityOf(c.templateId) === 'AccessGrant')
      tier = grant ? num(grant.createArgument.maxTier) : 0
    }
    const named = (t: number) => `"${tierLabelOf(dealTiers, t)}" (tier ${t})`
    const authorized = DOC_IDS.map((id) => ({ id, meta: docMeta(id) })).filter((d) => d.meta && tier >= d.meta.tier)
    const context = authorized.map((d) => `### ${d.meta!.title} — ${named(d.meta!.tier)}\n${decryptDocument(d.id)}`).join('\n\n')

    const system = `You are the diligence copilot inside Atrium, a private capital markets OS on Canton Network.
You are answering for the party "${prefix}". You may ONLY use the documents below — they are EXACTLY what this party's on-ledger access grant authorizes. Do not use outside knowledge and never invent figures.
The deal's named access tiers, in order, are: ${dealTiers.map((t, i) => `"${t}" (tier ${i + 1})`).join(', ')}.
If the question needs information that is not in these documents, do NOT answer from outside knowledge. Reply that access is restricted: state plainly that the answer sits in a higher access tier (e.g. ${named(Math.min(tier + 1, dealTiers.length))}) and that this party has insufficient privileges to view it — recommend requesting that tier from the founder. Be concise and cite the specific figures you use from the authorized documents.

AUTHORIZED DOCUMENTS:
${context || '(none — this party has no document access)'}`

    const answer = await chat(system, String(question))
    res.json({ answer, authorizedDocs: authorized.map((d) => d.meta!.title), tier: isSeller ? 'all tiers' : `tier ${tier}` })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- investor commits cBTC toward the raise ---
// Creates a Commitment contract (co-signed by investor + registry as admin) that the
// Deal.Close gate will fetch and sum against the raiseTarget.
app.post('/deals/:dealId/commit', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, amount } = req.body ?? {}
    if (!prefix) return res.status(400).json({ error: 'party required' })
    const cbtc = Number(amount)
    if (!(cbtc > 0)) return res.status(400).json({ error: 'amount must be > 0' })
    const investor = await partyId(prefix)
    const founder  = await partyId(SELLER)
    const admin    = await partyId('Registry')
    const now = new Date().toISOString()
    await createMulti([investor, admin], tid('Commitment'), { admin, investor, founder, dealId: DEAL_ID, amount: cbtc.toFixed(4), committedAt: now })
    res.json({ committed: true, amount: cbtc })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- governance approvals (Board / Legal / Compliance) ---
// Each role creates an Approval contract (signatory = approver, observer = founder) that
// the Deal.Close gate fetches to verify every required role has signed off.
app.post('/deals/:dealId/approve', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, role } = req.body ?? {}
    if (!prefix || !role) return res.status(400).json({ error: 'party and role required' })
    const validRoles = ['BOARD', 'LEGAL', 'COMPLIANCE']
    if (!validRoles.includes(String(role).toUpperCase())) return res.status(400).json({ error: `role must be one of ${validRoles.join(', ')}` })
    const approver = await partyId(prefix)
    const founder  = await partyId(SELLER)
    const now = new Date().toISOString()
    await create(approver, tid('Approval'), { approver, role: String(role).toUpperCase(), dealId: DEAL_ID, approvedAt: now, founder })
    res.json({ approved: true, role: String(role).toUpperCase() })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- deal readiness: raise progress + approval states ---
app.get('/deals/:dealId/conditions', async (req, res) => {
  try {
    await ensurePkg()
    const seller = await partyId(SELLER)
    const sellerAcs = await acsOf(seller)
    const dealC = sellerAcs.find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    if (!dealC) return res.status(404).json({ error: 'Deal not found — seed first' })
    const raiseTarget = num(dealC.raiseTarget ?? 0)
    const commitments = sellerAcs.filter((c) => entityOf(c.templateId) === 'Commitment')
    const approvals = sellerAcs.filter((c) => entityOf(c.templateId) === 'Approval')
    const totalCommitted = commitments.reduce((sum, c) => sum + num(c.createArgument.amount), 0)
    const percentFunded = raiseTarget > 0 ? Math.min(100, Math.round((totalCommitted / raiseTarget) * 100)) : 0
    const approvalMap = Object.fromEntries(approvals.map((c) => [c.createArgument.role, c]))
    const conditionsList = [
      { key: 'FUNDED',     label: `Raise target (${raiseTarget} cBTC)`, done: totalCommitted >= raiseTarget, detail: `${totalCommitted} / ${raiseTarget} cBTC` },
      { key: 'BOARD',      label: 'Board approval',    done: !!approvalMap['BOARD'] },
      { key: 'LEGAL',      label: 'Legal approval',    done: !!approvalMap['LEGAL'] },
      { key: 'COMPLIANCE', label: 'Compliance / KYC',  done: !!approvalMap['COMPLIANCE'] },
    ]
    res.json({
      raiseTarget, totalCommitted, percentFunded,
      conditions: conditionsList,
      allGreen: conditionsList.every((c) => c.done),
    })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- deal readiness score: composite % from on-chain signals + Venice narration ---
app.get('/deals/:dealId/readiness', async (req, res) => {
  try {
    await ensurePkg()
    const seller = await partyId(SELLER)
    const sellerAcs = await acsOf(seller)
    const dealC = sellerAcs.find((c) => entityOf(c.templateId) === 'Deal')?.createArgument
    if (!dealC) return res.status(404).json({ error: 'Deal not found — seed first' })

    const docs        = sellerAcs.filter((c) => entityOf(c.templateId) === 'Document')
    const grants      = sellerAcs.filter((c) => entityOf(c.templateId) === 'AccessGrant')
    const offers      = sellerAcs.filter((c) => entityOf(c.templateId) === 'Offer')
    const commitments = sellerAcs.filter((c) => entityOf(c.templateId) === 'Commitment')
    const approvals   = sellerAcs.filter((c) => entityOf(c.templateId) === 'Approval')

    const raiseTarget    = num(dealC.raiseTarget ?? 0)
    const totalCommitted = commitments.reduce((s, c) => s + num(c.createArgument.amount), 0)
    const fundingRatio   = raiseTarget > 0 ? Math.min(1, totalCommitted / raiseTarget) : 0
    const approvalCount  = approvals.length
    const requiredCount  = (dealC.requiredApprovals ?? []).length || 3
    const tiers          = new Set(docs.map((c) => String(c.createArgument.tier)))
    const multiTier      = tiers.size > 1

    const signals = [
      { key: 'DOCS',      label: 'Documents in data room', max: 15, pts: docs.length === 0 ? 0 : multiTier ? 15 : 10, detail: docs.length === 0 ? 'No documents yet' : `${docs.length} doc${docs.length > 1 ? 's' : ''}${multiTier ? ', multi-tier' : ''}` },
      { key: 'INVESTORS', label: 'Investors invited',      max: 15, pts: grants.length === 0 ? 0 : grants.length >= 2 ? 15 : 8, detail: `${grants.length} investor${grants.length !== 1 ? 's' : ''} granted access` },
      { key: 'BIDS',      label: 'Sealed bids received',  max: 20, pts: offers.length === 0 ? 0 : offers.length >= 2 ? 20 : 12, detail: offers.length === 0 ? 'No bids yet' : `${offers.length} sealed bid${offers.length !== 1 ? 's' : ''} in` },
      { key: 'FUNDING',   label: `Raise target (${raiseTarget} cBTC)`, max: 30, pts: Math.round(fundingRatio * 30), detail: raiseTarget > 0 ? `${totalCommitted} / ${raiseTarget} cBTC (${Math.round(fundingRatio * 100)}%)` : 'No raise target set' },
      { key: 'APPROVALS', label: 'Governance approvals',  max: 20, pts: requiredCount > 0 ? Math.round((approvalCount / requiredCount) * 20) : 0, detail: `${approvalCount} / ${requiredCount} required` },
    ]
    const score = Math.min(100, signals.reduce((s, sg) => s + sg.pts, 0))

    let narration: string | null = null
    if (veniceConfigured()) {
      try {
        const summary = signals.map((sg) => `${sg.label}: ${sg.pts}/${sg.max}pts (${sg.detail})`).join('; ')
        narration = await chat(
          `You are the deal narrator inside Atrium, a private capital markets platform. Given the signals below, write ONE sentence (max 20 words) summarizing deal readiness for the founder. Be direct and factual. No greeting, no filler. Start with the score.`,
          `Score: ${score}%. ${summary}`,
        )
      } catch { /* fall through to programmatic fallback */ }
    }
    if (!narration) {
      const parts: string[] = []
      if (fundingRatio >= 1) parts.push('raise target hit')
      else if (totalCommitted > 0) parts.push(`${Math.round(fundingRatio * 100)}% funded`)
      if (approvalCount === requiredCount && requiredCount > 0) parts.push('all approvals in')
      else if (approvalCount > 0) parts.push(`${approvalCount}/${requiredCount} approvals`)
      else parts.push('approvals pending')
      if (offers.length === 0) parts.push('no bids yet')
      narration = `Deal is ${score}% ready — ${parts.join(', ')}.`
    }

    res.json({ score, signals, narration })
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
    const att = acs.find((c) => entityOf(c.templateId) === 'KYCAttestation'
      && c.createArgument.subject === offer.createArgument.buyer
      && Date.parse(c.createArgument.expiresAt) > Date.now())
    if (!att) return res.status(403).json({ error: 'Bidder is not KYC-cleared — cannot accept' })
    await exercise(seller, offer.templateId, offer.contractId, 'Accept', { kycCid: att.contractId })
    res.json({ accepted: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// --- the conditional atomic close: validate 4 conditions on-ledger, then swap legs ---
// Exercises Deal.Close (the on-ledger gate) first. If any condition fails, the close
// aborts and nothing moves. On success, executes the DvP swap atomically.
// `break: true` pulls one leg first to demonstrate all-or-nothing.
app.post('/deals/:dealId/settle', async (req, res) => {
  try {
    await ensurePkg()
    const breakLeg = Boolean(req.body?.break)
    const ref = `${DEAL_ID}-${Date.now()}`
    const registry = await partyId('Registry')
    const operator = await ensureParty('AtriumApp')
    const seller = await partyId(SELLER)
    const buyer = await partyId('Meridian')

    // --- On-ledger conditional close gate (skipped in break-leg stress-test) ---
    if (!breakLeg) {
      const sellerAcs = await acsOf(seller)
      const dealC = sellerAcs.find((c) => entityOf(c.templateId) === 'Deal')
      const winningOffer = sellerAcs.find((c) => entityOf(c.templateId) === 'Offer')
      if (!dealC)       return res.status(409).json({ error: 'No deal found — seed first' })
      if (!winningOffer) return res.status(409).json({ error: 'No open offer — investor must submit a bid first' })
      const att = sellerAcs.find((c) => entityOf(c.templateId) === 'KYCAttestation'
        && c.createArgument.subject === winningOffer.createArgument.buyer
        && Date.parse(c.createArgument.expiresAt) > Date.now())
      if (!att) return res.status(403).json({ error: 'Winning investor is not KYC-cleared' })
      const approvalCids  = sellerAcs.filter((c) => entityOf(c.templateId) === 'Approval').map((c) => c.contractId)
      const commitmentCids = sellerAcs.filter((c) => entityOf(c.templateId) === 'Commitment').map((c) => c.contractId)
      // Validate all 4 conditions on-ledger — aborts if any are missing
      await exercise(seller, dealC.templateId, dealC.contractId, 'Close', {
        winnerOffer: winningOffer.contractId, kycCid: att.contractId, approvalCids, commitmentCids,
      })
      // Mark the winning offer accepted (consuming choice, cleans up the offer contract)
      await exercise(seller, winningOffer.templateId, winningOffer.contractId, 'Accept', { kycCid: att.contractId })
    }

    // --- Atomic DvP swap ---
    const regAcs = await acsOf(registry)
    const cashH  = regAcs.find((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === 'cBTC'          && c.createArgument.owner === buyer)
    const eqH    = regAcs.find((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === 'HALDEN-EQUITY' && c.createArgument.owner === seller)
    const factory = regAcs.find((c) => entityOf(c.templateId) === 'AllocationFactory')
    if (!cashH || !eqH || !factory) return res.status(409).json({ error: 'legs not ready (seed first) or already settled' })

    const settleBefore = new Date(Date.now() + 24 * 3600_000).toISOString()
    const coord = await create(operator, tid('SettlementCoordinator'), { executor: operator, settlementRef: ref, settleBefore })
    const cashAlloc = ex1(await exercise(buyer, factory.templateId, factory.contractId, 'Allocate', { holdingCid: cashH.contractId, settlementRef: ref, legId: 'cash', sender: buyer, receiver: seller, executor: operator }))
    const eqAlloc   = ex1(await exercise(seller, factory.templateId, factory.contractId, 'Allocate', { holdingCid: eqH.contractId, settlementRef: ref, legId: 'ownership', sender: seller, receiver: buyer, executor: operator }))

    if (breakLeg) {
      await exercise(seller, eqAlloc.templateId, eqAlloc.contractId, 'Allocation_Withdraw', {})
      try {
        await exercise(operator, coord.templateId, coord.contractId, 'Settle', { cashLeg: cashAlloc.contractId, ownershipLeg: eqAlloc.contractId })
        return res.status(500).json({ error: 'expected the broken close to fail' })
      } catch {
        await exercise(buyer, cashAlloc.templateId, cashAlloc.contractId, 'Allocation_Withdraw', {})
        return res.json({ settled: false, atomic: true, rolledBack: true, note: 'One leg was pulled → Settle failed → neither side moved.' })
      }
    }

    await exercise(operator, coord.templateId, coord.contractId, 'Settle', { cashLeg: cashAlloc.contractId, ownershipLeg: eqAlloc.contractId })
    const stake = regAcs.find((c) => entityOf(c.templateId) === 'ShareCertificate' && c.createArgument.holder === seller && c.createArgument.instrument === 'HALDEN-EQUITY')
    if (stake) await exercise(registry, stake.templateId, stake.contractId, 'Transfer', { newHolder: buyer })
    res.json({ settled: true, atomic: true, settlementRef: ref, cbtcToFounder: 4200000, equityToInvestor: 120000 })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Reset the close to pre-settle state (re-runnable demo)
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
    await create(registry, tid('Holding'), { admin: registry, owner: buyer,  instrument: 'cBTC',          amount: '4200000.0' })
    await create(registry, tid('Holding'), { admin: registry, owner: seller, instrument: 'HALDEN-EQUITY', amount: '120000.0' })
    const stake = reg.find((c) => entityOf(c.templateId) === 'ShareCertificate' && c.createArgument.holder === buyer && c.createArgument.instrument === 'HALDEN-EQUITY')
    if (stake) await exercise(registry, stake.templateId, stake.contractId, 'Transfer', { newHolder: seller })
    res.json({ reset: true })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

function ex1(txResult: any): CreatedEvent {
  const ev = txResult?.transaction?.events?.find((e: any) => e.CreatedEvent)?.CreatedEvent
  if (!ev) throw new Error('exercise returned no created contract')
  return ev as CreatedEvent
}

// Lenses: seller + every investor with an AccessGrant + approver roles (Board/Legal/Compliance)
app.get('/viewers', async (_req, res) => {
  try {
    await ensurePkg()
    const seller = await partyId(SELLER)
    const grants = (await acsOf(seller)).filter((c) => entityOf(c.templateId) === 'AccessGrant')
    const seen = new Set<string>()
    const buyers = grants
      .map((c) => ({ name: labelFor(c.createArgument.buyer), tier: num(c.createArgument.maxTier) }))
      .filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)))
      .map((b) => ({ party: b.name, label: `${b.name} (Investor · up to tier ${b.tier})`, role: 'buyer' as const, live: false }))

    const remoteLens = REMOTE && !buyers.some((b) => b.party === REMOTE.label)
      ? [{ party: REMOTE.label, label: `${REMOTE.label} (Investor · own validator)`, role: 'buyer' as const, live: true }]
      : []

    // Approver lenses — added once the relevant parties exist on-ledger (after seed)
    const approverDefs = [
      { logical: 'Board',       role: 'board',       label: 'Board (Approver)' },
      { logical: 'Legal',       role: 'legal',       label: 'Legal (Approver)' },
      { logical: 'KYCProvider', role: 'compliance',  label: 'Compliance (Approver)' },
    ] as const
    const approverLenses = (await Promise.all(
      approverDefs.map(async (p) => {
        try { await partyId(p.logical); return { party: p.logical, label: p.label, role: p.role, live: false } }
        catch { return null }
      })
    )).filter(Boolean) as { party: string; label: string; role: 'board' | 'legal' | 'compliance'; live: boolean }[]

    res.json([
      { party: SELLER, label: 'Halden (Founder)', role: 'seller', live: false },
      ...buyers,
      ...remoteLens,
      ...approverLenses,
    ])
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Seller onboards a buyer
app.post('/deals/:dealId/invite', async (req, res) => {
  try {
    await ensurePkg()
    const { party: prefix, buyerName, buyerParty, tier } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the seller can invite buyers' })
    const seller = await partyId(SELLER)
    const maxTier = Math.max(1, Math.floor(Number(tier) || 1))
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

// Investor submits a sealed bid
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

// Founder sets up the room: creates the Deal contract with NAMED tiers + raise target.
// Named tiers live on-ledger (Deal.tiers); Document.tier stays an Int and reads its label
// from here. Lightweight by design — the founder then adds docs + invites investors via the
// existing endpoints. The full closeable demo is the /seed path.
app.post('/deals', async (req, res) => {
  try {
    if (!PKG) return res.status(400).json({ error: 'set ATRIUM_PKG to the uploaded DAR package id before creating a deal' })
    const { party: prefix, title, instrument, raiseTarget, tiers, quantity } = req.body ?? {}
    if (prefix !== SELLER) return res.status(403).json({ error: 'Only the founder can set up a deal' })
    const seller = await ensureParty(SELLER)
    const existing = (await acsOf(seller)).find((c) => entityOf(c.templateId) === 'Deal')
    if (existing) return res.status(409).json({ error: 'A deal is already configured on this ledger — load the demo or reset before creating a new one.' })

    const dealTitle = String(title ?? '').trim() || 'Untitled raise'
    const inst = String(instrument ?? '').trim() || 'EQUITY'
    const target = Number(raiseTarget)
    if (!(target > 0)) return res.status(400).json({ error: 'raiseTarget (cBTC) must be > 0' })
    const qty = Number(quantity) > 0 ? Number(quantity) : 120000
    const tierNames = Array.isArray(tiers)
      ? tiers.map((t: any) => String(t).trim()).filter(Boolean)
      : []
    const finalTiers = tierNames.length > 0 ? tierNames : DEFAULT_TIERS

    await create(seller, tid('Deal'), {
      seller, dealId: DEAL_ID, title: dealTitle, instrument: inst,
      quantity: qty.toFixed(1), raiseTarget: target.toFixed(4),
      requiredApprovals: ['BOARD', 'LEGAL', 'COMPLIANCE'], tiers: finalTiers,
    })
    res.json({ created: true, dealId: DEAL_ID, title: dealTitle, instrument: inst, raiseTarget: target, tiers: finalTiers })
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Seed a fresh (hosted) ledger with the fundraise demo. Idempotent — skips existing contracts.
app.post('/deals/:dealId/seed', async (_req, res) => {
  try {
    if (!PKG) return res.status(400).json({ error: 'set ATRIUM_PKG to the uploaded DAR package id before seeding' })
    const seller  = await ensureParty(SELLER)
    const boranic = await ensureParty('Boranic')
    const meridian = await ensureParty('Meridian')
    const kycp    = await ensureParty('KYCProvider')
    const board      = await ensureParty('Board')
    const legal      = await ensureParty('Legal')
    const prometheus = await ensureParty('Prometheus')
    const now = new Date().toISOString()
    const oneYear = new Date(Date.now() + 365 * 24 * 3600_000).toISOString()
    const did: string[] = []

    const acs = await acsOf(seller)
    const has = (e: string, pred: (a: any) => boolean = () => true) =>
      acs.some((c) => entityOf(c.templateId) === e && pred(c.createArgument))
    const grantFor = (full: string) => acs.find((c) => entityOf(c.templateId) === 'AccessGrant' && c.createArgument.buyer === full)

    if (!has('Deal')) {
      await create(seller, tid('Deal'), { seller, dealId: DEAL_ID, title: 'Halden Robotics — 25 cBTC Series A', instrument: 'HALDEN-EQUITY', quantity: '120000.0', raiseTarget: '25.0', requiredApprovals: ['BOARD', 'LEGAL', 'COMPLIANCE'], tiers: DEFAULT_TIERS })
      did.push('Deal')
    }
    // contentHash MUST be the real vault hash (seedVault registered these blobs) so /verify
    // matches the ciphertext byte-for-byte. Placeholders here would falsely read as tampered.
    if (!has('Document', (a) => a.docId === 'teaser')) { await create(seller, tid('Document'), { seller, dealId: DEAL_ID, docId: 'teaser', title: 'Investment teaser', tier: '1', contentHash: docMeta('teaser')?.hash ?? 'sha256:aa11', blobPointer: 's3://atrium/halden/teaser.enc' }); did.push('Document:teaser') }
    if (!has('Document', (a) => a.docId === 'financials')) { await create(seller, tid('Document'), { seller, dealId: DEAL_ID, docId: 'financials', title: 'Audited financials', tier: '2', contentHash: docMeta('financials')?.hash ?? 'sha256:bb22', blobPointer: 's3://atrium/halden/financials.enc' }); did.push('Document:financials') }

    let gA = grantFor(boranic)
    if (!gA) { gA = await create(seller, tid('AccessGrant'), { seller, buyer: boranic, dealId: DEAL_ID, maxTier: '1', grantedAt: now }); did.push('Grant:Boranic') }
    let gB = grantFor(meridian)
    if (!gB) { gB = await create(seller, tid('AccessGrant'), { seller, buyer: meridian, dealId: DEAL_ID, maxTier: '2', grantedAt: now }); did.push('Grant:Meridian') }
    let gC = grantFor(prometheus)
    if (!gC) { gC = await create(seller, tid('AccessGrant'), { seller, buyer: prometheus, dealId: DEAL_ID, maxTier: '1', grantedAt: now }); did.push('Grant:Prometheus') }

    if (!has('AccessEvent', (a) => a.buyer === boranic)) {
      await exercise(boranic, gA.templateId, gA.contractId, 'RecordAccess', { docId: 'teaser' })
      did.push('AccessEvent:Boranic')
    }
    if (!has('AccessEvent', (a) => a.buyer === meridian)) {
      await exercise(meridian, gB.templateId, gB.contractId, 'RecordAccess', { docId: 'teaser' })
      await exercise(meridian, gB.templateId, gB.contractId, 'RecordAccess', { docId: 'financials' })
      did.push('AccessEvent:Meridian')
    }
    if (!has('AccessEvent', (a) => a.buyer === prometheus)) {
      await exercise(prometheus, gC.templateId, gC.contractId, 'RecordAccess', { docId: 'teaser' })
      did.push('AccessEvent:Prometheus')
    }
    if (!has('KYCAttestation', (a) => a.subject === boranic))   { await create(kycp, tid('KYCAttestation'), { kycProvider: kycp, subject: boranic,   relyingParty: seller, level: 'KYB-INSTITUTIONAL', jurisdiction: 'US', issuedAt: now, expiresAt: oneYear }); did.push('KYC:Boranic') }
    if (!has('KYCAttestation', (a) => a.subject === meridian))  { await create(kycp, tid('KYCAttestation'), { kycProvider: kycp, subject: meridian,  relyingParty: seller, level: 'KYB-INSTITUTIONAL', jurisdiction: 'US', issuedAt: now, expiresAt: oneYear }); did.push('KYC:Meridian') }
    if (!has('KYCAttestation', (a) => a.subject === prometheus)) { await create(kycp, tid('KYCAttestation'), { kycProvider: kycp, subject: prometheus, relyingParty: seller, level: 'KYB-INSTITUTIONAL', jurisdiction: 'SG', issuedAt: now, expiresAt: oneYear }); did.push('KYC:Prometheus') }
    if (!has('Offer', (a) => a.buyer === meridian))  { await create(meridian,  tid('Offer'), { buyer: meridian,  seller, dealId: DEAL_ID, pricePerUnit: '0.2083', quantity: '120000.0', submittedAt: now }); did.push('Offer:Meridian') }
    if (!has('Offer', (a) => a.buyer === boranic))   { await create(boranic,   tid('Offer'), { buyer: boranic,   seller, dealId: DEAL_ID, pricePerUnit: '0.1850', quantity: '120000.0', submittedAt: now }); did.push('Offer:Boranic') }
    if (!has('Offer', (a) => a.buyer === prometheus)) { await create(prometheus, tid('Offer'), { buyer: prometheus, seller, dealId: DEAL_ID, pricePerUnit: '0.1750', quantity: '120000.0', submittedAt: now }); did.push('Offer:Prometheus') }

    // cBTC commitments: Boranic 8 + Meridian 12 = 20/25 cBTC seeded; Prometheus commits via UI
    const registry = await ensureParty('Registry')
    if (!has('Commitment', (a) => a.investor === boranic)) {
      await createMulti([boranic, registry], tid('Commitment'), { admin: registry, investor: boranic, founder: seller, dealId: DEAL_ID, amount: '8.0000', committedAt: now })
      did.push('Commitment:Boranic')
    }
    if (!has('Commitment', (a) => a.investor === meridian)) {
      await createMulti([meridian, registry], tid('Commitment'), { admin: registry, investor: meridian, founder: seller, dealId: DEAL_ID, amount: '12.0000', committedAt: now })
      did.push('Commitment:Meridian')
    }
    // DvP legs: cBTC holding for the investor, equity holding for the founder
    const operator = await ensureParty('AtriumApp')
    const regAcs = await acsOf(registry)
    const hasHolding = (inst: string) => regAcs.some((c) => entityOf(c.templateId) === 'Holding' && c.createArgument.instrument === inst)
    if (!hasHolding('cBTC'))          { await create(registry, tid('Holding'), { admin: registry, owner: meridian, instrument: 'cBTC',          amount: '4200000.0' }); did.push('Leg:cBTC') }
    if (!hasHolding('HALDEN-EQUITY')) { await create(registry, tid('Holding'), { admin: registry, owner: seller,   instrument: 'HALDEN-EQUITY', amount: '120000.0'  }); did.push('Leg:equity') }
    if (!regAcs.some((c) => entityOf(c.templateId) === 'AllocationFactory')) { await create(registry, tid('AllocationFactory'), { admin: registry, users: [meridian, seller, operator] }); did.push('Factory') }

    // Cap table
    const founders = await ensureParty('Founders')
    const esop = await ensureParty('ESOP')
    const hasCert = (holder: string) => regAcs.some((c) => entityOf(c.templateId) === 'ShareCertificate' && c.createArgument.holder === holder)
    if (!hasCert(founders)) { await create(registry, tid('ShareCertificate'), { registrar: registry, holder: founders, instrument: 'HALDEN-EQUITY', shares: '600000.0' }); did.push('Cap:Founders') }
    if (!hasCert(esop))     { await create(registry, tid('ShareCertificate'), { registrar: registry, holder: esop,     instrument: 'HALDEN-EQUITY', shares: '280000.0' }); did.push('Cap:ESOP') }
    if (!hasCert(seller))   { await create(registry, tid('ShareCertificate'), { registrar: registry, holder: seller,   instrument: 'HALDEN-EQUITY', shares: '120000.0' }); did.push('Cap:Halden(stake)') }

    res.json({ seeded: did.length > 0, created: did, founder: displayName(seller), investors: [displayName(boranic), displayName(meridian), displayName(prometheus)], approvers: [displayName(board), displayName(legal), displayName(kycp)] })
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
      remoteIdentity: REMOTE ? { label: REMOTE.label, validator: REMOTE.conn.baseUrl } : null,
    })
  } catch (e) { res.status(503).json({ ok: false, error: (e as Error).message }) }
})

const PORT = Number(process.env.PORT ?? 8080)
app.listen(PORT, () => console.log(`atrium executor (LIVE) on :${PORT} — ledger ${process.env.LEDGER_API_URL ?? 'http://localhost:7575'}`))
