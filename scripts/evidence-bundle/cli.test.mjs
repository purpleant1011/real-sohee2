// @vitest-environment node
import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const test = process.env.VITEST ? (await import('vitest')).test : nodeTest

function getCliPath() {
  const defaultPath = resolve(process.cwd(), 'scripts/evidence-bundle/cli.mjs')
  if (existsSync(defaultPath)) return defaultPath
  try {
    if (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')) {
      return fileURLToPath(new URL('./cli.mjs', import.meta.url))
    }
  } catch {
    // ignore
  }
  return defaultPath
}

const cli = getCliPath()
test('offline CLI writes only sanitized data and refuses to overwrite existing evidence', () => {
 const root = mkdtempSync(join(tmpdir(), 'w2-evidence-cli-'))
 try {
  const input = join(root, 'input.json')
  writeFileSync(input, JSON.stringify([{ number: 1717, url: 'https://github.com/example-owner/real-sohee/pull/1717', headRefOid: 'a'.repeat(40), title: 'ANI-1637', body: 'private@example.com', statusCheckRollup: [] }]))
  const args = [cli, '--snapshot', input, '--out', 'docs/qa/v093/bundle.json']
  const first = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  const output = readFileSync(join(root, 'docs/qa/v093/bundle.json'), 'utf8')
  assert.equal(output.includes('private@example.com'), false)
  assert.equal(JSON.parse(output).provenance.commandsExecutedFromEvidence, 0)
  const repeat = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
  assert.equal(repeat.status, 1)
  assert.match(repeat.stderr, /OUTPUT_EXISTS_NOT_OVERWRITTEN/)
 } finally { rmSync(root, { recursive: true, force: true }) }
})
test('CLI refuses outside output and mixed online/offline modes before network reads', () => {
 const root = mkdtempSync(join(tmpdir(), 'w2-evidence-cli-'))
 try {
  for (const args of [['--snapshot','missing.json','--prs','1717'], ['--snapshot','missing.json','--out','package.json']]) {
   const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' })
   assert.equal(result.status, 1)
  }
 } finally { rmSync(root, { recursive: true, force: true }) }
})
