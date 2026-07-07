// Minimal client for the Canton JSON Ledger API v2 (the one `daml sandbox --json-api-port`
// serves, and the same API LocalNet / Seaport hosted validators expose). Verified by hand
// against both the sandbox and the Seaport devnet validator.
//
// CONNECTION-AWARE: every call takes an optional `Conn` (base URL + ledger user + auth). The
// default connection comes from env and preserves the original single-validator behaviour. A
// SECOND connection (a teammate's party on another validator, with THEIR own token) lets us read
// and write as that real identity — the ledger, not our app, enforces what they can do. That's
// the cross-validator, real-per-party-identity story (see docs/TOPOLOGY.md).
import './env.js' // must run first: loads backend/.env before the config consts below

export type Conn = {
  baseUrl: string
  userId: string
  staticToken?: string
  oidc?: { issuer?: string; tokenUrl?: string; clientId?: string; clientSecret?: string; audience?: string; scope?: string }
  _cache?: { value: string; expiresAt: number } // per-connection OIDC token cache
}

export function makeConn(cfg: Partial<Conn> & { baseUrl: string }): Conn {
  return { userId: 'participant_admin', ...cfg }
}

// The default connection (the operator's validator), from env — unchanged behaviour.
export const defaultConn: Conn = makeConn({
  baseUrl: process.env.LEDGER_API_URL ?? 'http://localhost:7575',
  userId: process.env.LEDGER_USER_ID ?? 'participant_admin',
  staticToken: process.env.LEDGER_TOKEN || undefined,
  oidc: {
    issuer: process.env.OIDC_ISSUER, tokenUrl: process.env.OIDC_TOKEN_URL,
    clientId: process.env.OIDC_CLIENT_ID, clientSecret: process.env.OIDC_CLIENT_SECRET,
    audience: process.env.OIDC_AUDIENCE, scope: process.env.OIDC_SCOPE,
  },
})
export const USER_ID = defaultConn.userId // kept for callers that display it

// --- auth (per connection) ---

async function resolveTokenUrl(o: NonNullable<Conn['oidc']>): Promise<string> {
  if (o.tokenUrl) return o.tokenUrl
  const disc = await fetch(`${(o.issuer ?? '').replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!disc.ok) throw new Error(`OIDC discovery failed (${disc.status}); set the token URL explicitly`)
  const j = (await disc.json()) as { token_endpoint?: string }
  if (!j.token_endpoint) throw new Error('OIDC discovery returned no token_endpoint')
  return j.token_endpoint
}

async function bearer(conn: Conn): Promise<string> {
  if (conn.staticToken) return conn.staticToken
  const o = conn.oidc
  if (!o || !(o.issuer || o.tokenUrl)) return '' // local sandbox: no auth
  if (conn._cache && conn._cache.expiresAt > Date.now()) return conn._cache.value
  const tokenUrl = await resolveTokenUrl(o)
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: o.clientId ?? '', client_secret: o.clientSecret ?? '' })
  if (o.audience) form.set('audience', o.audience)
  if (o.scope) form.set('scope', o.scope)
  const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  const text = await res.text()
  if (!res.ok) throw new Error(`OIDC token request failed ${res.status}: ${text.slice(0, 300)}`)
  const j = JSON.parse(text) as { access_token: string; expires_in?: number }
  conn._cache = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 - 30_000 }
  return j.access_token
}

async function api<T>(conn: Conn, path: string, body?: unknown, method = 'POST'): Promise<T> {
  const tok = await bearer(conn)
  const init: RequestInit = {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
  // Hosted validators occasionally drop the TLS connection on a request (gateway resets) —
  // `fetch failed` with no HTTP status. Retry transient network errors; never retry HTTP errors.
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${conn.baseUrl}${path}`, init)
      const text = await res.text()
      if (!res.ok) throw new Error(`Ledger API ${path} → ${res.status}: ${text.slice(0, 400)}`)
      return text ? (JSON.parse(text) as T) : (undefined as T)
    } catch (e) {
      if (!(e instanceof TypeError)) throw e
      lastErr = e
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
  }
  throw new Error(`Ledger API ${path} failed after retries: ${(lastErr as Error)?.message ?? lastErr}`)
}

