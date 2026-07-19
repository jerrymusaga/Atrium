<div align="center">

# Atrium

### The data room that closes.

**A private capital-markets operating system on Canton Network** — the same permissioned deal you run
diligence on is the one that atomically settles capital for tokenized ownership, in a single transaction.

[**▶ Live app**](https://atrium-omega.vercel.app) · [**Backend `/health`**](https://atrium-production-4de8.up.railway.app/health) · [**Ledger feed**](https://atrium-production-4de8.up.railway.app/activity)

`● Live on Canton devnet` · `Daml 3.4.11` · `CIP-56` · `7 Daml proofs ✓` · `real wallet-signed cETH settlement`

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
| **Multi-asset raise, live-priced** | Investors commit in USDCx / cBTC / cETH, valued at the **live BTC/ETH spot** to a single USD target; equity is allocated **pro-rata** by USD value. |
| **Real wallet-signed payment** | An investor funds a tranche with a **real CIP-56 cETH transfer signed in their own Loop wallet** — it settles on Canton devnet and anchors the on-ledger commitment. |
| **Governance gate** | Board / Legal / Compliance approvals, each anchored on-ledger with a signed-resolution hash. |
| **Atomic DvP close** | Capital and tokenized equity swap in one transaction — or the whole thing reverts with nothing moved. |
| **Provable integrity** | Recompute any document's hash and prove it still matches the immutable on-ledger anchor. |
| **Cap table** | Ownership is a real on-ledger `ShareCertificate`; the round is allocated the instant the deal settles. |

## What's real, and what's modeled

We draw this line precisely on purpose — it's the difference between a demo and a mockup.

**Genuinely real, on Canton devnet:**
- Every contract — `Deal`, `Document`, `AccessGrant`, `AccessEvent`, `Commitment`, `Approval`,
  `KYCAttestation`, `Holding`, `ShareCertificate` — is a real contract on the validator, with real `updateId`s.
- **Selective disclosure** is enforced by Canton's per-party projection, not by application code.
- **Atomicity** is real Canton behaviour: the close commits fully or reverts entirely.
- **The price oracle is live.** cBTC is 1:1 BTC-backed and cETH is 1:1 wrapped ETH, so commitments are
  valued at the **live BTC/ETH spot price** (polled continuously, with a fallback if the feed is
  unreachable); USDCx is par ($1). The valuation is not an approximation — spot *is* their price.
- **A real wallet-signed payment leg.** An investor connects their own **Loop wallet** and funds a tranche
  with a **real CIP-56 cETH transfer they sign themselves**. It settles cross-participant — the token
  transfer uses the network-vetted Splice packages — and the on-ledger `Commitment` is anchored to that
  transaction id.

**Modeled — deliberately, and drop-in-ready:**
- The **settlement templates** (`Holding`, `AllocationFactory`, `Allocation`) **mirror the shape of** the
  Splice Token Standard (CIP-56) so the model is self-contained. They are shaped for a direct swap to the
  real registry instruments, but are not yet the real BitSafe / OnRails / Circle contracts.
- The **seeded** cBTC/cETH commitments are executor-recorded at live-spot value (modeled amounts); only the
  investor's own cETH commit is a real wallet transfer. The demo cETH is **devnet** — a real transfer, but
  notional value.

**Known boundaries (not built):**
- **Cross-participant on-ledger grants.** Issuing an Atrium `AccessGrant` to a wallet party hosted on
  *another* participant needs the Atrium package vetted on that participant, or the ledger returns
  `NO_SYNCHRONIZER_FOR_SUBMISSION`. The wallet's *token transfer* works cross-participant (Splice is
  network-vetted); naming that party in a *custom* Atrium contract does not, yet.
- **No authentication or multi-tenancy.** The hosted demo is single-tenant with a fixed founder party, and
  the lens switcher deliberately lets you inhabit every party so all sides of a private deal are visible in
  one walkthrough.
