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
| **Daml package** | `atrium-cm` on that validator — 0.9.0 uploaded via Seaport's GitHub build (SDK 3.4.11); the live executor runs the stable 0.8.0 it was verified on (`/health` shows the active id) |

`/health` reports the live validator endpoint and the active package id; the in-app **ledger-activity
feed** shows real on-ledger transactions (Canton `updateId`s) as they land. Every write in the live app —
grants, commitments, approvals, the close — is a real contract on that validator.

## Why Canton (the whole idea)
- **Selective disclosure** (signatories / observers + sub-transaction privacy) **is the data room.**
  Each buyer sees only their tier; rival bidders are invisible; every access is an on-ledger event.
- **Native atomic DvP** **is the close.** The capital leg and the ownership leg settle in one transaction
  or not at all — no escrow, no lawyers, no weeks. Both are absurd on a transparent chain without heavy ZK.

## Real wallets, real money
- **Sign in with your own Loop wallet** (`@fivenorth/loop-sdk`) — Atrium reads your real external Canton
  party and your real on-chain holdings straight from the ledger. No app-managed keys.
- **The investor's payment leg is a real CIP-56 token transfer** you sign in your own wallet; the deal
  settles against it. Live commitments are **wallet-backed only** — a real token transfer or no commit.
- **Self-onboarding invitation** — an investor requests access with their real party id; the founder
  grants it on-ledger (a genuine `AccessGrant` issued to that party).

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
