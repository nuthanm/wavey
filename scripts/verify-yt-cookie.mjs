/**
 * Quick check: is YT_COOKIE present and shaped for age-restricted pulls?
 * Usage: node scripts/verify-yt-cookie.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(filename) {
  const path = resolve(process.cwd(), filename)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i <= 0) continue
    const key = trimmed.slice(0, i).trim()
    let val = trimmed.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnv('.env.local')
loadEnv('.env')

const raw = process.env.YT_COOKIE || ''
if (!raw.trim()) {
  console.log('❌ YT_COOKIE is not set')
  console.log('   Add it to .env.local (see .env.example), then restart npm run dev.')
  console.log('   Until then, age-restricted YouTube videos will keep failing.')
  process.exit(1)
}

const parts = Object.fromEntries(
  raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=')
      return i > 0 ? [p.slice(0, i), p.slice(i + 1)] : [p, '']
    }),
)

const hasSapisid = Boolean(parts.SAPISID || parts['__Secure-3PAPISID'])
const hasSid = Boolean(parts.SID || parts['__Secure-3PSID'] || parts.SSID)

if (hasSapisid && hasSid) {
  console.log('✅ YT_COOKIE looks usable for age-restricted pulls')
  console.log('   Restart the dev server / redeploy so the API picks it up.')
  process.exit(0)
}

console.log('⚠️  YT_COOKIE is set but incomplete')
if (!hasSid) console.log('   missing SID / __Secure-3PSID')
if (!hasSapisid) console.log('   missing SAPISID / __Secure-3PAPISID')
console.log('   Copy the FULL Cookie header from a logged-in youtube.com request.')
process.exit(1)
