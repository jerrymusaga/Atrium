# Atrium — Pitch Deck Script (for Canva AI)

Paste the **Canva AI prompt** below into Canva (Magic Design / "Docs to Deck"), then refine
slide-by-slide with the script. Keep on-slide text sparse; the detail lives in the speaker notes.

---

## Canva AI prompt (paste this first)

> Create a 12-slide investor/hackathon pitch deck for **Atrium — a private capital markets
> operating system on Canton Network**. Audience: technical hackathon judges (blockchain /
> capital markets). Tone: confident, precise, infrastructure-grade — not salesy. Visual style:
> dark, minimal, fintech/infra. Background near-black (#0E1218), steel-blue accent (#5E8FB5),
> cBTC gold accent (#C68A3E), "settled" green (#4FA88B) for success states. Display font like
> Space Grotesk; use a monospace font (IBM Plex Mono) for numbers, hashes, and code-like labels.
> Lots of negative space, one idea per slide, large numbers, subtle line/grid motifs. Avoid
> stock-photo clutter; prefer diagrams and typographic layouts.

**Design tokens:** ink `#0E1218` · steel `#5E8FB5` · gold `#C68A3E` · green `#4FA88B` ·
text `#E6E9EE` · muted `#8A93A1` · fonts: Space Grotesk (display) + IBM Plex Mono (numbers/labels).

---

## Slides

### 1 — Title
**Atrium**
*The deal room that closes.*
A private capital markets operating system on Canton Network.
> Speaker: Atrium runs an entire private fundraise — diligence, bids, approvals, settlement — in one private workflow, where the object you diligence is the object that settles.

### 2 — The problem
**A private round runs across disconnected tools.**
- Data room (Datasite, Intralinks) = a filing cabinet with permissions
- Sealed bids over email · approvals in separate threads
- The close happens off-platform — lawyers, escrow, **weeks**
> Speaker: Nothing connects diligence to the actual close. Money and ownership move off-platform, days or weeks later, with counterparty and escrow risk in between.

### 3 — The insight
**The same private object you run diligence on should be the thing that settles.**
cBTC ⇄ tokenized equity — atomically, in one transaction, only when every condition is met on-ledger.
> Speaker: That's the whole idea. Collapse the lifecycle so diligence and settlement are the same object, not two systems bridged by lawyers.

### 4 — Why Canton
**Two things no transparent chain can do without heavy ZK:**
- **Selective disclosure** → the data room
- **Native atomic DvP** → the close
> Speaker: On a public chain you'd need heavy zero-knowledge machinery to get private, per-party views and atomic two-asset settlement. Canton gives both natively. That's the unfair advantage.

### 5 — Pillar 1: Selective disclosure = the data room
**Every party sees only their slice — enforced by the ledger.**
- Investors see only their **named tier**; rivals are invisible to each other
- Every document open = a tamper-proof **on-ledger event**
- A regulator can be a **scoped observer**
> Speaker: This isn't app-level permissions. Canton projects each party only their entitled view at the node level. Switch the lens in the demo and the same deal looks different to everyone.

### 6 — Wow factor: the permission-bounded AI + provable integrity
**A diligence copilot that physically cannot leak.**
- It only ever receives documents your grant authorizes
- Ask about a tier you can't see → "access restricted," never the answer
- Docs encrypted off-ledger; hash anchored on Canton → **re-hash to prove nothing was altered**
> Speaker: The AI is bounded by the ledger, not by a prompt. And because every blob's hash is on-chain, anyone can re-hash the vault and prove byte-for-byte integrity — tamper a file off-chain and Canton catches it.

### 7 — Pillar 2: Conditional close + atomic DvP = the settlement
**The close is gated on 4 on-ledger conditions:**
- ✅ Raise target met (cBTC committed) ✅ Board ✅ Legal ✅ Compliance
- Then cBTC and equity settle **together or not at all**
- No escrow · no counterparty risk · no weeks
> Speaker: The close is a single atomic swap that can't fire until the raise is funded and Board, Legal, and Compliance have all signed on-ledger. All-or-nothing — there's no partial settlement to even represent.

### 8 — How it works (the lifecycle)
**One workflow, on Canton:**
Set up the room → grant tiered access → sealed bids + cBTC commitments → **Deal Readiness** climbs → Board/Legal/Compliance approve → **atomic close** → on-chain audit trail.
> Speaker: A founder drives the whole arc in one place. A live Deal Readiness score rises as milestones complete — 74% to 100% — and only then does Close unlock.

### 9 — It's real (not a mockup)
**Live on a real Canton validator. Proven by tests.**
- Running on the Seaport Canton validator (hosted)
- **8/8 `daml test` proofs green** — privacy, atomic DvP, atomicity, conditional close, distribution
- Try it yourself: **atrium-omega.vercel.app**
> Speaker: Privacy and atomicity aren't claims — they're proven by Daml tests, and it runs live on Canton. There's a clickable demo anyone can open right now.

### 10 — Beyond the close: it's an operating system
**Atrium runs the ongoing cap table.**
- Founder declares a pro-rata **cBTC distribution**
- One atomic transaction pays every shareholder
- Each holder sees **only their own** private receipt
> Speaker: It's not a one-shot deal tool. Post-close, the founder runs capital events from the same place — distributions that are atomic and per-recipient private. That's the "operating system" claim.

### 11 — Honest boundaries
**What's real today, and the gap to production.**
- cBTC **modeled** via CIP-56 on devnet (production: BitSafe cBTC bridge)
- Documents encrypted off-ledger; Canton holds the hash + the grant
- Gap to prod: security audit · real cBTC bridge · legal wrapper · real registry
> Speaker: We're explicit about boundaries. The architecture is right and the privacy/atomicity are proven; production needs a real bridge, an audit, and legal wrappers.

### 12 — The ask / closing
**Atrium — where private deals are discovered, diligenced, funded, approved, and settled. On Canton.**
- Tracks: **Private DeFi & Capital Markets** + **RWA / Tokenized Assets**
- *Selective disclosure as the data room. Native atomic DvP as the close.*
> Speaker: One workflow, two Canton superpowers, fully private and provable end-to-end. That's Atrium.

---

### Tips for Canva
- Use **"Docs to Deck"**: paste this file's slide section and let Canva split per `###` heading.
- Keep each slide to its title + ≤4 short lines; move prose into the notes panel.
- Slide 8 → a horizontal flow diagram; Slide 7 → a 4-checkbox column; Slide 9 → big "8/8" stat.
- Reuse the color tokens above for accents so the deck matches the live product.
