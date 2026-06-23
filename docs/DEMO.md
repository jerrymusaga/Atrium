# Atrium — submission & demo playbook

You've built it and it runs live. This is the ship-it checklist. **Stop building; start packaging.**

## Priority order (do these in sequence)
1. **Lock the submission** (both tracks) — get the form filled with placeholders TODAY, even before polish.
2. **Record the demo video** — the single biggest factor in a hackathon result. Script below.
3. **One-page pitch / short deck** — outline below.
4. **(Optional) cross-node demo** — only if the Encode org validator is ready in time.

Don't add features. The product is strong; every hour now goes to making it *legible* to judges.

## The 90-second pitch (memorize this)
> Every data room today — Datasite, Intralinks — is a filing cabinet with permissions. The actual
> close happens off-platform, through lawyers and escrow, over weeks. **Atrium makes the room itself
> settle.** The same private object you run diligence on is the one that closes — payment vs tokenized
> ownership, atomically, in one transaction. It works because Canton gives two things no transparent
> chain can: **selective disclosure** (each buyer sees only their tier; rivals are invisible) *is* the
> data room, and **native atomic DvP** *is* the close. Compliant (KYC/KYB-gated), provable (daml tests),
> and running live on a real hosted Canton validator.

One-liner: **"The data room that closes."**

## Demo video — shot list (~2.5 min)
**Record the LIVE app** (`make sandbox` is NOT needed — point at Seaport): `make backend` + `make
frontend-live`. Everything below runs against a **real hosted Canton validator**, not a mock. Lens-flips
are prefetched so they're instant despite validator latency. Re-runnable: `POST /deals/HALDEN-2026-A/reset-close`
between takes resets the close to pre-settle. (The in-browser mock, `make frontend`, stays as an offline
fallback only — do not lead with it.)

1. **Hook (0:00–0:15)** — title card + the pitch's first two sentences. Land "the room itself settles."
2. **The privacy money shot (0:15–1:00)** — flip the lens:
   - **Meridian (tier 2):** **Open the audited financials** → the modal decrypts and shows the real
     numbers; note the footer: *"AES-256-GCM · key released because the ledger confirms your tier-2 grant."*
   - **Boranic (tier 1):** try the financials → **cryptographically denied** — *"the key service will not
     release the key."* The rival's bid is also **gone** from its view.
   - **Halden (seller):** sees everything — both docs, the bid, the full access trail.
   - Say: *"Same deal, three realities. The documents are encrypted off-ledger; Canton decides who gets the
     key. A tier-1 buyer can't decrypt tier-2 — not by UI, by cryptography. And every open is logged on-ledger."*
3. **Onboard + bid (0:55–1:15)** — as seller, **Invite a buyer**; switch to that buyer, **submit a bid**.
   Shows it's dynamic, not hard-coded.
4. **The close (1:15–1:45)** — as seller, note the **✓ KYC** badge (Accept is disabled without it),
   **Accept**, then **Settle** → the atomic-swap animation. *"Payment vs ownership. One transaction."*
5. **All-or-nothing (1:45–2:05)** — **Stress-test: pull a leg** → the close reverts, nothing moves.
   *"No partial settlement is representable. It's atomic, or it doesn't happen."*
6. **Regulator (2:05–2:15)** — switch to the Regulator lens, **attest** the close matched the recorded
   bid — *"without ever seeing the confidential tier-2 documents."*
7. **The kicker (2:15–2:35)** — terminal cutaway:
   - `make ledger-test` → **5 green** (privacy, atomic DvP, atomicity, KYC gate).
   - A live `curl` of the Seaport view showing Boranic can't see the rival offer.
   - *"This isn't a mock. It's running on a real hosted Canton validator, right now."*
8. **Close (2:35–2:45)** — title card: *Atrium — the data room that closes. Private DeFi & Capital
   Markets · RWA / Tokenized Assets · Built on Canton.*

## Short deck (5–6 slides)
1. **Problem** — data rooms don't close; the close is weeks of off-platform escrow + lawyers.
2. **Insight** — on Canton, selective disclosure *is* the data room; atomic DvP *is* the close.
3. **Product** — the three-view privacy demo + the one-transaction close (screenshots).
4. **Why it's real** — provable (5 daml tests), compliant (KYC/KYB-gated), **live on hosted Canton**.
5. **Honest boundary** — docs encrypted off-chain; gap to production (audit, legal wrapper, real registry).
6. **Ask / what's next** — Splice/Amulet cash leg; multi-validator (already wired).

## Submission form — have these ready
- Name: **Atrium — the data room that closes**
- Tracks: **Private DeFi & Capital Markets** (primary) + **RWA / Tokenized Assets**
- Repo: github.com/jerrymusaga/Atrium
- One-liner + the 90-second pitch above
- Video link
- "Built on Canton": selective disclosure + native atomic DvP (CIP-56/Splice), live on a Seaport validator

## Recording tips
- **Live UI** (`make frontend-live`) — it's on real Canton and now snappy (prefetched lenses). The
  footer shows "● LIVE on Canton" — keep it in frame; it's proof this isn't a mock.
- Between takes, reset the close: `curl -X POST localhost:8080/deals/HALDEN-2026-A/reset-close`.
- Terminal cutaway for `make ledger-test` (5 green) + a live `curl` of a buyer view (rival offer absent).
- Reduced-motion off so the swap/redaction animations play.
- Keep it under 3 min. Lead with the multi-tier privacy flip — a *multi-party deal room*, not a two-party
  toy. That depth is the thing competitors' broad platforms don't have.
