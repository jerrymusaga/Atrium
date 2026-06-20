# Atrium — the deal room that closes
### Build-on-Canton (Encode Club) assessment doc
*Working name. Track 1 (Private DeFi & Capital Markets) + Track 2 (RWA / tokenized assets). Last researched: June 2026.*

---

## 1. One-line thesis

A private deal-execution app: due-diligence access is cryptographically permissioned and fully audit-logged over an encrypted document store, and the winning deal — payment against tokenized ownership — settles **atomically in one transaction**. Confidential to competitors, provable to a regulator, with the diligence record and the close living as one object.

The bet: every M&A / fundraise data room today (Datasite, Intralinks, DealRoom, iDeals) is a *filing cabinet with permissions*. The actual close — money in escrow, share transfer, registry update — happens off-platform through lawyers over weeks. Canton lets the same private, permissioned object that you did diligence on **be the thing that settles**. Nobody has built the deal *workflow* on Canton; existing tools (DStash, Memora) are just private document storage.

---

## 2. Why this is only possible on Canton

Two Canton primitives map exactly onto the two halves of the product:

- **Selective disclosure (signatories / observers / choice observers + sub-transaction privacy)** → the data room. Each buyer sees only their cleared slice, enforced by the ledger; competing buyers never see each other; every access is an on-ledger event (tamper-proof audit trail); a regulator can be a scoped observer.
- **Native atomic Delivery-vs-Payment (CIP-56 token standard)** → the close. Cash leg and ownership leg settle in a single transaction or not at all. No half-closed state, no settlement risk.

On a transparent chain you'd need heavy ZK for the privacy and a custom escrow for the atomicity. Here both are protocol/standard-level.

**The honest boundary (state this before a judge does):** Canton gives privacy *between participants* and atomic settlement. It is **not** MPC — it does not compute over data the computing party can't see. And documents do **not** live on-ledger (see §4, §6).

---

## 3. Current stack (the "latest libraries" part)

> Canton tooling moves fast and the docs are split across two lines. For a Token-Standard + Global-Synchronizer app, target the **Daml 3.x / Canton 3.x line**, not the 2.x LTS line.

| Layer | What to use (current) | Notes |
|---|---|---|
| Smart contract language | **Daml 3.x** | `signatory` / `observer` / `choice observer` / `controller`. |
| Toolchain / compiler | **`dpm`** (Daml package manager / compiler) | Replaces the old `daml` assistant on the 3.x/Canton line. `Install dpm` from canton.network/developer-resources. |
| Scaffolding | **`digital-asset/cn-quickstart`** | Official. Daml contracts (`daml/`) + Java backend + React frontend, wired to a local Global Synchronizer. "Rapidly evolving WIP." |
| Local network | **LocalNet** (via Splice containers) | Runs Super Validator + Canton Coin wallet + app-provider / app-user validators locally. Needs Docker, **JVM 17+**, **≥8 GB RAM**. `ScratchNet` = shared persistent env; `DevNet` = real decentralized GS (needs VPN whitelisting — skip for hackathon). |
| Token standard | **CIP-56** via **Splice Token Standard interfaces** | `Splice.Api.Token.HoldingV1.Holding`, `TransferFactory` / `TransferInstruction` (2-step transfers: Accept/Reject/Withdraw), **`AllocationV1`** (orchestrate transfers inside your own workflow), metadata API. **Native atomic DvP.** UTXO model — keep ≤ ~10 holdings/party, ≤100 inputs/transfer. Wallets discover tokens via `InterfaceFilter` on `HoldingV1:Holding`. |
| Backend | **Java** services with **Transcode-generated** types from DARs | Comes with the quickstart. Regenerate types after Daml changes (`make build`). |
| Frontend | **React** + **TypeScript codegen** from DARs | Quickstart ships a React app. Talks to the **JSON Ledger API**. |
| Off-chain docs | Your own **encrypted blob store** (S3 / IPFS) + on-ledger hash & access-grant. Optionally compose with **DStash** (already does "documents with ledger-grade privacy"). | Canton stores small structured data, **not** PDFs. |
| Real assets that already exist (for credibility / future) | **USDCx**, **cBTC**, **cETH**, **Canton Coin** — all CIP-56 | Tradeweb ran real Treasury repo on Canton (Dec 2025) on CIP-56. For MVP, mint your *own* mock CIP-56 cash + ownership tokens on LocalNet. |

