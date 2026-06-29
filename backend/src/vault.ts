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

type Entry = { title: string; tier: number; iv: Buffer; key: Buffer; ciphertext: Buffer; tag: Buffer; hash: string; mime: string }
const store = new Map<string, Entry>()

const keyFor = (docId: string) => createHash('sha256').update(`${SECRET}:${docId}`).digest() // 32 bytes
const ivFor = (docId: string) => createHash('sha256').update(`iv:${docId}`).digest().subarray(0, 12)

function persist(docId: string, e: Entry) {
  try {
    if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true })
    writeFileSync(join(VAULT_DIR, `${docId}.json`), JSON.stringify({
      title: e.title, tier: e.tier, iv: e.iv.toString('hex'), tag: e.tag.toString('hex'),
      ciphertext: e.ciphertext.toString('base64'), hash: e.hash, mime: e.mime,
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
        tag: Buffer.from(j.tag, 'hex'), hash: j.hash, mime: j.mime ?? 'text/plain',
      })
    }
  } catch { /* ignore a corrupt/empty vault dir */ }
}

// Encrypt and register a document. `data` is UTF-8 text (typed docs) OR a binary Buffer (uploaded
// files, e.g. a PDF); `mime` records the media type so the key service can serve it back correctly.
export function registerDocument(docId: string, title: string, tier: number, data: string | Buffer, mime = 'text/plain') {
  const key = keyFor(docId)
  const iv = ivFor(docId)
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()])
  const tag = cipher.getAuthTag()
  const hash = 'sha256:' + createHash('sha256').update(Buffer.concat([ciphertext, tag])).digest('hex')
  const e: Entry = { title, tier, iv, key, ciphertext, tag, hash, mime }
  store.set(docId, e)
  persist(docId, e)
  return { hash, pointer: `s3://atrium-vault/halden/${docId}.enc` }
}

export function docMeta(docId: string) {
  const e = store.get(docId)
  return e ? { title: e.title, tier: e.tier, hash: e.hash, bytes: e.ciphertext.length + e.tag.length, mime: e.mime } : null
}

// Re-derive the content hash from the ciphertext that is ON DISK RIGHT NOW — independent of the
// hash recorded at registration. The /verify endpoint compares this against the immutable
// `Document.contentHash` on Canton: if a blob was altered off-chain, the two diverge and the
// ledger catches it. This is the cryptographic link between the off-chain vault and the ledger.
export function recomputeHash(docId: string): string | null {
  const e = store.get(docId)
  if (!e) return null
  return 'sha256:' + createHash('sha256').update(Buffer.concat([e.ciphertext, e.tag])).digest('hex')
}

// DEMO ONLY — simulate an off-chain tamper: flip one ciphertext byte (and re-persist) WITHOUT
// touching the recorded hash. The next /verify then recomputes a different hash than the ledger
// holds → detected. Idempotent toggle: calling twice restores the original bytes. The on-ledger
// `contentHash` is never changed (it can't be — it's immutable), which is exactly the point.
export function tamperDocument(docId: string): boolean {
  const e = store.get(docId)
  if (!e || e.ciphertext.length === 0) return false
  e.ciphertext = Buffer.from(e.ciphertext)
  e.ciphertext[0] = e.ciphertext[0] ^ 0xff
  persist(docId, e)
  return true
}

// Releases the plaintext TEXT (the key + ciphertext stay server-side). Used by the AI copilot,
// which only reasons over text documents.
export function decryptDocument(docId: string): string | null {
  const e = store.get(docId)
  if (!e) return null
  const d = createDecipheriv('aes-256-gcm', e.key, e.iv)
  d.setAuthTag(e.tag)
  return Buffer.concat([d.update(e.ciphertext), d.final()]).toString('utf8')
}

// Releases the decrypted BYTES + media type — for serving uploaded files (PDF/image/…) back to an
// authorized viewer. The key service only reaches here after the ledger confirms the grant.
export function readDocument(docId: string): { buffer: Buffer; mime: string } | null {
  const e = store.get(docId)
  if (!e) return null
  const d = createDecipheriv('aes-256-gcm', e.key, e.iv)
  d.setAuthTag(e.tag)
  return { buffer: Buffer.concat([d.update(e.ciphertext), d.final()]), mime: e.mime }
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

const CAP_TABLE_CSV = `Holder,Shares,Ownership %,Class
Founders,600000,60.0%,Common
ESOP Pool,280000,28.0%,Options
Series A (on offer),120000,12.0%,Preferred
Total,1000000,100.0%,`

// Build a small, valid single-page PDF (Helvetica) from ASCII lines, as a Buffer — a real
// openable file in the data room with no binary asset to ship.
function makePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  let content = `BT\n/F1 15 Tf\n56 748 Td\n(${esc(title)}) Tj\n/F1 10 Tf\n0 -26 Td\n`
  for (const ln of lines) content += `(${esc(ln)}) Tj\n0 -15 Td\n`
  content += 'ET'
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => { pdf += `${String(off).padStart(10, '0')} 00000 n \n` })
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

const TERM_SHEET_PDF = makePdf('HALDEN ROBOTICS - SERIES A TERM SHEET (CONFIDENTIAL)', [
  '',
  'Issuer            Halden Robotics AS',
  'Round             Series A (Primary)',
  'Raise             25 cBTC',
  'Instrument        HALDEN-EQUITY (Preferred)',
  'Stake on offer    120,000 shares (~12% fully diluted)',
  'Pre-money         ~183 cBTC',
  'Liquidation pref  1.0x, non-participating',
  'Board             1 investor seat',
  'Pro-rata rights   Yes, for the lead investor',
  '',
  'Closing conditions',
  '  - Raise target met (25 cBTC committed)',
  '  - Board + Legal + Compliance approval on-ledger',
  '  - Settlement: atomic cBTC <-> equity on Canton',
  '',
  'This term sheet is non-binding except for the confidentiality and',
  'exclusivity provisions. Tier: Legal.',
])

// A signed governance resolution as a real PDF — produced when a Board/Legal/Compliance role
// signs off. The bytes are encrypted in the vault and their hash is anchored on-ledger (as a
// Document), so the approval's signed artifact is tamper-evident exactly like any other doc.
export function resolutionPdf(role: string, signer: string, dealTitle: string, whenISO: string, envelopeId: string): Buffer {
  return makePdf(`HALDEN ROBOTICS - ${role} RESOLUTION`, [
    '',
    `Deal      ${dealTitle}`,
    `Resolution`,
    `  The ${role} hereby approves the closing of the Series A on the`,
    `  terms in the Series A term sheet, subject to the remaining`,
    `  on-ledger closing conditions.`,
    '',
    `Signed    ${signer}`,
    `Role      ${role}`,
    `Date      ${whenISO}`,
    `Envelope  ${envelopeId}`,
    '',
    `Recorded as an on-ledger Approval contract on Canton Network. This`,
    `signed resolution is encrypted in the data room and its hash is`,
    `anchored on-ledger for tamper-evidence.`,
  ])
}

export function seedVault() {
  if (!store.has('teaser')) registerDocument('teaser', 'Investment teaser', 1, TEASER)
  if (!store.has('financials')) registerDocument('financials', 'Audited financials', 2, FINANCIALS)
  if (!store.has('cap-table')) registerDocument('cap-table', 'Cap table', 2, CAP_TABLE_CSV, 'text/csv')
  if (!store.has('term-sheet')) registerDocument('term-sheet', 'Series A term sheet', 3, TERM_SHEET_PDF, 'application/pdf')
}
