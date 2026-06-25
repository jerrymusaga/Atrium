// The off-chain encrypted blob store + key service (a minimal stand-in for KMS + S3/IPFS).
//
// Documents are encrypted at rest with AES-256-GCM. The plaintext decryption key is released
// ONLY after the executor confirms, against the ledger, that the requester's AccessGrant covers
// the document's tier (see /documents/:docId/content). Canton is the authorization layer; the
// bytes never live on-ledger — only the hash + pointer + the grant that gates the key.
//
// Keys/ivs are derived deterministically from the docId so the ciphertext + hash are stable
// across restarts and match what's recorded on-ledger. In production: a real KMS holds the keys,
// ciphertext sits in S3/IPFS, and the key service is a separate trust boundary from the operator.

import { createCipheriv, createDecipheriv, createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SECRET = process.env.VAULT_SECRET ?? 'atrium-demo-vault-secret'
// The persisted ciphertext store (the "blob store"). Keys are NOT stored — they're derived from
// the secret, so a restart restores the ciphertext and the key service re-derives the keys.
const VAULT_DIR = process.env.VAULT_DIR ?? join(process.cwd(), 'vault')

type Entry = { title: string; tier: number; iv: Buffer; key: Buffer; ciphertext: Buffer; tag: Buffer; hash: string }
const store = new Map<string, Entry>()

const keyFor = (docId: string) => createHash('sha256').update(`${SECRET}:${docId}`).digest() // 32 bytes
const ivFor = (docId: string) => createHash('sha256').update(`iv:${docId}`).digest().subarray(0, 12)

function persist(docId: string, e: Entry) {
  try {
    if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true })
    writeFileSync(join(VAULT_DIR, `${docId}.json`), JSON.stringify({
      title: e.title, tier: e.tier, iv: e.iv.toString('hex'), tag: e.tag.toString('hex'),
      ciphertext: e.ciphertext.toString('base64'), hash: e.hash,
    }))
  } catch { /* best-effort; the vault still works in-memory this session */ }
}

// Restore persisted ciphertext on startup; keys are re-derived, never stored on disk.
export function loadVault() {
  try {
    if (!existsSync(VAULT_DIR)) return
    for (const f of readdirSync(VAULT_DIR)) {
      if (!f.endsWith('.json')) continue
      const docId = f.slice(0, -5)
      const j = JSON.parse(readFileSync(join(VAULT_DIR, f), 'utf8'))
      store.set(docId, {
        title: j.title, tier: Number(j.tier), iv: Buffer.from(j.iv, 'hex'),
        key: keyFor(docId), ciphertext: Buffer.from(j.ciphertext, 'base64'),
        tag: Buffer.from(j.tag, 'hex'), hash: j.hash,
      })
    }
  } catch { /* ignore a corrupt/empty vault dir */ }
}

export function registerDocument(docId: string, title: string, tier: number, plaintext: string) {
  const key = keyFor(docId)
  const iv = ivFor(docId)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const hash = 'sha256:' + createHash('sha256').update(Buffer.concat([ciphertext, tag])).digest('hex')
  const e: Entry = { title, tier, iv, key, ciphertext, tag, hash }
  store.set(docId, e)
  persist(docId, e)
  return { hash, pointer: `s3://atrium-vault/halden/${docId}.enc` }
}

export function docMeta(docId: string) {
  const e = store.get(docId)
  return e ? { title: e.title, tier: e.tier, hash: e.hash, bytes: e.ciphertext.length + e.tag.length } : null
}

// Releases the plaintext (the key + ciphertext stay server-side; only the decrypted text leaves).
export function decryptDocument(docId: string): string | null {
  const e = store.get(docId)
  if (!e) return null
  const d = createDecipheriv('aes-256-gcm', e.key, e.iv)
  d.setAuthTag(e.tag)
  return Buffer.concat([d.update(e.ciphertext), d.final()]).toString('utf8')
}

// Canned demo content — tier 1 is the non-confidential teaser; tier 2 is the sensitive financials.
const TEASER = `HALDEN ROBOTICS — INVESTMENT TEASER (Tier 1)

Project Halden — 12% secondary sale of Halden Robotics, a warehouse-automation company.
Founded 2019 · Oslo & Austin · 140 FTE. Category: autonomous mobile robots (AMR) for 3PL.

Highlights
• 3-year revenue CAGR ~70%; gross margin expanding with the Gen-3 fleet.
• Blue-chip logistics customers; multi-year contracted backlog.
• Stake on offer: 120,000 shares (~12% fully diluted), secondary from a founding investor.

Detailed audited financials, the cap table, and customer contracts are in Tier 2,
available to verified buyers granted deep-diligence access.`

const FINANCIALS = `HALDEN ROBOTICS — AUDITED FINANCIALS (Tier 2 · CONFIDENTIAL)

FY2025 (audited, USD)
  Revenue                 41,800,000
  YoY growth                    +68%
  Gross profit            24,300,000   (58.1% margin)
  Adj. EBITDA              6,900,000   (16.5% margin)
  Net cash                12,400,000
  Contracted backlog      57,000,000

Implied valuation at the offered terms
  Price / share                35.00
  Stake (120,000 sh)       4,200,000
  Implied equity value    35,000,000   (~0.84x FY25 revenue)

If you can read this paragraph, the key service released your AES-256-GCM key —
which it only does because the ledger confirms your AccessGrant covers Tier 2.`

export function seedVault() {
  if (!store.has('teaser')) registerDocument('teaser', 'Investment teaser', 1, TEASER)
  if (!store.has('financials')) registerDocument('financials', 'Audited financials', 2, FINANCIALS)
}
