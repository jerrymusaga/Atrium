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

## Getting access — step by step
Do this once to obtain the four values the executor needs. Labels may differ slightly in the Seaport UI;
the goal is to capture the connection + auth details for your validator.

1. **Sign in.** Go to https://app.devnet.seaport.to and authenticate with the **Loop DevNet wallet**
   (create the wallet first if you don't have one). For a hackathon team, ask for access to the shared
   **"5n sandbox"** validator, or create an **Organization** (App Provider) which provisions a validator.
2. **Find your validator's connection details.** Open the validator's settings / "connect" / API panel.
   Capture the **JSON Ledger API v2 base URL** (e.g. `https://<validator>.devnet.seaport.to`). → `LEDGER_API_URL`
3. **Capture auth.** The validator sits behind an **OIDC issuer**. In the validator/auth settings, note the
   **OIDC Issuer URL** and create/copy a **client id + secret** (a service account / API client), plus any
   **audience/scope** it lists. → `OIDC_ISSUER` (or `OIDC_TOKEN_URL`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
   - *Fast alternative for testing:* open browser devtools → Network on any ledger call → copy the
     `Authorization: Bearer …` value → set `LEDGER_TOKEN` and skip OIDC for now.
4. **User id.** Note the ledger **user id** the validator expects for your app (often shown beside the API
   details or the app-user registration). → `LEDGER_USER_ID`
5. **Amulet?** Check whether the validator exposes **Canton Coin / a faucet** (a wallet balance or
   "tap"/faucet action). Yes → full Stage 3 is reachable; no → hosted Stage 2.5 (mock cash leg).
6. **Deploy the DAR** (`ledger/.daml/dist/atrium-0.1.0.dar`) via the Seaport IDE's deploy, or `/v2/packages`.
7. **For multi-validator** (see `docs/TOPOLOGY.md`): each teammate repeats 1–4 on their own personal
   validator, allocates their **buyer party**, and shares their **party id** + **JSON API URL**. Confirm all
   validators share one synchronizer.

Then fill `backend/.env` (template in `.env.example`) and run the executor + `frontend-live`.

## Paste these back and I'll finish the wiring
1. **JSON Ledger API v2 base URL** of your validator.
2. **OIDC**: issuer (or token URL), client id/secret, and any required audience/scope — or a session JWT.
3. **User id** the validator expects, and confirmation parties can be allocated via `/v2/parties` (vs. pre-created).
4. Whether the validator has **Amulet/Canton Coin** (decides Stage 2.5-hosted vs. full Stage 3).

## Cross-node: vetting the package on a teammate's participant
To invite a buyer whose party lives on **another** validator (true multi-node privacy), that
participant must also have the Atrium DAR uploaded + vetted — Canton requires every participant
hosting a stakeholder to know the package. Symptom if it's missing, when the seller tries to grant
the remote party: `NO_SYNCHRONIZER_FOR_SUBMISSION … Participant PAR::… has not vetted <pkgId>`.

On the buyer's validator (build the identical DAR first — `cd ledger && daml build`):
```bash
# get a token for THAT validator (its own OIDC client), then:
curl -X POST '<their-validator-ledger-api>/v2/packages' \
  -H "Authorization: Bearer <their-token>" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @ledger/.daml/dist/atrium-0.1.0.dar
```
…or deploy it from the Seaport IDE against that validator. Both participants must share a
synchronizer (they do on the Seaport devnet — `global-domain::…`). Once vetted, the seller's
`POST /deals/:id/invite {"buyerParty":"<their full party id>","tier":1}` routes cross-node, and the
buyer sees their scoped projection from their own node.

## Notes
- Seaport also documents a TS client, `@c7/ledger`, for browser→ledger calls. Atrium keeps the **executor**
  in the middle (it holds the operator party and composes party-scoped views), so we use our own JSON v2 client
  in `backend/src/ledgerApi.ts`. `@c7/ledger` is an option if you later want the frontend to talk to a validator
  directly.
- Auth precedence in the executor: `LEDGER_TOKEN` (static) → OIDC client-credentials → none (local sandbox).
