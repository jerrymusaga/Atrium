// Minimal client for the Canton JSON Ledger API v2 (the one `daml sandbox --json-api-port`
// serves, and the same API LocalNet exposes). Verified by hand against the running sandbox
// before wiring — see docs/CONTEXT.md "Stage 2.5". No auth on local sandbox; LocalNet adds
// a JWT (set LEDGER_TOKEN and it rides through as a Bearer header).

const BASE = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
const USER_ID = process.env.LEDGER_USER_ID ?? 'participant_admin'
const TOKEN = process.env.LEDGER_TOKEN ?? ''

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`
  return h
}

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: headers(),
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