**Disclosure mechanic worth knowing:** Daml's **explicit contract disclosure / read delegation** lets a stakeholder share a contract off-ledger (HTTPS/email) so a non-stakeholder can use it in a command without becoming an observer — the canonical "serve market data via Web2 APIs, feed it back at point of use" pattern. Useful for serving document metadata / sealed-bid data without broadcasting. (Documented on the 2.10.x docs; **confirm the 3.x equivalent** before relying on it.)

---

## 4. Architecture & Daml model

### Document layer (off-chain, ledger-authorized)
1. Seller encrypts each document; uploads ciphertext to blob store.
2. On-ledger `Document` contract holds: hash, blob pointer, tier, signatory = Seller.
3. Access = an `AccessGrant` (or adding the buyer as observer): granting a buyer the decryption key is recorded on-ledger, and every key-fetch / view is an on-ledger event → the **audit trail**.
4. Byte-confidentiality rests on **key management**, not Canton. Canton is the authorization + audit layer. (This is the #1 thing to say correctly.)

### Daml templates (sketch)
- `Deal` — signatory: Seller. Holds deal metadata, tier definitions. Observers added per admitted buyer.
- `BuyerAdmission` — Seller + Buyer; gates a buyer into a tier (carries NDA acceptance as a choice).
- `Document` — signatory Seller only. Stable, private. Holds `contentHash`, `blobPointer`, `tier`. **Never** carries buyer observers (changing observers = archive+recreate, which churns the contract ID and wrecks the audit trail — avoid).
- `AccessGrant` — signatory Seller, observer Buyer (visible only to those two; rivals never see it). One per buyer per tier. `nonconsuming choice RecordAccess` (controller Buyer) mints an `AccessEvent`; `Revoke` (controller Seller) archives it. Decryption-key release is gated off-ledger on an active grant.
- `AccessEvent` — signatory Seller, observer Buyer (+ optional Regulator). Append-only, immutable, ledger-timestamped "who saw what, when." **This is the differentiator** — the audit trail is a first-class ledger object. Authorization holds because a choice on `AccessGrant` runs with Seller's (signatory) + Buyer's (controller) authority, so the buyer-initiated event is seller-signed and unforgeable.
- `Offer` — signatory Buyer; visible only to Seller (Buyer + Seller). Sealable via hash-commit if you fold in the auction layer.
- `AllocationRequest` (coordinating contract) — created by the app on the winning `Offer`. Describes two legs under one `settlementRef` (cash Buyer→Seller, ownership Seller→Buyer) with `allocateBefore` / `settleBefore` deadlines, and is where Buyer + Seller delegate execute/cancel authority to the **executor** (the app). This delegation is what lets one atomic command settle both legs without both parties co-submitting.

### Access reads & the close (explicit disclosure + AllocationV1)
Granted buyers read a `Document` at point of use via **explicit contract disclosure** (on by default since Canton 2.7): the Seller serves the contract's created-event blob off-ledger (`include_created_event_blob = true` on the filter), the buyer attaches it as a `DisclosedContract` — no buyer ever becomes a stakeholder of the `Document`. The **same mechanism powers the close** (the registry hands the executor disclosed config contracts it isn't a stakeholder of), so the design is internally consistent with how the platform settles.

The close, via the token standard's `AllocationV1`, in four steps:

