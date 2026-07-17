// Real Canton wallet sign-in via the Loop SDK (fivenorth — same provider as our devnet
// validator). This is genuine on-chain identity: connecting returns the user's real
// external party id + their real token holdings, read straight from Canton (not our
// backend, not a mock). Custom Atrium contracts still settle through the executor, but
// the *payment leg* of a commit can be moved by this wallet — see getProvider() (the
// seam the real-token phase wires up).
//
// Docs: https://docs.fivenorth.io/loop-sdk  ·  github.com/fivenorth-io/loop-sdk (v0.13.x)
import { loop } from '@fivenorth/loop-sdk'
import { useSyncExternalStore } from 'react'

// The slice of the SDK Provider we use. Kept local so we don't depend on a type the
// package doesn't re-export from its root; the SDK's own Provider is structurally
// assignable to this in the init() callback.
type LoopProvider = {
  party_id: string
  public_key: string
  email?: string
  getHolding(): Promise<Array<{
    instrument_id?: { admin: string; id: string }
    symbol: string
    org_name: string
    decimals: number
    total_unlocked_coin: string
    total_locked_coin: string
    image?: string
  }>>
  transfer(recipient: string, amount: string | number, instrument?: { instrument_admin?: string; instrument_id: string }, options?: unknown): Promise<unknown>
  submitTransaction(payload: unknown, options?: unknown): Promise<unknown>
}

// A holding as Loop reports it from the ledger (one row per instrument the party holds).
export type WalletHolding = {
  admin: string
  id: string
  symbol: string
  orgName: string
  decimals: number
  unlocked: string
  locked: string
  image?: string
}

export type WalletStatus = 'idle' | 'connecting' | 'connected'

export type WalletState = {
  status: WalletStatus
  partyId: string | null
  email?: string
  publicKey?: string
  holdings: WalletHolding[]
  loadingHoldings: boolean
  error: string | null
}

// The network our validator lives on. Overridable for local/testing.
const NETWORK = (import.meta.env.VITE_LOOP_NETWORK ?? 'devnet') as
  | 'devnet' | 'testnet' | 'mainnet' | 'local'

let state: WalletState = {
  status: 'idle',
  partyId: null,
  holdings: [],
  loadingHoldings: false,
  error: null,
}
let provider: LoopProvider | null = null
let initialized = false

const listeners = new Set<() => void>()
function emit() { listeners.forEach((l) => l()) }
function set(patch: Partial<WalletState>) { state = { ...state, ...patch }; emit() }

function onProvider(p: LoopProvider) {
  provider = p
  set({ status: 'connected', partyId: p.party_id, publicKey: p.public_key, email: p.email, error: null })
  void refreshHoldings()
}

// Initialise the SDK exactly once and try to restore a prior session (so a returning
// user stays signed in without re-scanning the QR).
export function initLoop() {
  if (initialized) return
  initialized = true
  loop.init({
    appName: 'Atrium',
    network: NETWORK,
    onAccept: (p) => onProvider(p),
    onReject: () => set({ status: 'idle', error: 'Connection request was declined.' }),
    options: { openMode: 'popup', requestSigningMode: 'popup' },
  })
  // Restore an existing session silently; ignore if there isn't one.
  loop.autoConnect().catch(() => {})
}

export async function connectLoop() {
  initLoop()
  set({ status: 'connecting', error: null })
  try {
    await loop.connect() // opens the QR / wallet approval; onAccept fires on success
  } catch (e) {
    set({ status: state.partyId ? 'connected' : 'idle', error: (e as Error).message })
  }
}

export function disconnectLoop() {
  try { loop.logout() } catch { /* ignore */ }
  provider = null
  set({ status: 'idle', partyId: null, email: undefined, publicKey: undefined, holdings: [], error: null })
}

export async function refreshHoldings() {
  if (!provider) return
  set({ loadingHoldings: true })
  try {
    const rows = await provider.getHolding()
    const holdings: WalletHolding[] = (rows ?? []).map((h) => ({
      admin: h.instrument_id?.admin ?? '',
      id: h.instrument_id?.id ?? h.symbol,
      symbol: h.symbol,
      orgName: h.org_name,
      decimals: h.decimals,
      unlocked: h.total_unlocked_coin,
      locked: h.total_locked_coin,
      image: h.image,
    }))
    set({ holdings, loadingHoldings: false })
  } catch (e) {
    set({ loadingHoldings: false, error: (e as Error).message })
  }
}

// The connected Loop provider — the seam the real-token commit leg uses to move
// USDCx / cBTC / cETH straight from the user's wallet (provider.transfer / submitTransaction).
export function getProvider(): LoopProvider | null { return provider }

export type TransferResult = { updateId?: string; commandId?: string; status?: string; raw: unknown }

// Move a real CIP-56 token from the connected wallet to `recipient`. This is the
// investor's own signature on the money leg — the payment Atrium's Deal settles against.
// `amount` is in display units (e.g. "15" cBTC); `instrument` is the exact InstrumentId
// {admin,id} from the wallet's own holding, so we never hardcode a registry address.
export async function transferToken(
  recipient: string,
  amount: string | number,
  instrument: { admin: string; id: string },
  memo?: string,
): Promise<TransferResult> {
  if (!provider) throw new Error('Connect your Loop wallet first.')
  const res = (await provider.transfer(
    recipient,
    amount,
    { instrument_admin: instrument.admin, instrument_id: instrument.id },
    { executionMode: 'wait', message: memo ?? 'Atrium commitment', estimateTraffic: true },
  )) as Record<string, unknown> | undefined
  // Log the raw response: this is the only place we can see what the registry actually did — a
  // 1-step settle, a pending 2-step TransferInstruction, or a rejection. ("Preserve log" in the
  // console keeps it across the reload the signing popup can cause.)
  console.info('[atrium] loop transfer response', res)
  const r = (res ?? {}) as Record<string, any>
  if (r.error) throw new Error(r.error?.error_message ?? r.error?.message ?? JSON.stringify(r.error))
  void refreshHoldings()
  return { updateId: r.update_id ?? r.updateId, commandId: r.command_id ?? r.commandId, status: r.status, raw: res }
}

// ── React binding ──────────────────────────────────────────────────────────
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
function getSnapshot() { return state }

export function useLoopWallet() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    ...s,
    connect: connectLoop,
    disconnect: disconnectLoop,
    refresh: refreshHoldings,
  }
}
