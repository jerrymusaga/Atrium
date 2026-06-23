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

const SECRET = process.env.VAULT_SECRET ?? 'atrium-demo-vault-secret'

type Entry = { title: string; tier: number; iv: Buffer; key: Buffer; ciphertext: Buffer; tag: Buffer; hash: string }
const store = new Map<string, Entry>()

const keyFor = (docId: string) => createHash('sha256').update(`${SECRET}:${docId}`).digest() // 32 bytes
const ivFor = (docId: string) => createHash('sha256').update(`iv:${docId}`).digest().subarray(0, 12)

export function registerDocument(docId: string, title: string, tier: number, plaintext: string) {
  const key = keyFor(docId)
  const iv = ivFor(docId)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const hash = 'sha256:' + createHash('sha256').update(Buffer.concat([ciphertext, tag])).digest('hex')
  store.set(docId, { title, tier, iv, key, ciphertext, tag, hash })
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
  registerDocument('teaser', 'Investment teaser', 1, TEASER)
  registerDocument('financials', 'Audited financials', 2, FINANCIALS)
}
