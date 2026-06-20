// Minimal client for the Canton JSON Ledger API v2 (the one `daml sandbox --json-api-port`
// serves, and the same API LocalNet exposes). Verified by hand against the running sandbox
// before wiring — see docs/CONTEXT.md "Stage 2.5". No auth on local sandbox; LocalNet adds
// a JWT (set LEDGER_TOKEN and it rides through as a Bearer header).

const BASE = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
const USER_ID = process.env.LEDGER_USER_ID ?? 'participant_admin'

// Auth, in order of precedence:
//   1. LEDGER_TOKEN          — a static Bearer JWT (sandbox needs none; paste one to test fast)
//   2. OIDC client-credentials — OIDC_TOKEN_URL (or OIDC_ISSUER for discovery) + CLIENT_ID/SECRET.
//      This is the Seaport / hosted-validator path: the validator's JSON Ledger API v2 sits
//      behind an OIDC issuer (Loop DevNet wallet). Tokens are fetched and cached until expiry.
//   3. none                  — local `daml sandbox`.
const STATIC_TOKEN = process.env.LEDGER_TOKEN ?? ''
const OIDC = {
  issuer: process.env.OIDC_ISSUER ?? '',
  tokenUrl: process.env.OIDC_TOKEN_URL ?? '',
  clientId: process.env.OIDC_CLIENT_ID ?? '',
  clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
  audience: process.env.OIDC_AUDIENCE ?? '',
  scope: process.env.OIDC_SCOPE ?? '',
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function resolveTokenUrl(): Promise<string> {
  if (OIDC.tokenUrl) return OIDC.tokenUrl
  // OpenID Connect discovery off the issuer.
  const disc = await fetch(`${OIDC.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!disc.ok) throw new Error(`OIDC discovery failed (${disc.status}); set OIDC_TOKEN_URL explicitly`)
  const j = (await disc.json()) as { token_endpoint?: string }
  if (!j.token_endpoint) throw new Error('OIDC discovery returned no token_endpoint')
  return j.token_endpoint
}

async function fetchOidcToken(): Promise<string> {
  const tokenUrl = await resolveTokenUrl()
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: OIDC.clientId, client_secret: OIDC.clientSecret })
  if (OIDC.audience) form.set('audience', OIDC.audience)
  if (OIDC.scope) form.set('scope', OIDC.scope)
  const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  const text = await res.text()
  if (!res.ok) throw new Error(`OIDC token request failed ${res.status}: ${text.slice(0, 300)}`)
  const j = JSON.parse(text) as { access_token: string; expires_in?: number }
  cachedToken = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 - 30_000 }
  return j.access_token
}

async function bearer(): Promise<string> {
  if (STATIC_TOKEN) return STATIC_TOKEN
  if (!(OIDC.issuer || OIDC.tokenUrl)) return '' // local sandbox: no auth
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  return fetchOidcToken()
}

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const tok = await bearer()
  if (tok) h['Authorization'] = `Bearer ${tok}`
  return h
}

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: await headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Ledger API ${path} → ${res.status}: ${text.slice(0, 400)}`)
  return text ? (JSON.parse(text) as T) : (undefined as T)
}

export type CreatedEvent = {
  contractId: string
  templateId: string // pkgId:Module:Entity
  createArgument: Record<string, any>
  observers: string[]
  signatories: string[]
}

// --- party + offset helpers ---

export async function listParties(): Promise<string[]> {
  const r = await api<{ partyDetails: { party: string }[] }>('/v2/parties', undefined)
  return r.partyDetails.map((p) => p.party)
}

// Allocates a party from a readable hint; returns the full minted party id. Goes through the
// shared auth path, so it works against the sandbox and an OIDC-protected hosted validator alike.
export async function allocatePartyByHint(partyIdHint: string): Promise<string> {
  const r = await api<{ partyDetails?: { party: string } }>('/v2/parties', { partyIdHint, identityProviderId: '' })
  if (!r.partyDetails?.party) throw new Error(`party allocation returned no party for hint "${partyIdHint}"`)
  return r.partyDetails.party
}

// Resolves the full party id (e.g. "Halden-d4d9::1220…") from the readable prefix the
// demo uses ("Halden"). LocalNet/sandbox both mint a namespace suffix per party.
export async function resolveParty(prefix: string): Promise<string> {
  const all = await listParties()
  const hit = all.find((p) => p.startsWith(prefix + '-') || p.startsWith(prefix + '::') || p === prefix)
  if (!hit) throw new Error(`No party on the ledger starting with "${prefix}" (have: ${all.join(', ')})`)
  return hit
}

async function ledgerEnd(): Promise<number> {
  const r = await api<{ offset: number }>('/v2/state/ledger-end', undefined)
  return r.offset
}

// The active contract set AS SEEN BY `party`. The ledger scopes this to what `party` is
// entitled to — selective disclosure is enforced here, not by us. That's the whole point.
export async function activeContracts(party: string): Promise<CreatedEvent[]> {
  const activeAtOffset = await ledgerEnd()
  const rows = await api<any[]>('/v2/state/active-contracts', {
    filter: { filtersByParty: { [party]: { cumulative: [] } } },
    verbose: false,
    activeAtOffset,
  })
  return rows
    .map((r) => r?.contractEntry?.JsActiveContract?.createdEvent)
    .filter(Boolean) as CreatedEvent[]
}

export function entityOf(templateId: string): string {
  return templateId.split(':').pop() ?? templateId
}

// --- command submission ---

export async function exercise(
  actAs: string,
  templateId: string,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, any>,
): Promise<any> {
  return api('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      userId: USER_ID,
      commandId: `atrium-${choice}-${Date.now()}`,
      actAs: [actAs],
      commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
    },
  })
}

export async function create(
  actAs: string,
  templateId: string,
  createArguments: Record<string, any>,
): Promise<CreatedEvent> {
  const r = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      userId: USER_ID,
      commandId: `atrium-create-${Date.now()}`,
      actAs: [actAs],
      commands: [{ CreateCommand: { templateId, createArguments } }],
    },
  })
  return r.transaction.events[0].CreatedEvent as CreatedEvent
}
