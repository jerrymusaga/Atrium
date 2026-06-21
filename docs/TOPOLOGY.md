# Atrium multi-validator topology (the strong privacy demo)

On the local sandbox, all parties live on **one** participant, so "selective disclosure" is a
single-node projection — correct, but easy to wave away. The compelling version puts parties on
**separate validators (participant nodes)** connected to a shared **synchronizer**, so a rival
buyer's node *physically cannot* receive contracts it isn't a stakeholder of. That's privacy you
can prove by querying two nodes side by side.

## Roles → parties → validators

| Party | Role | Validator | Rationale |
|---|---|---|---|
| **Halden** | Seller / App Provider | **A** (your org) | holds `Deal`, `Document`, issues `AccessGrant`, receives `Offer` |
| **AtriumApp** | Executor / operator | **A** | drives the atomic close; co-located with the seller for simplicity |
| **Registry** | token admin (mock `Holding`; later Amulet) | **A** (or a Splice SV for Stage 3) | issues the holdings that become the two legs |
| **Boranic** | Buyer · tier 1 | **B** | a separate node ⇒ rival bids/grants never reach it |
| **Meridian** | Buyer · tier 2 | **C** | separate node ⇒ separate projection |
| **Regulator** | scoped observer | **A** or **D** (read-only) | supervisory visibility, no tier-2 contents |

**Synchronizer:** every validator must connect to the **same** Canton synchronizer (the Seaport
devnet's shared one). That's what lets a contract created on A, with Boranic (on B) as observer,
be routed to B — and *only* B — automatically. Confirm Seaport places team validators on one
synchronizer (it should, on a shared devnet).

## What "cross-node" changes vs. the sandbox

1. **Party IDs are externally owned.** A party is hosted on one participant and namespaced to it
   (`Boranic-…::<fingerprint>`). The buyer self-allocates on **their** validator and shares the
   resulting **party ID**; the seller then issues the `AccessGrant` to *that* id. So the invite flow
   becomes "paste the buyer's party id" rather than the operator allocating it locally.
2. **Topology must propagate.** Before the seller can name Boranic as an observer, Boranic's
   party→participant mapping has to be visible on the shared synchronizer. On a shared devnet this
   is automatic once both validators are connected; just allocate the party first.
3. **The close needs disclosure.** For the DvP, the sender exercises the registry's
   `AllocationFactory` it isn't a stakeholder of → pass it as a **disclosed contract**
   (`createdEventBlob`), and **dedupe disclosed contracts by contract-id** before submitting (already
   noted in the executor). Same pattern the real Amulet registry needs in Stage 3.
4. **Proving isolation.** Query **B's** JSON Ledger API as Boranic and **A's** as Halden for the same
   deal: Halden's ACS has the rival `Offer`/grants; Boranic's does not. That side-by-side is the demo.

## Phased rollout (each phase is independently demoable)

- **Phase 0 — single shared validator (works today once credentials are in).** All parties on Seaport's
  shared "5n sandbox" validator. Real hosted ledger, single-node privacy. Zero code change beyond
  pointing the executor at Seaport (`docs/SEAPORT.md`).
- **Phase 1 — 2 validators (App Provider A + one buyer B).** Smallest setup that proves *cross-node*
  disclosure. Code change: `inviteBuyer` accepts an external party id (keep local-allocate as the
  single-node fallback). Demo: side-by-side ACS query of A vs. B.
- **Phase 2 — 3 validators (2 buyers, B + C).** Full rival-invisibility across nodes — the money shot.
  Teammates each run a personal Seaport validator and share their party id + JSON API URL.
- **Phase 3 — Stage 3 cash leg.** Swap the mock `Registry`/`Holding` for Splice **`AllocationV1` /
  Amulet** on a Splice-enabled validator; ownership leg stays bespoke (or becomes a `ShareCertificate`).

## Executor shape across nodes

- **Phase 0–2 (recommended for the demo):** one executor, app-provider-side, holding **Halden +
  AtriumApp + Registry** on validator A. It creates grants to external buyer party ids and reads/drives
  the seller+operator projections. Buyers' `RecordAccess` / `Offer` are submitted from their own node
  (Seaport IDE, `@c7/ledger`, or a second executor instance pointed at their validator).
- To let the **frontend lens** read a buyer's *own* node directly (the strongest proof), allow a
  per-viewer `LEDGER_API_URL` so "viewing as Boranic" queries validator B. Optional polish, not required
  for Phase 1.

**Bottom line:** Phase 1 (2 validators) is the highest-leverage step — it converts the privacy claim
from "trust the projection" to "here are two nodes, look." Everything else is additive.
