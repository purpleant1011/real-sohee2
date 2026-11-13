import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const requiredLocalPublishEvidence = Object.freeze([
  ['controlPlane', 'control plane evidence missing'],
  ['extensionBuild', 'extension build evidence missing'],
  ['macos', 'macos evidence missing'],
  ['windows', 'windows evidence missing'],
  ['scheduleBoundary', 'schedule boundary evidence missing'],
  ['naverPrivateOrDraft', 'private or draft Naver evidence missing'],
  ['naverPublic', 'public Naver unverified'],
  ['daangnPreflight', 'Daangn preflight unverified'],
  ['daangnPublic', 'public Daangn unverified'],
  ['unknownResultBlock', 'unknown result duplicate block missing'],
  ['rollback', 'rollback evidence missing'],
])

function isVerified(value) {
  return value === true || (typeof value === 'object' && value !== null && value.verified === true)
}

export function verifyRelease(evidence) {
  for (const [key, message] of requiredLocalPublishEvidence) {
    if (!isVerified(evidence?.[key])) throw new Error(message)
  }
  return { ok: true, verified: requiredLocalPublishEvidence.length }
}

async function main() {
  const evidencePath = process.env.SOHEE_LOCAL_PUBLISH_RELEASE_EVIDENCE
  if (!evidencePath) throw new Error('release evidence path missing: set SOHEE_LOCAL_PUBLISH_RELEASE_EVIDENCE')
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  const result = verifyRelease(evidence)
  process.stdout.write(`Local publish release verified: ${result.verified}/${result.verified}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Local publish release blocked: ${error instanceof Error ? error.message : 'unknown evidence error'}\n`)
    process.exitCode = 1
  })
}