- **M&A and secondary sales** — the primitives generalise to them, but only the primary fundraise is
  complete end-to-end.

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
only their projection, and runs the atomic close. The **payment leg is separable**: an investor's Loop
wallet moves a real CIP-56 token straight to the deal escrow (never through the executor), and the app
anchors the commitment to that transaction id — so real, self-custodial money settles alongside the
executor-driven app contracts.

### Notable Canton engineering
- **Deployed to shared devnet infrastructure**, not LocalNet — via Seaport's GitHub build (SDK pinned to
  **3.4.11**), navigating Daml's **Smart Contract Upgrade** rules for the package lineage (new fields must
  be trailing `Optional`s; SCU-valid `0.7.0 → 0.9.0`).
- **Cross-participant package vetting.** A wallet party lives on a different participant that hasn't vetted
  the Atrium package, so a custom contract naming it is refused — but a **Splice token transfer settles
  cross-participant** because Splice is vetted network-wide. That distinction is what makes the real
  wallet-signed payment work while the on-ledger *grant* to a wallet party remains a vetting-gated step.
- **Live price oracle** with continuous polling and a last-good fallback, so a dead feed can never block a
  commit; the raise is USD-denominated and mixed CIP-56 assets aggregate cleanly against one target.
- **Party / `CanActAs` management** on a shared ~10k-party validator: the executor resolves personas and
  (re)grants act-as on demand, resilient to process restarts.
- **Provable off-chain integrity:** documents are encrypted in an off-chain vault; the content hash is
  anchored on-ledger, so re-hashing the vault proves byte-for-byte that nothing was altered.

## Tech stack

- **Ledger** — Daml (SDK 3.4.11) on **Canton Network**, deployed to the FiveNorth Seaport devnet validator via the JSON Ledger API v2
- **Token standard** — Splice / **CIP-56** — real cETH transfers via the token standard; CIP-56-shaped settlement templates
- **Wallet** — **Loop** (`@fivenorth/loop-sdk`, CIP-0103) — real sign-in, live on-chain holdings, and a **real wallet-signed CIP-56 cETH payment leg**
- **Oracle** — live BTC/ETH spot (continuous poll + fallback); USDCx at par
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
make ledger-test         # 7 scripts: privacy · KYC gate · conditional close · atomic DvP ·
                         #            atomicity · distribution · share transfer
```

**Environment** (`backend/.env`): `LEDGER_API_URL`, OIDC client credentials, `ATRIUM_PKG`, `VENICE_API_KEY`.
Frontend: `VITE_LIVE=1`, `VITE_API_URL`, `VITE_WALLET=1` (enabled in the hosted demo — the wallet is
optional; commits work with or without it).

## Project structure

```
atrium/
  ledger/     Daml package — DealRoom (deal, documents, grants, audit, commitments, approvals,
              the conditional close gate) + Dvp (atomic settlement, CIP-56 shaped) + Equity (cap table),
              with seven proof scripts
  backend/    Executor — party-scoped views, encrypted document vault, the atomic close, the
              tier-bounded AI copilot, the live price oracle, over the Canton JSON Ledger API v2
  frontend/   React console — viewer lens, tier-redacted documents, audit trail, live ledger-activity
              feed, the close and the stress-test, and Loop wallet integration (real sign-in, live
              holdings, wallet-signed cETH payment)
```

## Roadmap

1. **Real CIP-56 assets end-to-end** — the investor payment leg is already a real cETH transfer; extend the
   same to the *settlement* leg by swapping the modeled `Holding`/`Allocation` templates for the real
   BitSafe, OnRails and Circle registry contracts. The templates are already shaped for it.
2. **Cross-participant wallet-native investing** — the wallet payment and sign-in are live; issuing the
   on-ledger *grant/commitment* to a wallet party on another participant needs the Atrium package vetted
   there (the one remaining `NO_SYNCHRONIZER` boundary).
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
