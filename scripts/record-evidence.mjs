#!/usr/bin/env node
// 사용: node scripts/record-evidence.mjs <항목id> -- <명령...>
//       node scripts/record-evidence.mjs <항목id> --blocked "<사유>"
// 명령을 실제로 실행하고 종료코드·요약·시각·git SHA 를 evidence/runs/<항목id>.json 에 기록한다.
// 패널(ANI-1562)은 이 결과만 읽는다. 통과 여부를 직접 쓰는 옵션은 없다.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const KNOWN_IDS = [
  'deploy-sha', 'migration-match', 'golden-e2e', 'tenant-isolation',
  'user-copy', 'typecheck', 'mobile-evidence', 'no-external-publish',
]
const MAX_LOG = 200_000

const argv = process.argv.slice(2)
const itemId = argv[0]
if (!itemId || !KNOWN_IDS.includes(itemId)) {
  console.error(`알 수 없는 항목 id: ${itemId ?? '(없음)'}\n사용 가능: ${KNOWN_IDS.join(', ')}`)
  process.exit(64)
}

function redact(text) {
  return text
    .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, '[REDACTED_JWT]')
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/((?:token|secret|password|apikey|api_key)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
}

const cwd = process.cwd()
const runsDir = path.join(cwd, 'evidence', 'runs')
const logsDir = path.join(runsDir, 'logs')
mkdirSync(logsDir, { recursive: true })

function gitSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function write(record) {
  writeFileSync(path.join(runsDir, `${itemId}.json`), `${JSON.stringify(record, null, 2)}\n`)
}

const rest = argv.slice(1)
if (rest[0] === '--blocked') {
  const reason = rest.slice(1).join(' ').trim()
  if (!reason) { console.error('--blocked 에는 사유가 필요해요.'); process.exit(64) }
  const now = new Date().toISOString()
  write({ itemId, command: '(실행 못함)', exitCode: null, blocked: reason, summary: reason, startedAt: now, finishedAt: now, gitSha: gitSha(), logPath: null })
  console.log(`[evidence] ${itemId}: BLOCKED`)
  process.exit(0)
}

const sep = rest.indexOf('--')
const command = sep === -1 ? [] : rest.slice(sep + 1)
if (command.length === 0) { console.error('사용: record-evidence.mjs <항목id> -- <명령...>'); process.exit(64) }

const startedAt = new Date().toISOString()
let output = ''
const child = spawn(command[0], command.slice(1), { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
const collect = (stream, sink) => stream.on('data', (chunk) => {
  sink.write(chunk)
  output += chunk.toString('utf8')
  if (output.length > MAX_LOG * 2) output = output.slice(-MAX_LOG)
})
collect(child.stdout, process.stdout)
collect(child.stderr, process.stderr)

child.on('error', (error) => finish(127, `실행 실패: ${error.message}`))
child.on('close', (code, signal) => finish(code ?? (signal ? 128 : 1), ''))

let finished = false
function finish(exitCode, extra) {
  if (finished) return
  finished = true
  const finishedAt = new Date().toISOString()
  const clean = redact(`${output}${extra ? `\n${extra}` : ''}`).slice(-MAX_LOG)
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean)
  const summary = (lines.slice(-6).join(' | ') || '(출력 없음)').slice(0, 600)
  const logRel = path.posix.join('evidence', 'runs', 'logs', `${itemId}.log`)
  writeFileSync(path.join(cwd, logRel), `$ ${command.join(' ')}\n# exit ${exitCode} @ ${finishedAt}\n\n${clean}\n`)
  write({ itemId, command: command.join(' '), exitCode, blocked: null, summary, startedAt, finishedAt, gitSha: gitSha(), logPath: logRel })
  console.log(`[evidence] ${itemId}: exit ${exitCode} -> evidence/runs/${itemId}.json`)
  process.exit(exitCode)
}
