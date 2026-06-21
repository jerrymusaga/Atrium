# Atrium

**The data room that closes.** A privacy-preserving M&A / deal-execution app on Canton Network:
the same private, permissioned object you do due diligence on is the one that settles —
payment vs tokenized ownership, atomically, in one transaction.

Built for the Encode Club **Build on Canton** hackathon. Full background, design rationale, and
the honest production boundary are in **`docs/`** — start with `docs/CONTEXT.md`.

## Why Canton (the whole idea)
- **Selective disclosure** (signatories / observers + sub-transaction privacy) **is the data room.**
  Each buyer sees only their tier; rival bidders are invisible; every access is an on-ledger event.
- **Native atomic DvP** **is the close.** The cash leg and the ownership leg settle in one transaction
  or not at all — no escrow, no lawyers, no weeks. Both are absurd on a transparent chain without heavy ZK.

## What runs today

| Part | Runs now? | How |
|---|---|---|
| `frontend/` demo UI | ✅ standalone | in-browser mock ledger — `make frontend` |
| `ledger/` Daml — privacy + DvP proofs | ✅ Daml SDK | `make ledger-test` → 4 scripts green |
| `backend/` executor on a **real Canton ledger** | ✅ no Docker | `make sandbox` then `make backend` |
| Frontend ↔ live executor, end-to-end | ✅ no Docker | `make sandbox` · `make backend` · `make frontend-live` |
| On **hosted Canton validators** (Seaport) | ⚙️ config | OIDC auth wired — see `docs/SEAPORT.md` |
| Real **Amulet / Canton Coin** cash leg | ⛔ Stage 3 | needs a Splice validator (LocalNet ≥16 GB, or a Splice-enabled host) |

Both differentiators are **ledger-verified, not asserted**: `testPrivacyProjection` proves rivals are
invisible and the access trail is scoped per party; `testAtomicDvP` + `testAtomicityHolds` prove the close
is atomic and all-or-nothing. The executor then demonstrates the same on a live ledger.

## Quick start

**The demo (no ledger, no Docker):**
```bash
make frontend           # → http://localhost:5173
```
Switch the **viewing lens** (top-left) between Halden / Boranic / Meridian / Regulator and watch the same
deal redact and reveal per party. As the seller: **invite a buyer** (onboards a party + grant), **accept**
a bid, and **settle** — an animated atomic swap. Hit **"Stress-test: pull a leg"** to watch the close
revert with nothing moved. Switch to the **Regulator** lens to attest the close matched the recorded bid
without tier-2 access.

**The live stack (real Canton ledger via `daml sandbox`, no Docker), 3 terminals:**
```bash
make sandbox            # Canton + JSON Ledger API v2 on :7575, seeded with setupDemo
make backend            # executor drives the real ledger on :8080
make frontend-live      # the UI, VITE_LIVE=1, against the executor
```

**The proofs:**
```bash
make ledger-test        # setupDemo · testPrivacyProjection · testAtomicDvP · testAtomicityHolds
```

## Layout
```
atrium/
  ledger/     Daml package — DealRoom (deal/docs/grants/audit/offers) + atomic DvP, with proof scripts
  frontend/   React + TS console — viewer lens, redacted docs, audit trail, dynamic onboarding, the close
  backend/    Executor app — holds the operator party, drives party-scoped views + the atomic close over
              the Canton JSON Ledger API v2 (sandbox, LocalNet, or a hosted Seaport validator)
  docs/       CONTEXT.md (handoff) · ASSESSMENT.md (deep dive) · USER_STORY.md
              STAGE3.md (LocalNet runbook) · SEAPORT.md (hosted-validator deploy)
```

## Where it's heading
Graduate the **cash leg** from Atrium's mock `Holding` to real Splice **`AllocationV1` / Amulet** (Canton
Coin) — the privacy + diligence half is unchanged; only the cash asset becomes real. Run it either on a
hosted Splice validator (`docs/SEAPORT.md`) or LocalNet (`docs/STAGE3.md`). **Gate:** Stage 3 green →
proceed; red → fall back to a sealed-bid issuance (same atomic close, one privacy surface).

## Honest boundary
Production-valid patterns and current libraries (the same DvP machinery as Tradeweb's live Treasury repo) —
but not a production system. Gap to production: a Daml security audit (observer-list errors silently leak),
a legal ownership wrapper, real KYC, hardened key management, a real registry service. Documents live
encrypted **off-chain**; Canton is the authorization + audit layer, not the vault. See `docs/ASSESSMENT.md` §6.
