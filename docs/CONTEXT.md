# Atrium — project context & handoff

> Read this first in any new session. It's the full state of the project so you (or a
> fresh assistant chat) can pick up without re-deriving anything. Companion: `docs/ASSESSMENT.md`
> (the deep technical assessment) and `docs/USER_STORY.md`.

## What we're building
**Atrium — "the data room that closes."** A privacy-preserving M&A / deal-execution app on
**Canton Network**. Every data room today (Datasite, Intralinks, iDeals) is a *filing cabinet
with permissions*; the actual close happens off-platform through lawyers/escrow over weeks.
Atrium makes the same private, permissioned object you do diligence on **be the thing that
settles** — payment vs tokenized ownership, atomically, in one transaction.

- **Hackathon:** Encode Club "Build on Canton" (fully virtual, started June 15 2026, $7,000 pool / top 3, Canton Foundation).
- **Tracks:** Private DeFi & Capital Markets + RWA / Tokenized Assets.
- **Why this idea:** deliberate pivot away from EVM/Solidity strengths into Daml/Canton, chosen for originality. Canton's selective disclosure *is* a data room; its native atomic DvP *is* the close. Both are impossible/absurd on a transparent chain without heavy ZK.

## Why only Canton
- **Selective disclosure** (signatories / observers / choice observers + sub-transaction privacy) → the data room. Each buyer sees only their tier; rivals are invisible; every access is an on-ledger event (tamper-proof audit trail); a regulator can be a scoped observer.
- **Native atomic DvP** (CIP-56 token standard, `AllocationV1`) → the close. Cash leg + ownership leg settle in one transaction or not at all.
- **Honest boundary:** Canton gives privacy *between participants* and atomic settlement. It is NOT MPC (no computing over hidden inputs), and documents do NOT live on-ledger.

## Design decisions (all settled)
- **Documents:** live ENCRYPTED OFF-CHAIN (S3/IPFS). On-ledger = hash + pointer + access grants + access log. Canton is the authorization + audit layer, not the vault. Byte-privacy = key management.
- **Access modeling:** per-buyer `AccessGrant` contracts issuing an append-only `AccessEvent` log; `Document` stays stable + private to the Seller. REJECTED observers-on-Document (changing observers forces archive+recreate, churning the audit trail).
- **Reads + the close:** both use **explicit contract disclosure** (on by default since Canton 2.7; fetch choice contexts from the token registry OpenAPI; **dedupe disclosed contracts** by contract-id before submitting — known gotcha).
- **Ownership leg:** mock CIP-56 `Holding` for both legs in MVP (cleanest "native DvP" story). Standard also allows a bespoke `ShareCertificate` as the delivery leg (post-MVP upgrade).
- **Regulator:** optional choice-observer on the close — verifies it matched recorded bids without seeing tier-2 contents.

## Stack (verify versions on first build — tooling is "rapidly evolving")
- Daml 3.x via `dpm`; scaffold on `digital-asset/cn-quickstart`; run on **LocalNet**.
- Token standard: **CIP-56 / Splice** (`Splice.Api.Token.HoldingV1 / AllocationV1 / AllocationInstructionV1`).
- Frontend: React + TypeScript. Backend/executor: the app holds the operator party + talks to the JSON Ledger API.

## Daml model (in `ledger/daml/Atrium/`)
- `DealRoom.daml`: `Deal`, `Document` (seller-only signatory), `AccessGrant` (+ `RecordAccess` → `AccessEvent`), `AccessEvent` (append-only), `Offer`. Plus `setupDemo` script.
- `Dvp.daml`: mock `Holding` / `Allocation` / `AllocationFactory` / `SettlementCoordinator` + two proof scripts (`testAtomicDvP`, `testAtomicityHolds`). These MOCKS mirror CIP-56 and get swapped for the real Splice interfaces in Stage 3.

## MVP scope
1 clean deal type (secondary share sale, NOT conditional M&A); 3 parties on separate participant nodes (Seller + 2 buyers); 2 documents / 2 tiers; live access trail; atomic DvP close with mock CIP-56 tokens both legs. **Demo money shot:** flip Seller / Buyer A / Buyer B views (radically different), then the one-transaction close.

## 4-week plan
- **Wk1 — environment + prove the close.** Stage 1: cn-quickstart on LocalNet. Stage 2: run the `Dvp.daml` scripts (`daml build && daml test`). Stage 3: same close on LocalNet with a real registry leg (Amulet). **Gate:** Stage 3 green → Wk2; red → fall back to sealed-bid issuance (same close, one privacy surface).
- **Wk2 — privacy/data model.** `Deal`/`Document`/`AccessGrant`/`AccessEvent`; multi-node so buyers are on separate participants; prove each party's projection.
- **Wk3 — frontend + the seam.** Wire the React app to the JSON Ledger API; seller console, buyer views, access trail, the close.
- **Wk4 — polish, demo, deck, video.**

## Honest framing (do not overclaim)
Production-VALID patterns + current libraries (the same DvP machinery as Tradeweb's live Treasury repo) — but NOT a production-ready system. Gap to production: Daml security audit (observer-list errors silently leak), legal ownership wrapper, real KYC, hardened key management, real registry service, DevNet→mainnet. See ASSESSMENT.md §6.1.

## Odds read
~60% top-3 IF a clean MVP ships; ~10% if not. Variance is all execution, not the idea. Boosted because the field is an Encode virtual hackathon on a hard new stack where finishing anything polished is rare.

## What's built so far (this repo)
- `ledger/` — the Daml package (model + DvP proof).
- `frontend/` — runnable React app with an **in-browser mock ledger** (runs today, no LocalNet needed); demonstrates the three-view privacy + the atomic close.
- `backend/` — executor-app stub with Ledger API integration TODOs.
- `docs/` — this file, `ASSESSMENT.md`, `USER_STORY.md`.

## Immediate next action
Stand up cn-quickstart on LocalNet (Stage 1), then run the `Dvp.daml` proof scripts (Stage 2). That converts the design from "asserted" to "verified."
