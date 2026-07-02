# atrium-backend — the executor app

The **executor / settlement venue**: it holds the operator connection to the Canton **JSON Ledger
API v2**, resolves the demo parties, serves each caller a ledger-scoped view (selective disclosure
enforced by Canton), and drives commitments, the e-sign approvals, the conditional atomic close, and
the post-close distribution. It runs **LIVE against a real Canton validator** (see `.env`).

```bash
npm install
npm run dev     # http://localhost:8080 (tsx watch)
npm start       # production start (tsx)
```

## Environment (`backend/.env`)
Secrets live only here (gitignored). Keys: `LEDGER_API_URL`, `OIDC_*` (client-credentials to the
validator), `ATRIUM_PKG` (uploaded DAR package id), `PARTY_PREFIX`, `PARTY_NAMESPACE`,
`LEDGER_GRANT_ACT_AS`, `VENICE_API_KEY` (copilot), `PORT`. Extra for hosting: `CORS_ORIGIN`
(comma-separated frontend origins, default `*`).

## DAR tooling
```bash
npm run dars -- list                       # packages installed on the validator
npm run dars -- upload ../ledger/.daml/dist/atrium-cm-<v>.dar
```
Then set `ATRIUM_PKG` to the new package id and `POST /deals/HALDEN-2026-A/seed`.

## Deploy to Railway
1. New Railway project → deploy from this repo; **set Root Directory to `backend`**.
2. Railway auto-detects Node (Nixpacks) and runs `npm start` (see `railway.json`). `tsx` is a
   runtime dependency, so it boots on a production install. `PORT` is injected automatically.
3. **Add every `.env` key as a Railway Variable** (Railway has none of your local `.env`):
   `LEDGER_API_URL`, all `OIDC_*`, `ATRIUM_PKG`, `PARTY_PREFIX`, `PARTY_NAMESPACE`,
   `LEDGER_GRANT_ACT_AS`, `VENICE_API_KEY`, and `CORS_ORIGIN=https://<your-vercel-app>.vercel.app`.
4. Point the frontend at it: on Vercel set `VITE_LIVE=1` and `VITE_API_URL=https://<railway-app>.up.railway.app`.
5. (Optional) Attach a **Volume** mounted at the vault dir + set `VAULT_DIR` if you want uploaded
   documents to survive restarts — otherwise the seeded demo just re-creates itself on boot.

Notes: ledger txns are free (devnet CC, paid by the validator). `/ask` (Venice copilot) is
rate-limited (~12/min/IP) to protect the API key on a public URL. The executor acts on behalf of
all parties and holds validator creds — fine on reseeddable devnet; it's a shared demo instance.
```
