import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function getPackageScripts() {
  try {
    const pkgPath = resolve(process.cwd(), 'package.json')
    return new Set(Object.keys(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}))
  } catch {
    try {
      if (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')) {
        const fallbackPath = fileURLToPath(new URL('../../package.json', import.meta.url))
        return new Set(Object.keys(JSON.parse(readFileSync(fallbackPath, 'utf8')).scripts ?? {}))
      }
    } catch {
      // ignore
    }
    return new Set()
  }
}

const scriptNames = getPackageScripts()

const exec = promisify(execFile)
const SHA = /^[a-f0-9]{40}$/i
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const STATUSES = new Set(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate'])

export function parsePrNumbers(value) {
  if (typeof value !== 'string' || !/^\d+(,\d+)*$/.test(value)) throw new Error('INVALID_PR_NUMBERS')
  const numbers = [...new Set(value.split(',').map(Number))]
  if (numbers.length > 50 || numbers.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('INVALID_PR_NUMBERS')
  return numbers
}

export function safeAuditUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (url.origin === 'https://github.com' && /^\/[\w.-]+\/[\w.-]+\/(pull\/\d+|issues\/\d+|commit\/[a-f0-9]{40}|actions\/runs\/\d+|blob\/[a-f0-9]{40}\/[\w./-]+)$/.test(url.pathname)) return url.href
    if (url.origin === 'https://linear.app' && /^\/[\w-]+\/issue\/ANI-\d+(\/[\w%-]+)?$/.test(url.pathname)) return url.href
    return null
  } catch { return null }
}

