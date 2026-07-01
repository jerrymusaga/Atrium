// Phase B tooling — inspect & install DARs on the participant Atrium's backend talks to.
// Uses backend/.env (LEDGER_API_URL + OIDC/token) via the default connection.
//
//   tsx scripts/dars.ts list                 # list installed package ids
//   tsx scripts/dars.ts upload <path.dar>    # upload one DAR (Splice token-standard / Registry / cBTC / cETH / USDCx)
//   tsx scripts/dars.ts upload a.dar b.dar   # upload several
//
// Verify success with `list` (and cbtc-lib's `check_dars`). If /v2/packages 404s, your build uses
// the participant admin PackageManagement API instead — adjust ledgerApi.uploadDar accordingly.
import { readFileSync } from 'fs'
import { basename } from 'path'
import { defaultConn, listPackages, uploadDar } from '../src/ledgerApi.js'

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'list') {
    const pkgs = await listPackages()
    console.log(`${pkgs.length} package(s) on ${defaultConn.baseUrl}:`)
    for (const p of pkgs) console.log('  ' + p)
    return
  }
  if (cmd === 'upload' && args.length) {
    for (const path of args) {
      process.stdout.write(`↑ ${basename(path)} → ${defaultConn.baseUrl} … `)
      await uploadDar(readFileSync(path))
      console.log('✓')
    }
    console.log('Done. Run `tsx scripts/dars.ts list` to confirm.')
    return
  }
  console.log('Usage:\n  tsx scripts/dars.ts list\n  tsx scripts/dars.ts upload <path.dar> [more.dar ...]')
  process.exit(1)
}
main().catch((e) => { console.error('✗ ' + (e?.message ?? e)); process.exit(1) })
