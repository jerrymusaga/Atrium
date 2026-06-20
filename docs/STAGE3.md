# Stage 3 — Atrium on LocalNet (real Amulet registry leg)

Stage 2.5 already runs Atrium end-to-end on a **real Canton ledger** via `daml sandbox` (see
`docs/CONTEXT.md`). Stage 3 swaps the *mock* `Atrium.Dvp` cash leg for the **real Splice/Amulet
registry** on LocalNet. The diligence + privacy half is unchanged; only the cash leg of the close
graduates from our mock `Holding` to Amulet (Canton Coin).

## Prerequisite reality check (verified 2026-06-20)
LocalNet is the full Splice stack: Canton nodes + a super-validator (the Amulet registry) + PQS
(Postgres Query Store) + onboarding + optional keycloak/observability.

- **RAM: ~16 GB host.** The quickstart's *resource-constrained* profile alone declares ~13 GB of
  container `mem_limit`s (4G + 3G + 2G + 2G + smaller). This does **not** fit the 8 GB dev machine
  used this session (Docker VM was allocated 3.8 GiB) — Stage 3 is blocked here on hardware, not code.
  Run it on a ≥16 GB machine or a cloud VM.
- **Docker + Compose v2**, **JVM 21** (have both), and the project's **nix + direnv** toolchain
  (`direnv allow` at the repo root) which pins `DAML_RUNTIME_VERSION=3.4.11` / `SPLICE_VERSION=0.5.3`.

## Bring-up (on a capable machine)
```bash
git clone https://github.com/digital-asset/cn-quickstart.git
cd cn-quickstart && direnv allow && cd quickstart
make setup     # gradlew configureProfiles TUI → writes .env.local (LocalNet; OAuth/Observability off for a lean run)
make build     # frontend + backend + daml + docker images (long; pulls many GB)
make start     # Canton + Splice LocalNet + Amulet registry
make status    # wait for healthy; `make canton-console` for the App Provider console
```
LocalNet exposes a **JSON Ledger API v2 per participant** — the *same* API Atrium's executor already
drives against the sandbox. The App Provider participant is the one Atrium uses.

## Deploying Atrium + pointing the executor at LocalNet
Our integration is already API-compatible; only the endpoint + auth change.

1. **Rebuild the DAR for 3.4** if the LF/runtime differs: bump `ledger/daml.yaml` `sdk-version` to the
   LocalNet runtime (`3.4.11`) and `daml build`. The templates use only stable stdlib, so no code change
   is expected. `make ledger-test` should stay green.
2. **Upload** `ledger/.daml/dist/atrium-0.1.0.dar` to the App Provider participant (its JSON API
   `/v2/packages` upload, or `daml ledger upload-dar --host … --port …`, or via `make canton-console`).
3. **Onboard parties** Halden / Boranic / Meridian on the App Provider node (the executor's
   `ensureParty` already does this via `/v2/parties`), then run `setupDemo`-equivalent creates.
4. **Point the executor** at LocalNet — these are already plumbed through `backend/src/ledgerApi.ts`:
   ```bash
   LEDGER_API_URL=http://localhost:<app-provider-json-api-port> \
   LEDGER_TOKEN=<JWT for the App Provider user> \
   LEDGER_USER_ID=<app-provider user id> \
   npm --prefix backend run dev
   ```
   (Sandbox needed no token; LocalNet issues a JWT — set `LEDGER_TOKEN` and it rides through as a Bearer.)

## The only real swap: the cash leg
- **Mock today** (`Atrium.Dvp`): `Holding` / `AllocationFactory` / `Allocation` / `SettlementCoordinator`,
  proven atomic by `testAtomicDvP` + `testAtomicityHolds` and run live in Stage 2.5.
- **Stage 3:** replace the cash-leg `Holding`/`Allocation` with Splice
  `Splice.Api.Token.HoldingV1` / `AllocationV1` / `AllocationInstructionV1`, fetch the
  `Allocation_ExecuteTransfer` **choice context** from the Amulet registry OpenAPI, **dedupe disclosed
  contracts by contract-id**, and exercise both legs in one command as the executor.
- The ownership leg can stay the bespoke `Holding` (MVP) or become a `ShareCertificate` (post-MVP).

**Gate (from the 4-week plan):** Stage 3 green → proceed; red → fall back to sealed-bid issuance
(same atomic close, one privacy surface).
