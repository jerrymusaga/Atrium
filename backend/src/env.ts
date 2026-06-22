// Load backend/.env (gitignored — holds hosted-validator creds) BEFORE any process.env read.
// Imported first by ledgerApi.ts so its module-level config picks the values up. Node 22 built-in,
// no dependency. Harmless when there's no .env (local sandbox runs on real env / defaults).
try {
  ;(process as { loadEnvFile?: () => void }).loadEnvFile?.()
} catch {
  /* no .env file — fine */
}
