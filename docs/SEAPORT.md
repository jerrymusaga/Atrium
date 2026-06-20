# Running Atrium on Seaport (hosted Canton validators)

[Seaport](https://app.devnet.seaport.to) is a browser IDE + hosted Canton/Daml platform: write/build
Daml, deploy the DAR to a hosted **validator**, allocate parties, and exercise choices. Each validator
exposes a **Canton JSON Ledger API v2** — the exact API Atrium's executor already drives. This unblocks
running Atrium on a **real, hosted Canton network with no local RAM cost** (vs. the ~16 GB LocalNet — see
`docs/STAGE3.md`).

**Scope:** per the Seaport guide, the devnet validators are a hosted Canton ledger (a shared "5n sandbox"
for hackathon teams) — no Amulet/Canton-Coin faucet is mentioned. So this gives a **hosted, multi-validator
Stage 2.5**: real separate participant nodes proving selective disclosure across parties, with Atrium's
**mock `Atrium.Dvp` cash leg** still standing in for Amulet. Full Stage 3 (real Canton Coin leg) additionally
needs a Splice/Amulet-enabled validator + faucet.

## One-time deploy
1. **Build the DAR for the validator's runtime.** Check the Seaport validator's Daml/runtime version; set
   `ledger/daml.yaml` `sdk-version` to match, then `daml build`. (Templates use only stable stdlib, so no code
   change is expected; `make ledger-test` should stay green.)
2. **Upload `ledger/.daml/dist/atrium-0.1.0.dar`** to your Seaport validator (Seaport IDE "deploy DAR", or the
   JSON API `/v2/packages` upload).
3. **Onboard the parties** `Halden`, `Boranic`, `Meridian` on the validator. The executor's `ensureParty`
   already allocates via `/v2/parties` (it now goes through the OIDC auth path), and the seller "Invite a buyer"
   flow allocates new parties at runtime. Seed the demo contracts with a `setupDemo`-equivalent, or just drive
   it live from the UI.

## Point the executor at Seaport
Everything is config — no code change. In `backend/.env` (see `.env.example`):
```bash
LEDGER_API_URL=https://<your-validator>.devnet.seaport.to/...   # the validator's JSON Ledger API v2 base
LEDGER_USER_ID=<validator/app user id>

# auth — OIDC client-credentials (Loop DevNet wallet issuer):
OIDC_ISSUER=https://<issuer>          # or set OIDC_TOKEN_URL directly
OIDC_CLIENT_ID=<client id>
OIDC_CLIENT_SECRET=<client secret>
# OIDC_AUDIENCE / OIDC_SCOPE if the issuer requires them
```
…or, to test fast, skip OIDC and paste a token: `LEDGER_TOKEN=<JWT from the Seaport session>`.

Then:
```bash
npm --prefix backend run dev                # executor now talks to Seaport
VITE_LIVE=1 npm --prefix frontend run dev   # the UI, live on the hosted network
```
`GET http://localhost:8080/health` should report Seaport's `ledgerApi` URL and a party count > 0.

## What I need from the Seaport dashboard to finish the wiring
1. **JSON Ledger API v2 base URL** of your validator.
2. **OIDC**: issuer (or token URL), client id/secret, and any required audience/scope — or a session JWT.
3. **User id** the validator expects, and confirmation parties can be allocated via `/v2/parties` (vs. pre-created).
4. Whether the validator has **Amulet/Canton Coin** (decides Stage 2.5-hosted vs. full Stage 3).

## Notes
- Seaport also documents a TS client, `@c7/ledger`, for browser→ledger calls. Atrium keeps the **executor**
  in the middle (it holds the operator party and composes party-scoped views), so we use our own JSON v2 client
  in `backend/src/ledgerApi.ts`. `@c7/ledger` is an option if you later want the frontend to talk to a validator
  directly.
- Auth precedence in the executor: `LEDGER_TOKEN` (static) → OIDC client-credentials → none (local sandbox).
