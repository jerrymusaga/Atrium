# Atrium

**The data room that closes.** A privacy-preserving M&A / deal-execution app on Canton Network:
the same private, permissioned object you do due diligence on is the one that settles —
payment vs tokenized ownership, atomically, in one transaction.

Built for the Encode Club **Build on Canton** hackathon. Full background, design rationale, and
the honest production boundary are in **`docs/`** — start with `docs/CONTEXT.md`.

## What runs today vs. what needs LocalNet

| Part | Runs now? | How |
|---|---|---|
| `frontend/` demo UI | ✅ standalone | in-browser mock ledger — `cd frontend && npm install && npm run dev` |
| `ledger/` Daml + DvP proof | ✅ with the Daml SDK | `cd ledger && daml build && daml test` |
| `backend/` executor | ⚠️ stub | returns mock data; `// TODO(ledger)` marks Stage-3 wiring |
| Real ledger integration | ⛔ Stage 3 | needs cn-quickstart on LocalNet (Docker, JVM 17+, 8GB) |

## Layout
```
atrium/
  ledger/     Daml package — DealRoom model + the atomic DvP (Atrium/*.daml)
  frontend/   React + TS console — viewer lens, redacted docs, audit trail, the close
  backend/    Executor app stub — holds the operator party, drives the AllocationV1 close
  docs/       CONTEXT.md (handoff) · ASSESSMENT.md (deep dive) · USER_STORY.md
```

## Quick start (the demo)
```bash
cd frontend && npm install && npm run dev   # open http://localhost:5173
```
Switch the **viewing lens** (top-left) between Halden / Boranic / Meridian / Regulator and watch
the same deal redact and reveal per party — then settle the close as the seller.

## Next
Stand up cn-quickstart on LocalNet, then `cd ledger && daml build && daml test` to verify the
atomic DvP. See `docs/CONTEXT.md` → "Immediate next action".
