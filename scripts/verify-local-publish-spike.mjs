import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const allowedKeys = new Set([
  'channel', 'scenario', 'selectorVersion', 'startedAt', 'finishedAt',
  'ok', 'failureCode', 'mediaCount', 'resultUrl',
])

export function sanitizeEvidence(input) {
  const output = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!allowedKeys.has(key)) continue
    if (key === 'resultUrl' && typeof value === 'string') {
      try {
        const url = new URL(value)
        url.search = ''
        url.hash = ''
        output[key] = url.toString().replace(/\/$/, '')
      } catch { continue }
    } else output[key] = value
  }
  return output
}

export function summarize(input) {
  const summary = {}
  for (const raw of input) {
    const item = sanitizeEvidence(raw)
    if (typeof item.scenario !== 'string' || typeof item.ok !== 'boolean') continue
    const current = summary[item.scenario] ?? { total: 0, succeeded: 0, rate: 0 }
    current.total += 1
    if (item.ok) current.succeeded += 1
    current.rate = current.succeeded / current.total
    summary[item.scenario] = current
  }
  return summary
}

export function verifyThresholds(input) {
  const summary = summarize(input)
  const requirements = {
    text: { total: 10, rate: 1 },
    'single-image': { total: 10, rate: 1 },
    'multi-image': { total: 10, rate: 0.9 },
  }
  const failures = []
  for (const [scenario, expected] of Object.entries(requirements)) {
    const actual = summary[scenario]
    if (!actual || actual.total < expected.total || actual.rate < expected.rate) {
      failures.push({ scenario, expected, actual: actual ?? null })
    }
  }
  return { ok: failures.length === 0, failures }
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: node scripts/verify-local-publish-spike.mjs <evidence.json>')
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('Evidence must be a JSON array')
  const sanitized = parsed.map(sanitizeEvidence)
  const result = { evidence: sanitized, summary: summarize(sanitized), thresholds: verifyThresholds(sanitized) }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.thresholds.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