export async function collectPr(number, repo, runner = async (file, args) => (await exec(file, args, { timeout: 30000, maxBuffer: 2_000_000 })).stdout) {
  if (!Number.isSafeInteger(number) || number <= 0 || typeof repo !== 'string' || !REPO.test(repo) || repo.startsWith('-')) throw new Error('INVALID_GITHUB_OPERAND')
  const raw = await runner('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'number,url,title,body,headRefOid,isDraft,state,statusCheckRollup'])
  const pr = JSON.parse(raw)
  if (pr.number !== number || pr.url !== `https://github.com/${repo}/pull/${number}` || !SHA.test(pr.headRefOid ?? '')) throw new Error('GITHUB_RESPONSE_MISMATCH')
  return pr
}

function ciState(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'UNKNOWN'
  const states = checks.map(check => String(check.conclusion || check.state || check.status || '').toUpperCase())
  if (states.some(state => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state))) return 'FAILING'
  if (states.some(state => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED'].includes(state))) return 'PENDING'
  return states.every(state => state === 'SUCCESS') ? 'GREEN_RECORDED' : 'UNKNOWN'
}

function safeCommand(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 30 || !['node', 'npm'].includes(value[0])) return null
  if (value.some(token => typeof token !== 'string' || token.length > 240 || !/^[A-Za-z0-9_./:@=-]+$/.test(token)
    || /(?:token|secret|password|api.?key|https?:|[\w.-]+@[\w.-]+\.|\b(?:sk|pk|rk|sb_secret)[-_][A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{10,})/i.test(token))) return null
  const safePath = token => /^(?:scripts|src|tests|node_modules)\/[A-Za-z0-9_./-]+$/.test(token) && !token.split('/').includes('..')
  const safeFlag = token => /^--(?:test|noEmit|max-old-space-size=\d{3,5}|no-file-parallelism|maxWorkers=\d+)$/.test(token)
  if (value[0] === 'npm') {
    if (value[1] === 'run' && value.length === 3 && scriptNames.has(value[2])) return [...value]
    if (value[1] === 'test' && value.slice(2).every(token => token === '--' || safePath(token) || safeFlag(token))) return [...value]
    return null
  }
  return value.slice(1).some(safePath) && value.slice(1).every(token => safePath(token) || safeFlag(token)) ? [...value] : null
}

function normalizeRun(run, head, now) {
  const command = safeCommand(run?.command)
  const start = Date.parse(run?.startedAt ?? '')
  const finish = Date.parse(run?.finishedAt ?? '')
  if (!command || !SHA.test(run?.gitSha ?? '') || !Number.isInteger(run?.exitCode) || run.exitCode < 0 || run.exitCode > 255) return null
  const current = run.gitSha.toLowerCase() === head.toLowerCase() && Number.isFinite(start) && Number.isFinite(finish) && start <= finish && finish <= now
  return {
    sha: run.gitSha.toLowerCase(), command, exitCode: run.exitCode,
    environment: ['LOCAL', 'CI', 'ISOLATED_DB', 'PRODUCTION', 'ACTUAL_PROVIDER', 'MOCK'].includes(run.environment) ? run.environment : 'UNKNOWN',
    startedAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
    finishedAt: Number.isFinite(finish) ? new Date(finish).toISOString() : null,
    shaBinding: current ? 'CURRENT_HEAD_RECORDED' : 'STALE_OR_INVALID_TIME',
    source: 'SUPPLIED_RECORD_NOT_INDEPENDENTLY_VERIFIED',
  }
}

function commandClaims(text) {
  const claims = []
  for (const name of scriptNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp('\\b(?:npm\\s+run\\s+)?' + escaped + '(?=[\\s`*:]|$)[\\s`*:]*(?:exit\\s*(?:code\\s*)?[:=]?\\s*)(\\d{1,3})\\b', 'gi')
    for (const match of text.matchAll(pattern)) {
      const exitCode = Number(match[1])
      if (exitCode <= 255 && claims.length < 100) claims.push({ command: ['npm', 'run', name], exitCode, source: 'PR_BODY_CLAIM_UNBOUND_TO_RUN' })
    }
  }
  return claims
}

/** No body instructions or reported receipts are executed or promoted to provider truth. */
export function buildBundle({ prs, linear = [], runs = [], now = new Date().toISOString() }) {
  if (!Array.isArray(prs) || prs.length > 50 || !Array.isArray(linear) || !Array.isArray(runs) || runs.length > 1000 || !Number.isFinite(Date.parse(now))) throw new Error('INVALID_BUNDLE_INPUT')
  const pullRequests = prs.map(pr => {
    if (!Number.isSafeInteger(pr?.number) || pr.number <= 0) throw new Error('INVALID_PR_NUMBER')
    if (pr.collectionError) return { number: pr.number, collectionState: 'ERROR', liveState: 'NOT_LIVE_VERIFIED', canAdvertiseLive: false, notVerified: ['GITHUB_READ_FAILED'] }
    if (!SHA.test(pr.headRefOid ?? '') || !safeAuditUrl(pr.url) || !new URL(pr.url).pathname.endsWith(`/pull/${pr.number}`)) throw new Error('INVALID_PR_SNAPSHOT')
    const text = `${typeof pr.title === 'string' ? pr.title : ''}\n${typeof pr.body === 'string' ? pr.body : ''}`
    const issueIds = [...new Set(text.match(/\bANI-\d+\b/g) ?? [])].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    const issues = issueIds.map(id => {
      const item = linear.find(issue => issue?.id === id)
      return { id, status: STATUSES.has(item?.status) ? item.status : 'NOT_FETCHED', url: `https://linear.app/ani430/issue/${id}`, relation: 'MENTIONED_IN_PR_NOT_VERIFIED_REQUIREMENT_COVERAGE' }
    })
    const normalized = runs.map(run => normalizeRun(run, pr.headRefOid, Date.parse(now))).filter(Boolean)
    const current = normalized.filter(run => run.shaBinding === 'CURRENT_HEAD_RECORDED')
    const state = ciState(pr.statusCheckRollup)
    const notVerified = ['PROVIDER_READBACK_NOT_INDEPENDENTLY_VERIFIED', 'ACCOUNT_CONTRACT_NOT_INDEPENDENTLY_VERIFIED', 'PRODUCTION_SAME_TRUTH_NOT_VERIFIED', 'REQUIREMENT_BDD_EVAL_COVERAGE_NOT_VERIFIED']
    if (!current.length) notVerified.push('RUNS_MISSING_OR_STALE')
    if (normalized.length < runs.length) notVerified.push('RUN_RECORDS_REJECTED')
    if (issues.some(issue => issue.status === 'NOT_FETCHED')) notVerified.push('LINEAR_SNAPSHOT_MISSING')
    if (state !== 'GREEN_RECORDED') notVerified.push('CI_UNKNOWN_OR_NOT_GREEN')
    if (/timeout|タイムアウト|타임아웃|통합.*미검증|DB.*NOT.?VERIFIED/i.test(text)) notVerified.push('SOURCE_MENTIONS_INTEGRATION_LIMITATIONS')
    if (/NOT.?VERIFIED|미검증|Known Limitations|NO.?GO/i.test(text)) notVerified.push('SOURCE_HAS_LIMITATIONS_REVIEW_AUDIT_LINK')
    const auditLinks = [...new Set((text.match(/https:\/\/[^\s<>"')]+/g) ?? []).map(safeAuditUrl).filter(Boolean))].slice(0, 100)
    return {
      number: pr.number, url: pr.url, sha: pr.headRefOid.toLowerCase(), collectionState: 'OBSERVED',
      draft: pr.isDraft === true, codeState: /(?:^|\n)(?:Status:\s*)?CODE_COMPLETE\s*(?:\n|$)/i.test(text) ? 'CODE_COMPLETE_CLAIMED' : 'NOT_ASSESSED',
      ciState: state, ciEvidenceSource: 'SNAPSHOT_CHECK_ROLLUP', issues, runs: normalized, commandClaims: commandClaims(text),
      runsState: !current.length ? 'MISSING_OR_STALE' : current.some(run => run.exitCode !== 0) ? 'FAIL_RECORDED' : 'PASS_RECORDED_NOT_INDEPENDENTLY_VERIFIED',
      liveState: 'NOT_LIVE_VERIFIED', canAdvertiseLive: false, notVerified, auditLinks,
    }
  })
  const ids = [...new Set([...linear.map(issue => issue?.id).filter(id => typeof id === 'string' && /^ANI-\d+$/.test(id)), ...pullRequests.flatMap(pr => (pr.issues ?? []).map(issue => issue.id))])].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
  const issueIndex = ids.map(id => {
    const linked = pullRequests.filter(pr => pr.issues?.some(issue => issue.id === id))
    const item = linear.find(issue => issue?.id === id)
    return { id, status: STATUSES.has(item?.status) ? item.status : 'NOT_FETCHED', pullRequests: linked.map(pr => pr.number), coverage: linked.length ? 'PR_MENTION_ONLY' : pullRequests.some(pr => pr.collectionState === 'ERROR') ? 'UNKNOWN_DUE_TO_COLLECTION_ERROR' : 'NO_PR_MENTION', liveState: 'NOT_LIVE_VERIFIED' }
  })
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), policy: 'READ_ONLY_NO_LIVE_AUTHORIZATION', rawBodiesStored: false, pullRequests, issueIndex }
}
