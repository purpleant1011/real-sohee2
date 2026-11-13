// ANI-1565: build-time version metadata. package.json version + git SHA -> src/generated/build-meta.json.
// Nothing here is hand-edited; the admin UI reads this file and shows "알 수 없음" when a value is missing.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readVersion() {
  try {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    return typeof version === 'string' && version.length > 0 ? version : null
  } catch {
    return null
  }
}

function readSha() {
  const fromEnv = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.toLowerCase()
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : null
  } catch {
    return null
  }
}

const target = join(root, 'src/generated/build-meta.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify({ version: readVersion(), sha: readSha() }, null, 2)}\n`)
console.log(`build-meta written: ${target}`)
