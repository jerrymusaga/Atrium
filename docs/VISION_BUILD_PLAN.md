# Atrium — Vision Build Plan (locked 2026-06-25)

> Read this + `docs/CONTEXT.md` to start implementation. This is the agreed scope for evolving
> Atrium into **"The Private Capital Markets Operating System"** for the Encode Build-on-Canton
> hackathon. No code has been written for this plan yet — it begins from the current live state.

## Positioning (the narrative)
**Atrium is where private deals are discovered, diligenced, negotiated, funded, approved, and
settled — in one workflow on Canton.** Reframed from a *secondary share sale* to a **primary
fundraise**: a founder raises a target in **cBTC**; multiple investors compete with sealed bids;
conditions (raise target + approvals) must all be met; then ownership ↔ cBTC settle atomically.

Pitch line: *"Atrium uses Canton where it matters — every action that changes economic or access
rights is a Canton contract: granted, committed, approved, settled. The workflow around it stays
fast and off-chain."*

## The 9 locked decisions
1. **Framing:** primary fundraise + "Capital Markets OS" (not secondary sale).
2. **Architecture:** two layers. **Layer 2 (Canton)** = rights/economics events; **Layer 1 (app)** = everything else.
3. **Audit trail:** on-chain for consequential events; document *views* stay off-chain. (Hash-anchoring = production note, NOT built.)
4. **cBTC:** modeled via CIP-56 (our Dvp already mocks it); rename the cash leg to cBTC; expose a commit/lock step. Framed honestly as "modeled on devnet; production uses BitSafe cBTC."
5. **Scope IN:** fundraise + cBTC commitments · conditional close with Board/Legal/Compliance approvals · Deal Readiness Score · multi-investor sealed bidding · dynamic named tiers.
6. **Scope OUT / later:** public discovery/applications marketplace · Merkle audit anchoring · cross-validator real identity (parked) · **Next.js migration (parked — stay on Vite/React)**.
7. **Roles:** Founder · Investors (tiered) · Board · Legal · Compliance (= existing KYC provider) · Regulator. "Lead Investor" = just an investor flag (no distinct mechanics).
8. **Close conditions (4, all on-chain):** raise-target met · Board approval · Legal approval · KYC/Compliance.
9. **Demo discipline:** fully dynamic config **+** a one-click "load the fundraise demo" seed for deterministic recording.

## Layer map — what is / isn't a Canton transaction
**Layer 2 (Canton contracts):** tier grant / upgrade · NDA acceptance · cBTC commitment (lock) ·
sealed bid · Board/Legal/Compliance approval · accept · **atomic settlement** · cap-table move.
**Layer 1 (off-chain app):** registration · browse · apply for access · **document views** · AI
conversations · founder reviewing applications · draft negotiation · the Deal Readiness Score
(computed over on-chain signals).

## Current state (what's already built — reframe, don't rebuild)
Live on the Seaport Canton validator: encrypted **N-tier** data room (dynamic upload, persisted) ·
tier-bounded **AI copilot** (Venice) · sealed **Offers** (rivals invisible) · **KYC-gated** Accept ·
**atomic DvP** close (proven all-or-nothing) · tokenized **cap table** (ShareCertificate) · audit
trail (AccessEvents) · dynamic onboarding · cinematic landing. Daml: `DealRoom`, `Dvp`, `Equity`
(6 proofs green). Backend executor drives the JSON Ledger API v2 (connection-aware). See `CONTEXT.md`.

So: **selective disclosure, permission-aware AI, atomic settlement, cap table = DONE** — they get
rebranded into the fundraise story. The work below is the *new* spine.

---

## Phased plan (each phase ships independently — if we stop early, we still have a complete story)

### Phase 1 — The spine: fundraise + cBTC + conditional close (highest priority)
The climax: investors commit cBTC → 4 conditions turn green → founder hits **Close** → atomic cBTC↔equity.

**Ledger (Daml):**
- Rename the cash instrument `USD-CASH` → `cBTC` (Dvp usage / backend constant).
- New `Commitment` template (L2): `{ admin, investor, founder, dealId, amount: Decimal, committedAt }`, signatory investor (+ admin), observer founder. Represents **sealed, locked cBTC** toward the raise. (Back it with a Dvp `Allocation` so the close is a real atomic swap.)
- New `Approval` template (L2): `{ approver, role: Text ("BOARD"|"LEGAL"|"COMPLIANCE"), dealId, approvedAt }`, signatory approver, observer founder.
- Extend `Deal` with `raiseTarget: Decimal` and `requiredApprovals: [Text]`.
- Close logic: extend `Offer.Accept` (or a new `Deal.Close`) to **require** the Board+Legal approval cids + assert `sum(commitments) >= raiseTarget` + winner KYC'd — enforced on-ledger (mirrors how Accept already requires `kycCid`). Then atomically move winner's cBTC → founder and issue/transfer equity → winner.
- Proof: `testConditionalClose` — close fails below target / missing an approval; succeeds when all green.