// --- package (DAR) management — Phase B: install the token-standard + real cBTC/cETH/USDCx DARs ---
// NOTE: verify the exact endpoint for YOUR build. JSON Ledger API v2 `POST /v2/packages` takes raw
// DAR bytes; some deployments expose DAR upload via the participant admin PackageManagement API.
export async function listPackages(conn: Conn = defaultConn): Promise<string[]> {
  const tok = await bearer(conn)
  const res = await fetch(`${conn.baseUrl}/v2/packages`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
  const text = await res.text()
  if (!res.ok) throw new Error(`list packages → ${res.status}: ${text.slice(0, 400)}`)
  const j: any = text ? JSON.parse(text) : {}
  return Array.isArray(j) ? j : (j.packageIds ?? j.package_ids ?? [])
}

export async function uploadDar(darBytes: Uint8Array, conn: Conn = defaultConn): Promise<void> {
  const tok = await bearer(conn)
  const res = await fetch(`${conn.baseUrl}/v2/packages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: darBytes as unknown as BodyInit,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`upload DAR → ${res.status}: ${text.slice(0, 400)}`)
}

export type CreatedEvent = {
  contractId: string
  templateId: string // pkgId:Module:Entity
  createArgument: Record<string, any>
  observers: string[]
  signatories: string[]
}

// --- party + offset helpers (each takes an optional connection) ---

export async function listParties(conn: Conn = defaultConn): Promise<string[]> {
  const r = await api<{ partyDetails: { party: string }[] }>(conn, '/v2/parties', undefined)
  return r.partyDetails.map((p) => p.party)
}

export async function allocatePartyByHint(partyIdHint: string, conn: Conn = defaultConn): Promise<string> {
  const r = await api<{ partyDetails?: { party: string } }>(conn, '/v2/parties', { partyIdHint, identityProviderId: '' })
  if (!r.partyDetails?.party) throw new Error(`party allocation returned no party for hint "${partyIdHint}"`)
  return r.partyDetails.party
}

// Grants `conn`'s ledger user the right to act as `party`. On a hosted validator the token
// authenticates as one user, which must hold CanActAs for every party it submits as. Idempotent.
export async function grantActAs(party: string, conn: Conn = defaultConn): Promise<void> {
  await api(conn, `/v2/users/${encodeURIComponent(conn.userId)}/rights`, {
    userId: conn.userId,
    rights: [{ kind: { CanActAs: { value: { party } } } }],
  })
}

export async function resolveParty(prefix: string, conn: Conn = defaultConn): Promise<string> {
  const all = await listParties(conn)
  const hit = all.find((p) => p.startsWith(prefix + '-') || p.startsWith(prefix + '::') || p === prefix)
  if (!hit) throw new Error(`No party on the ledger starting with "${prefix}"`)
  return hit
}

async function ledgerEnd(conn: Conn): Promise<number> {
  const r = await api<{ offset: number }>(conn, '/v2/state/ledger-end', undefined)
  return r.offset
}

// The active contract set AS SEEN BY `party` on `conn`'s validator. The ledger scopes this to
// what `party` is entitled to — selective disclosure enforced by Canton, not by us.
export async function activeContracts(party: string, conn: Conn = defaultConn): Promise<CreatedEvent[]> {
  const activeAtOffset = await ledgerEnd(conn)
  const rows = await api<any[]>(conn, '/v2/state/active-contracts', {
    filter: { filtersByParty: { [party]: { cumulative: [] } } },
    verbose: false,
    activeAtOffset,
  })
  return rows.map((r) => r?.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean) as CreatedEvent[]
}

export function entityOf(templateId: string): string {
  return templateId.split(':').pop() ?? templateId
}

// --- ledger activity log — a live, in-memory record of every REAL Canton write (its updateId),
// so the UI can show judges transactions landing on-ledger in real time. Newest first, capped. ---
export type LedgerActivity = { updateId: string; summary: string; actor: string; at: string }
const activityLog: LedgerActivity[] = []
export function ledgerActivity(): LedgerActivity[] { return activityLog }

// Surface a real transaction that was submitted OUTSIDE the executor — e.g. an investor's
// CIP-56 token transfer signed in their own Loop wallet. The updateId is a genuine Canton
// update id; we just want it in the same live feed so everyone watches the payment land.
export function recordExternal(updateId: string, summary: string, actor: string) {
  if (!updateId) return
  activityLog.unshift({ updateId, summary, actor, at: new Date().toISOString() })
  if (activityLog.length > 60) activityLog.length = 60
}
function record(txResult: any, summary: string, actor: string) {
  const t = txResult?.transaction
  const updateId: string | undefined = t?.updateId ?? t?.transactionId
  if (!updateId) return
  activityLog.unshift({ updateId, summary, actor, at: new Date().toISOString() })
  if (activityLog.length > 60) activityLog.length = 60
}

// --- command submission (each takes an optional connection) ---

export async function exercise(actAs: string, templateId: string, contractId: string, choice: string, choiceArgument: Record<string, any>, conn: Conn = defaultConn): Promise<any> {
  const r = await api<any>(conn, '/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      userId: conn.userId,
      commandId: `atrium-${choice}-${Date.now()}`,
      actAs: [actAs],
      commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
    },
  })
  record(r, `${choice} · ${entityOf(templateId)}`, actAs)
  return r
}

export async function create(actAs: string, templateId: string, createArguments: Record<string, any>, conn: Conn = defaultConn): Promise<CreatedEvent> {
  const r = await api<any>(conn, '/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      userId: conn.userId,
      commandId: `atrium-create-${Date.now()}`,
      actAs: [actAs],
      commands: [{ CreateCommand: { templateId, createArguments } }],
    },
  })
  record(r, `create · ${entityOf(templateId)}`, actAs)
  return r.transaction.events[0].CreatedEvent as CreatedEvent
}

// Multi-signatory create: submits as all parties in actAs simultaneously.
export async function createMulti(actAs: string[], templateId: string, createArguments: Record<string, any>, conn: Conn = defaultConn): Promise<CreatedEvent> {
  const r = await api<any>(conn, '/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      userId: conn.userId,
      commandId: `atrium-create-${Date.now()}`,
      actAs,
      commands: [{ CreateCommand: { templateId, createArguments } }],
    },
  })
  record(r, `create · ${entityOf(templateId)}`, actAs[0])
  return r.transaction.events[0].CreatedEvent as CreatedEvent
}