1. **Propose.** On the winning `Offer`, the app (as **executor**) creates the `AllocationRequest`: two legs under one `settlementRef`, with deadlines, and the parties' delegation of execute/cancel authority to the executor.
2. **Allocate (lock).** Each party fetches the factory + choice context from the token's registry (`POST /registry/allocation-instruction/v1/allocation-factory`) and exercises `AllocationFactory_Allocate` → an `Allocation` locking their leg. Buyer locks cash; Seller locks the ownership holding.
3. **Settle atomically.** For each allocation the app fetches the execute context (`POST /registry/allocations/v1/{allocationId}/choice-contexts/execute-transfer`), **dedupes the disclosed contracts**, and exercises `Allocation_ExecuteTransfer` on **both legs in one command**. Both swap or the transaction fails. Drop the **Regulator in as a choice observer** here so it sees the close and only the close.
4. **Fail-safe.** Miss `allocateBefore` or settlement breaks → executor uses pre-granted `Allocation_Cancel` to release locked assets; sender can `Allocation_Withdraw` while there's still time. A no-show can't trap anyone's funds.

Ownership-leg note: the standard allows the delivery leg to be either another token *or* the creation of registry-specific on-ledger state (e.g. a `ShareCertificate`). MVP uses a mock CIP-56 `Holding` for both legs (cleanest, wallet-discoverable); the bespoke-certificate delivery leg is the richer upgrade. Native standard feature, not custom escrow — the strongest technical-credibility point in the project.

**Gotcha to bank now:** when the close fetches multiple choice contexts, the Ledger API currently makes the *client* deduplicate disclosed contracts by contract-id before submitting, or the command is rejected. Cheap once known, nasty to debug blind.

---

## 5. MVP — ruthlessly scoped

The deal room's only real enemy is scope. Build exactly this; fake/defer the rest.

### In scope (the demo)
- **One clean deal type:** a *secondary share sale* or *single-asset sale* (NOT a conditional full-company M&A — see §6).
- **3 parties on separate participant nodes:** Seller, Buyer A, Buyer B (separate nodes so privacy is *ledger-enforced*, not a UI mask).
- **2 documents, 2 tiers:** Buyer A sees tier 1 only; Buyer B sees tier 1 + tier 2. Encrypted off-chain, keys gated on-ledger.
- **Live access trail:** show on-ledger "who accessed what, when."
- **The atomic close:** mock CIP-56 cash token + mock CIP-56 ownership token; one DvP transaction.
- **Three-view demo:** flip Seller / Buyer A / Buyer B — visibly different realities of one deal.

