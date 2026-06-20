// Atrium executor app (stub).
// Serves the same shape the frontend's LedgerClient expects. Returns mock data today;
// the `TODO(ledger)` markers are where the Canton JSON Ledger API and the AllocationV1
// close get wired in at Stage 3.

import express from 'express'

const app = express()
app.use(express.json())

// --- config (Stage 3) ---
const LEDGER_API = process.env.LEDGER_API_URL ?? 'http://localhost:7575' // JSON Ledger API
const OPERATOR_PARTY = process.env.OPERATOR_PARTY ?? 'AtriumApp'

app.get('/health', (_req, res) => res.json({ ok: true, ledgerApi: LEDGER_API, operator: OPERATOR_PARTY }))

// Per-party deal view.
app.get('/deals/:dealId/view', async (req, res) => {
  const party = String(req.query.party ?? '')
  if (!party) return res.status(400).json({ error: 'Pass ?party=<partyId>' })
  // TODO(ledger): query the JSON Ledger API as `party` for Deal, Document, AccessGrant,
  // AccessEvent, Offer, Holding. The ledger already scopes results to what `party` may see,
  // so no manual filtering is needed here — that's the point of Canton.
  res.json({ stub: true, note: 'Replace with a party-scoped Ledger API query.' })
})

// Buyer opens a document -> RecordAccess (appends an AccessEvent).
app.post('/deals/:dealId/access', async (req, res) => {
  const { party, docId } = req.body ?? {}
  if (!party || !docId) return res.status(400).json({ error: 'party and docId required' })
  // TODO(ledger): exercise AccessGrant.RecordAccess(docId) as `party`. To read the doc,
  // fetch the Document as a disclosed contract (include_created_event_blob) and serve the
  // decryption key from the off-chain key service, gated on an active grant.
  res.json({ recorded: true })
})

// Seller accepts the winning offer.
app.post('/deals/:dealId/accept', async (req, res) => {
  const { party, offerId } = req.body ?? {}
  if (!party || !offerId) return res.status(400).json({ error: 'party and offerId required' })
  // TODO(ledger): exercise Offer.Accept as the seller; create the AllocationRequest (2 legs).
  res.json({ accepted: true })
})

// Executor settles payment vs ownership atomically.
app.post('/deals/:dealId/settle', async (_req, res) => {
  // TODO(ledger): for each leg, fetch the execute-transfer choice context from the token
  // registry OpenAPI, DEDUPE disclosed contracts by contract-id, then exercise
  // Allocation_ExecuteTransfer on both legs in ONE command as the operator/executor.
  res.json({ settled: true, atomic: true })
})

const PORT = Number(process.env.PORT ?? 8080)
app.listen(PORT, () => console.log(`atrium executor (stub) on :${PORT} — ledger ${LEDGER_API}`))
