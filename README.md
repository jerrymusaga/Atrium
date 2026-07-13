<div align="center">

# Atrium

### The data room that closes.

**A private capital-markets operating system on Canton Network** — the same permissioned deal you run
diligence on is the one that atomically settles capital for tokenized ownership, in a single transaction.

[**▶ Live app**](https://atrium-omega.vercel.app) · [**Backend health**](https://atrium-production-4de8.up.railway.app/health) · Built for the Encode Club **Build on Canton** hackathon

</div>

---

## The problem

A private funding round runs in two worlds. Diligence happens in one system; settlement happens in five
others — a virtual data room for documents (Datasite, Intralinks), DocuSign for approvals, an escrow agent
for the money, Carta for the cap table, and lawyers to reconcile it all.

None of them share a source of truth:

- **Access control is a promise, not a fact.** One misconfigured permission and a rival sees a bid or a
  tier-2 financial. There is no enforced, auditable record of who saw what.
- **Cash and ownership move separately.** For days, one side has paid and the other hasn't delivered —
  that's settlement risk, and the legal hours to manage it never go away.
- **There is no proof.** The data room you diligenced and the thing that actually settled are different
  systems. Nothing cryptographically ties the close to the terms that were agreed.

Weeks of delay. Escrow fees, VDR subscriptions, legal bills. And counsel's word as the only guarantee.

## The solution

Atrium puts both halves on **one Canton ledger**:

- **Selective disclosure *is* the data room.** Each party sees only the tier their on-ledger grant
  authorizes. Rival investors are invisible to each other. Every document open writes an immutable
  on-chain access event. The *ledger* enforces this — not the UI.
- **Atomic delivery-versus-payment *is* the close.** Capital and tokenized equity settle in a single
  transaction, or nothing moves at all. No escrow agent, no settlement window, no counterparty risk.
- **A conditional close gate.** The deal cannot settle unless the raise target is met, KYC is valid, and
  every required approval (Board / Legal / Compliance) is on-ledger.

Both properties are impossible on a transparent chain — you cannot publish a cap table and a bid book to
the world. Canton is where privacy *and* atomic settlement coexist.

## ▶ Live on Canton devnet

This is deployed and running on a real Canton validator — not LocalNet, not a mock.

| | |
|---|---|
| **App** | https://atrium-omega.vercel.app (green "● LIVE on Canton" pill) |
| **Backend / executor** | https://atrium-production-4de8.up.railway.app/health → `{ ok: true, … }` |
| **Validator** | FiveNorth **Seaport** devnet, Encode organisation — `ledger-api.validator.devnet.sandbox.fivenorth.io` |
| **Daml package** | `atrium-cm` 0.9.0 — `e20be214a2147aa9509f662f18da7e159b5ab9bfdaaca08215d3269f13e68db5` |
| **Demo video** | _(add link)_ |

## Verify this yourself

1. **The package is really on devnet** — `atrium-cm` 0.9.0 (`e20be214…`) is deployed to the Encode org's
   Seaport validator.
2. **The deployed templates really work there** — create a `Deal` or `Commitment` against that package
   directly on the validator, independent of this app, and it commits.
3. **The live app really talks to that validator** — `GET /health` returns the validator endpoint and the
   active package id.
4. **The transactions are real** — the in-app **ledger-activity feed** shows genuine Canton `updateId`s as
   each contract lands (`GET /activity`).

> **You will not find this deal on a public block explorer — and that is the point.** Canton projects a
> contract only to its stakeholders, so an unrelated party cannot browse Halden's cap table or bid book.
> On a transparent chain both would be public. Here, privacy is a ledger guarantee, not a UI setting —
> which is exactly why diligence and settlement can finally live on the same ledger.

## Features

| Feature | What it does |
|---|---|
| **Tier-gated data room** | Documents are encrypted off-chain; their hash + tier are recorded on-ledger. A party sees a document only if their `AccessGrant` covers its tier. |
| **On-ledger invitation** | Inviting an investor allocates a **real Canton party**, issues an `AccessGrant` at a chosen tier, and attests their KYC. |
| **Immutable audit trail** | Every document open exercises `RecordAccess`, writing an `AccessEvent` — who saw what, when. Not an editable log. |
| **Tier-bounded AI copilot** | A diligence assistant that receives **only** the documents the asking party's on-ledger grant authorizes. It cannot answer about a tier you aren't cleared for. |
| **Multi-asset raise** | Investors commit in USDCx / cBTC / cETH, oracle-priced to a single USD target; equity is allocated **pro-rata** by USD value. |
| **Governance gate** | Board / Legal / Compliance approvals, each anchored on-ledger with a signed-resolution hash. |
| **Atomic DvP close** | Capital and tokenized equity swap in one transaction — or the whole thing reverts with nothing moved. |
| **Provable integrity** | Recompute any document's hash and prove it still matches the immutable on-ledger anchor. |
| **Cap table** | Ownership is a real on-ledger `ShareCertificate`; the round is allocated the instant the deal settles. |

## What's real, and what's modeled

We're precise about this on purpose.

**Genuinely real, on Canton devnet:**
- Every contract — `Deal`, `Document`, `AccessGrant`, `AccessEvent`, `Commitment`, `Approval`,
  `KYCAttestation`, `Holding`, `ShareCertificate` — is a real contract on the validator, with real `updateId`s.
- **Selective disclosure** is enforced by Canton's per-party projection, not by application code.
- **Atomicity** is real Canton behaviour: the close commits fully or reverts entirely.

**Modeled (not real assets):**
- **cBTC / cETH / USDCx are asset labels with a fixed demo oracle** (`USDCx: 1, cBTC: 100000, cETH: 4000`).
  They are **not** the real BitSafe / OnRails / Circle token contracts.
- The settlement leg uses Atrium's own `Holding` templates, which **mirror the shape of** the Splice Token
  Standard (CIP-56) so the model is self-contained — deliberately shaped for a drop-in swap to the real
  token-standard packages.

**Built but not enabled:**
- **Loop wallet integration** (`@fivenorth/loop-sdk`) — real Canton sign-in, on-chain holdings, and a
  wallet-signed CIP-56 payment leg. Ships behind `VITE_WALLET=1`, **off by default** so the demo is
  drivable by anyone without a Canton wallet. (Granting a *cross-participant* wallet party on-ledger
  additionally requires the Atrium package to be vetted on that wallet's participant — an infra step.)

**Not built:**
- No authentication or multi-tenancy — the demo is single-tenant with a fixed founder party, and the lens
  switcher deliberately lets you inhabit every party so all sides of a private deal are visible.
- M&A and secondary sales are **not shipped** — the primitives generalise to them, but only the primary
  fundraise is complete end-to-end.

## Ledger-verified proofs

The guarantees are **proven in Daml, not asserted** — 7 scripts, all green. Run `make ledger-test`:

| Script | Proves |
|---|---|
| `testPrivacyProjection` | Rivals are invisible; the access trail is scoped per party. |
| `testKYCGate` | An investor without valid, unexpired KYC cannot be closed with. |
| `testConditionalClose` | The gate fires only when raise target + KYC + **all** approvals are satisfied. |
| `testAtomicDvP` | The close swaps capital and ownership in a single transaction. |
| `testAtomicityHolds` | Pull a leg mid-close → the whole thing reverts, nothing moves. |
| `testDistribution` | Post-close pro-rata distribution pays every holder atomically, each receipt private. |
| `testShareTransfer` | Tokenized ownership moves on the cap table as a real `ShareCertificate`. |

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────────────┐
│  Frontend   │────▶│  Executor        │────▶│  Canton (Seaport devnet)  │
│  React/Vite │     │  Node/Express    │     │  JSON Ledger API v2       │
│  lens switch│◀────│  party-scoped    │◀────│  atrium-cm 0.9.0          │
└─────────────┘     │  views, close    │     └───────────────────────────┘
                    │  ┌────────────┐  │
                    │  │ encrypted  │  │  Documents live encrypted OFF-chain.
                    │  │ doc vault  │  │  Canton stores the hash + tier, and is
                    │  └────────────┘  │  the authorization + audit layer —
                    │  Venice AI       │  not the vault. Integrity is provable.
                    └──────────────────┘
```

**Two-layer by design:** Canton holds rights, disclosure and economics; the app holds everything else.
The executor drives the ledger over the JSON Ledger API v2 (OIDC client-credentials), serves each party
only their projection, and runs the atomic close.

## Tech stack

- **Ledger** — Daml (SDK 3.4.11) on **Canton Network**, deployed to the FiveNorth Seaport devnet validator via the JSON Ledger API v2
- **Token standard** — Splice / **CIP-56**-shaped settlement templates
- **Wallet** — **Loop** (`@fivenorth/loop-sdk`, CIP-0103) — sign-in, holdings, wallet-signed transfers *(behind a flag)*
- **Backend** — Node.js · TypeScript · Express · OIDC · encrypted off-chain document vault · **Venice AI** copilot · deployed on **Railway**
- **Frontend** — React · TypeScript · Vite · deployed on **Vercel**

## Quick start

**The demo, no ledger, no Docker:**
```bash
make frontend            # → http://localhost:5173  (in-browser mock ledger)
```

**The live stack against a real Canton ledger (3 terminals):**
```bash
make sandbox             # Canton + JSON Ledger API v2 on :7575, seeded
make backend             # executor drives the real ledger on :8080
make frontend-live       # UI with VITE_LIVE=1
```

**The proofs:**
```bash
make ledger-test         # privacy · atomic DvP · atomicity · conditional close
```

**Environment** (`backend/.env`): `LEDGER_API_URL`, OIDC client credentials, `ATRIUM_PKG`, `VENICE_API_KEY`.
Frontend: `VITE_LIVE=1`, `VITE_API_URL`, optional `VITE_WALLET=1`.

## Project structure

```
atrium/
  ledger/     Daml package — DealRoom (deal, documents, grants, audit, commitments, approvals,
              the conditional close gate) + Dvp (atomic settlement, CIP-56 shaped) + Equity (cap table),
              with the four proof scripts
  backend/    Executor — party-scoped views, encrypted document vault, the atomic close, the
              tier-bounded AI copilot, over the Canton JSON Ledger API v2
  frontend/   React console — viewer lens, tier-redacted documents, audit trail, live ledger-activity
              feed, the close and the stress-test, Loop wallet integration (flagged off)
```

## Roadmap

1. **Real CIP-56 assets** — swap the modeled cBTC / cETH / USDCx for the real BitSafe, OnRails and Circle
   token contracts already live on Canton. The settlement templates are already shaped for it.
2. **Wallet-native investing** — enable Loop sign-in and the wallet-signed payment leg (built, flagged
   off); requires the package vetted on the wallet's participant for cross-participant grants.
3. **More instruments** — secondaries and M&A on the same primitives (tier-gated room, on-ledger audit,
   governance gate, atomic close).
4. **Multi-tenancy + identity** — the founder becomes whoever connects their Canton wallet; many
   concurrent deals, each scoped to its own seller party.
5. **Customer discovery** — put it in front of private-market deal leads. That's the next conversation,
   not the next feature.

## Honest boundary

Production-valid patterns and current libraries — but not yet a production system. Documents live
encrypted **off-chain**; Canton is the authorization and audit layer, not the vault (integrity is
provable — every blob's hash is anchored on-ledger). Gap to production: a Daml security audit
(observer-list mistakes silently leak), a legal ownership wrapper, real KYC, hardened key management, and
a real registry service.
