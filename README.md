# Atrium

**The data room that closes.** A privacy-preserving private-capital-markets app on Canton Network:
the same private, permissioned deal you run due diligence on is the one that settles — an investor's
capital vs tokenized ownership, atomically, in one transaction.

Built for the Encode Club **Build on Canton** hackathon.

## ▶ Live on Canton devnet

Atrium is deployed and running on a real Canton validator — not LocalNet, not a sandbox mock.

| | |
|---|---|
| **App** | https://atrium-omega.vercel.app  (green "● LIVE on Canton" pill) |
| **Backend / executor** | https://atrium-production-4de8.up.railway.app/health → `{ ok: true, … }` |
| **Validator** | FiveNorth **Seaport** devnet, Encode org — `ledger-api.validator.devnet.sandbox.fivenorth.io` |
| **Daml package** | `atrium-cm` 0.9.0 — `e20be214a2147aa9509f662f18da7e159b5ab9bfdaaca08215d3269f13e68db5`, deployed via Seaport's GitHub build (SDK 3.4.11); the live executor runs it (`/health` shows the active id) |

`/health` reports the live validator endpoint and the active package id; the in-app **ledger-activity
feed** shows real on-ledger transactions (Canton `updateId`s) as they land. Every write in the live app —
grants, commitments, approvals, the close — is a real contract on that validator.

## Verify this yourself
1. **The package is really on devnet** — `atrium-cm` 0.9.0, id `e20be214a2147aa9509f662f18da7e159b5ab9bfdaaca08215d3269f13e68db5`, deployed to the Encode org's Seaport validator.
2. **The deployed templates really work there** — create a `Deal` or `Commitment` against that package directly on the validator (independent of this app), and it commits.
3. **The live app is really talking to that validator** — `GET /health` returns the validator endpoint and the active package id.
4. **The transactions are real** — the in-app **ledger-activity feed** shows genuine Canton `updateId`s as each contract lands (`GET /activity`).

**You will *not* find this deal on a public block explorer — and that is the point.** Canton projects a
contract only to its stakeholders, so an unrelated party cannot browse Halden's cap table or bid book.
On a transparent chain both would be public to the world. Here, privacy is the ledger's guarantee, not a
UI setting — which is precisely why the diligence *and* the settlement can live on the same ledger.

## Why Canton (the whole idea)
- **Selective disclosure** (signatories / observers + sub-transaction privacy) **is the data room.**
  Each buyer sees only their tier; rival bidders are invisible; every access is an on-ledger event.
- **Native atomic DvP** **is the close.** The capital leg and the ownership leg settle in one transaction
  or not at all — no escrow, no lawyers, no weeks. Both are absurd on a transparent chain without heavy ZK.

## Wallet integration (built, off by default)
Atrium integrates the **Loop wallet** (`@fivenorth/loop-sdk`) — sign in with your own external Canton
party, read your real on-chain holdings straight from the ledger, and pay an investment leg as a real
**CIP-56 token transfer you sign yourself**. It ships behind **`VITE_WALLET=1`**.

It is **off in the public demo on purpose**: the deal room must be drivable end-to-end by anyone who
doesn't have a Canton wallet. With it off, commitments are recorded on-ledger by the executor for the
party holding the lens — the ledger guarantees (disclosure, atomicity, the close gate) are identical.

Honest status: granting a **cross-participant** Loop party on-ledger additionally requires the Atrium
package to be *vetted on that wallet's participant* — an infra step outside this repo.

## What's ledger-verified
Both differentiators are **proven in Daml, not asserted**:
- `testPrivacyProjection` — rivals are invisible; the access trail is scoped per party.
- `testAtomicDvP` + `testAtomicityHolds` — the close is atomic and all-or-nothing (pull a leg → nothing moves).
- `testConditionalClose` — the close gate fires only when raise target, KYC, and all required approvals are met.

## Quick start

**The demo (no ledger, no Docker):**
```bash
make frontend           # → http://localhost:5173
```
Switch the **viewing lens** (top-left) between Halden / Boranic / Meridian / Regulator and watch the same
deal redact and reveal per party. As the founder: **invite an investor**, watch commitments fill the raise,
collect **board / legal / compliance** approvals, and **close** — an atomic swap of capital for equity. Hit
**"Stress-test: pull a leg"** to watch the close revert with nothing moved. Switch to the **Regulator** lens
to attest the close matched the record without tier-2 access.

**The live stack (real Canton ledger via `daml sandbox`), 3 terminals:**
```bash
make sandbox            # Canton + JSON Ledger API v2 on :7575, seeded with setupDemo
make backend            # executor drives the real ledger on :8080
make frontend-live      # the UI, VITE_LIVE=1, against the executor
```

**The proofs:**
```bash
make ledger-test        # setupDemo · privacy · atomic DvP · atomicity · conditional close
```

## Layout
```
atrium/
  ledger/     Daml package — DealRoom (deal/docs/grants/audit/offers/commitments/approvals)
              + atomic DvP (Dvp, mirrors the Splice Token Standard) + Equity cap table, with proof scripts
  frontend/   React + TS console — viewer lens, redacted docs, audit trail, Loop wallet sign-in, the close
  backend/    Executor app — party-scoped views + the atomic close over the Canton JSON Ledger API v2
              (sandbox, LocalNet, or the hosted Seaport validator)
```

## Honest boundary
Production-valid patterns and current libraries — but not yet a production system. The investor payment
leg is a real CIP-56 transfer signed in Loop; the equity/settlement leg uses bespoke templates that mirror
the Splice Token Standard (CIP-56) so the model is self-contained. Gap to production: a Daml security audit
(observer-list mistakes silently leak), a legal ownership wrapper, real KYC, hardened key management, and a
real registry service. Documents live encrypted **off-chain** — Canton is the authorization + audit layer,
not the vault (integrity is provable: every blob's hash is anchored on-ledger).