**Backend:**
- `POST /commit` (investor locks cBTC) · `POST /approve` (Board/Legal/Compliance signs) · `GET /conditions` (raise progress + approval states for the founder).
- `/accept` + `/settle` enforce the 4 conditions and pass approval cids to the on-ledger choice.
- Seed: Board + Legal parties; a fundraise `Deal` (target e.g. 25 cBTC); investors with commitments.

**Frontend:**
- Founder: **conditions panel** — raise-progress bar + approval checklist, each turning green; **Close** enabled only when all green.
- Investor: **Commit cBTC** (amount) → shows their locked commitment + sealed bid.
- Board/Legal/Compliance lenses: an **Approve** button.
- Close animation reworded to cBTC ↔ equity.

### Phase 2 — Deal Readiness Score + multi-investor bidding
**Backend:** `GET /readiness` computes a % from on-chain signals (investors invited, docs available,
bids in, cBTC committed vs target, approvals issued); Venice **narrates** it. Seed 3–5 investors.
**Frontend:** a readiness gauge on the founder view + the AI one-liner; multiple investor lenses; bids list.
**Demo beat:** readiness rises as milestones complete; "Deal Readiness: 87% — 60% funded, Board approved, Legal pending."

### Phase 3 — Dynamic named tiers + founder deal setup
**Ledger:** tier **names** per deal (store on `Deal`, e.g. `tiers: [Text]`); `Document.tier` stays Int, the label comes from the deal.
**Backend:** `POST /deals` (founder creates: title, instrument, raiseTarget, tier names); names surfaced in views.
**Frontend:** founder "set up the room" flow (name tiers, set target, add docs per named tier, invite roles) + one-click "load demo" seed.
**Demo beat:** founder configures a deal live; named tiers ("Teaser / Financials / Legal") appear.

### Phase 4 — Polish
Reword AI to "access restricted / insufficient privileges"; role-aware UI (each role sees only its
actions); surface the on-chain audit trail (grants · commitments · approvals · settlement).

### Phase 5 — Provable integrity (added 2026-06-28; deepen the moat, not the surface)
Close the biggest honesty gap ("documents live off-chain") by making it *verifiable*. Canton already
holds each blob's `Document.contentHash`; the founder/regulator can now **re-hash the whole vault and
prove byte-for-byte it still matches the immutable on-ledger hash**. A demo "simulate tamper" toggle
corrupts a blob off-chain so a re-verify catches it (✗ INTEGRITY BREACH) — then restores it. No Daml
change (hash already on `Document`) → no redeploy. This is Canton-native rigor a generic dapp can't
replicate, and it turns "off-chain storage" from a caveat into a guarantee.

---

## Target demo (3–4 min, deterministic seed)
Founder launches a 25-cBTC raise → investors get different **named tiers** → **permission-aware AI**
(deny vs answer) → investors **commit cBTC** + sealed bids → **Deal Readiness** rises → **Board +
Legal + Compliance** approve, raise target met (all green) → founder **Closes** → **atomic cBTC↔equity**
→ deal summary + on-chain **audit trail**. Lifecycle: *Access → Disclosure → Commitments → Approvals
→ Settlement, all on Canton.*

## Honest boundaries (say these, don't hide them)
Documents encrypted **off-chain** (Canton holds hash + grant); **cBTC modeled** via CIP-56 on devnet;
the executor submits txns on behalf of parties (real per-party signing = the parked cross-validator
finale); gap to production = security audit, real cBTC bridge, legal wrapper, real registry.

## Start here (first implementation task)
**Phase 1, ledger first:** add `Commitment` + `Approval` templates, extend `Deal` (raiseTarget,
requiredApprovals), gate `Accept`/Close on conditions, write `testConditionalClose`, `daml test` green.
Then backend (`/commit`, `/approve`, `/conditions`, conditional `/settle`), then the founder
conditions panel. Bump the Daml package version (SCU) and redeploy to Seaport per `docs/SEAPORT.md`.