### Defer (mention as roadmap, don't build)
- Sealed-bid/auction layer over offers (nice composability, not core).
- Q&A workflow.
- Regulator observer (add only if time — it's a 1-slide kicker).
- Real assets (USDCx etc.), real legal wrapper, DevNet/mainnet.
- Revocation (can't un-see decrypted bytes anyway — see §6).

### 3-minute demo script
1. Seller opens deal, uploads 2 docs, admits A (tier 1) and B (tier 1+2).
2. Cut to Buyer A's screen — sees one doc, no idea B exists. Cut to Buyer B — sees both.
3. Show the access trail on Seller's screen.
4. B submits the winning offer. Hit close. **Money and ownership swap in one transaction.** Show both balances flip simultaneously.
5. (Optional) Regulator view: confirms the close happened, can't see the docs.

---

## 6. Risk assessment (pressure-test → mitigation → MVP decision)

| Risk | Severity | Mitigation / MVP decision |
|---|---|---|
| **Docs don't live on-ledger; byte-privacy is off-chain key mgmt, not Canton.** | High (credibility) | Frame Canton as *authorization + audit layer over an encrypted store*. Build real encryption + on-ledger key-grant for 2 docs. Never claim "docs live privately on Canton." |
| **"Ownership transfer" ≠ legal transfer** unless equity is natively issued under a legal wrapper. | High (scope) | MVP transfers a *mock* tokenized stake. Say plainly: legal recognition is the RWA-wide hard problem, out of scope; CIP-56 is the standard that makes it possible in production. |
| **Full M&A has conditions precedent, escrow holdbacks, antitrust — not one clean swap.** | High (framing) | Pick a clean deal type (secondary sale / single asset). Don't claim conditional mega-mergers collapse to one tx. |
| **Diligence-on-a-blockchain looks pointless alone.** | Med | Make the *seam* the pitch: same private object you vetted is the one that atomically settles — one provable chain of custody. Build-only-the-room = worse Datasite. |
| **Observer-list errors silently leak** (no compile error; privacy is only as good as contract logic). | Med (technical) | Keep the tier model tiny (2 tiers, 2 docs). Test each party's projection explicitly. This is the audited failure mode in Daml — show you tested it. |
| **Two privacy surfaces to make real (ledger nodes + encrypted bytes); time sink.** | High (delivery) | Multi-node LocalNet for the ledger privacy; minimal real encryption for 2 docs. Budget week 1 just for LocalNet topology. |
| **Revocation can't claw back decrypted bytes.** | Low | Don't promise "right to be forgotten." The strong guarantee is the *audit trail*, not reversibility. |
| **Buyer onboarding friction** (each buyer must be a known party on Canton). | Low (for demo) | Pre-provision A and B on LocalNet. Note onboarding as a real adoption cost in the pitch. |
| **Docs split (2.x vs 3.x); tooling "rapidly evolving."** | Med | Target 3.x + dpm + cn-quickstart. Verify explicit-disclosure 3.x equivalent. Pin versions in README. |

### 6.1 Production-readiness boundary (read before claiming anything)

This MVP is built on **production-valid patterns and current libraries** — CIP-56 / Splice `AllocationV1` / explicit disclosure are the real institutional rails (the same DvP machinery behind Tradeweb's live Treasury repo and DTCC's tokenization). That is the honest, defensible claim: *production-grade design, current standards*.

It is **not** a production-ready system, and you should not claim it is. A hackathon MVP on LocalNet with mock assets is a proof, not a deployment. Closing the gap to actual production would additionally require, at minimum:

- **A security audit of the Daml model** — observer/controller mistakes don't produce compile errors and silently leak (the Credshields failure mode); institutional Daml is audited before it goes near value.
- **Legal recognition of the ownership transfer** — a wrapper making the on-ledger record the authoritative register (the RWA-wide unsolved-for-you problem).
- **Real KYC/onboarding + identity** for every party, not pre-provisioned LocalNet parties.
- **Hardened key management** for the document layer (HSM/MPC, key rotation, revocation policy) — byte-confidentiality rests here, not on Canton.
- **A real registry service** with the OpenAPI endpoints running as production infra, plus DevNet→MainNet deployment, validator/participant operations, and monitoring.
- **Deal-type realism** — conditions precedent, escrow holdbacks, partial settlement.

**"Valid" caveat:** the maintainers describe the stack as rapidly evolving, so every interface signature and endpoint in this doc is *architecturally* sound but must be **verified against the exact versions you install** (§8 Q4). The design is correct; the literal signatures may have moved.

---

## 7. Four-week build plan

- **Week 1 — Environment + the close (the de-risking spike).** Prove a real atomic two-leg DvP before any data-room logic. Staged by risk:
  - *Stage 0 — prereqs:* Docker (≥8 GB), JVM 17+, Nix + direnv, Docker Hub login. `dpm` is the compiler (not the old `daml` assistant).
  - *Stage 1 — environment up:* `git clone cn-quickstart` → `direnv allow` → `cd quickstart` → `make install-daml-sdk` → `make setup` (OAuth2 on, Observability off, TEST MODE off, blank party hint) → `make build` → (2nd terminal) `make capture-logs` → `make start` → `make canton-console` / `make shell`. **Acceptance:** bundled demo runs, LocalNet up, contracts visible in Daml Shell. (Most failures here are Docker memory or Nix/Docker-Hub auth, not code.)
  - *Stage 2 — DvP logic in Daml Script (mock tokens, trivial context):* two minimal `HoldingV1` tokens + `AllocationFactory`/`Allocation` (or lift Splice `TradingApp` / `TestAmuletTokenDvP` helpers). One script: Buyer cash + Seller share → `AllocationRequest` (2 legs, `settlementRef`, deadlines) → both `AllocationFactory_Allocate` → executor `Allocation_ExecuteTransfer` on both legs in one tx → assert balances flipped. **Acceptance:** single tx swaps both; dropping one leg makes settlement fail (atomicity proven). Fast, in-memory.
  - *Stage 3 — promote to LocalNet with a real registry leg (the real proof):* cash leg = Amulet (real registry on LocalNet), ownership leg = mock Share. Fetch choice contexts (`/registry/allocation-instruction/v1/allocation-factory`, then `/registry/allocations/v1/{id}/choice-contexts/execute-transfer`), **dedupe disclosed contracts** before the dual `ExecuteTransfer`. **Acceptance:** one LocalNet tx atomically swaps Amulet ↔ Share, visible in Daml Shell.
  - *Stage 4 — lock + gate:* pin `DAML_RUNTIME_VERSION`, token-standard package versions, cn-quickstart commit; record the registry payloads + dedup handling. **Go/no-go:** Stage 3 green → Week 2. Stage 3 red by week's end → drop to sealed-bid issuance fallback.
  - *MVP shortcut if Stage 3 drags:* keep **both** legs as mock tokens you fully control (trivial choice contexts, skip the real-registry disclosure dance). Still a real atomic on-ledger DvP; mark real-registry integration as roadmap.
- **Week 2 — Privacy + data model.** `Deal`, `BuyerAdmission`, `Document`, tiers. Multi-node so A and B are on separate participants. Prove each party's projection (what they can/can't see). Encrypted blob store + on-ledger key grant for 2 docs.
- **Week 3 — Frontend + the seam.** React + TS codegen: seller console, buyer views, access trail. Wire the offer → close so the vetted object settles. The three-view flip.
- **Week 4 — Polish, demo, hardening.** Rehearse the 3-min demo. Pre-script answers to the two hard questions. Optional: regulator observer. Repo README + deck + video.

*If Week 1 slips, fall back to sealed-bid issuance — same token-standard close, one privacy surface.*

---

## 8. Open questions to resolve before committing

1. **Access modeling — RESOLVED.** Core = per-buyer `AccessGrant` contracts issuing an append-only `AccessEvent` log, with the `Document` kept stable and private to the Seller. Explicit contract disclosure (on by default since Canton 2.7) handles point-of-use document reads *and* the DvP close. Rejected observers-on-`Document` because changing observers forces archive+recreate, churning the contract and degrading the audit trail. This maximizes the audit-trail differentiator, scales across N buyers × M docs, and matches the token standard's own settlement idiom. (See §4.)
2. **Cash leg — RESOLVED.** Mock CIP-56 token on LocalNet for full control of the demo. Test Amulet (Canton Coin) is available if you want more realism later. (See §4 close.)
3. **Ownership representation — RESOLVED.** Mock CIP-56 `Holding` for both legs in the MVP — keeps both legs in the identical allocation framework, cleanest "native DvP" story, wallet-discoverable. The standard also permits the delivery leg to be registry-specific on-ledger state (a bespoke `ShareCertificate`); that's the richer post-MVP upgrade. (See §4 close.)
4. **Confirm in 3.x docs:** explicit contract disclosure, `AllocationV1` DvP flow signatures, and the current cn-quickstart `DAML_RUNTIME_VERSION`.

---

## 9. Sources to verify against

- cn-quickstart: github.com/digital-asset/cn-quickstart · docs.digitalasset.com/build (3.x)
- Developer resources / dpm: canton.network/developer-resources
- CIP-56 spec: github.com/canton-foundation/cips (cip-0056)
- Token Standard APIs (Splice): docs.global.canton.network.sync.global/app_dev/token_standard
- Daml privacy / explicit disclosure: docs.daml.com/concepts/ledger-model/ledger-privacy · docs.daml.com/app-dev/explicit-contract-disclosure (confirm 3.x equivalents)
- Hackathon: encodeclub.com/programmes/canton-hackathon · forum.canton.network

> Tooling is described as "rapidly evolving" by its own maintainers — treat every version/interface above as *verify-before-build*, especially the Token Standard interface signatures and the 3.x disclosure API.
