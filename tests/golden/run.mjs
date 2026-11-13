import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { assessTask, summarize } from './engine.ts'
import { buildGoldenReport, uniqueContractTests } from './coverage.ts'
import { ALLOWED_APPROVERS } from './approvals.ts'

// Run with:
//   node --experimental-strip-types tests/golden/run.mjs               -> offline status only (no tests executed)
//   node --experimental-strip-types tests/golden/run.mjs --run-tests   -> executes the linked deterministic tests
// No credentials, provider calls or arbitrary evidence-file ingestion. An offline rubric cannot
// authenticate external receipts and therefore cannot authorize release.
const root = resolve(new URL('.', import.meta.url).pathname, '../..')
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
const coverage = JSON.parse(readFileSync(new URL('./coverage.json', import.meta.url), 'utf8'))
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

/** @returns {Record<string, 'PASS'|'FAIL'|'MISSING'>} file-level outcomes of the linked contract tests */
function runLinkedTests() {
  const files = uniqueContractTests(coverage)
  const outputFile = join(mkdtempSync(join(tmpdir(), 'golden-')), 'vitest.json')
  const run = spawnSync('npx', ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${outputFile}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'inherit'] })
  if (!existsSync(outputFile)) throw new Error(`vitest produced no report (exit ${run.status})`)
  const report = JSON.parse(readFileSync(outputFile, 'utf8'))
  const byFile = new Map(report.testResults.map((entry) => [relative(root, entry.name), entry.status === 'passed' ? 'PASS' : 'FAIL']))
  return Object.fromEntries(files.map((file) => [file, byFile.get(file) ?? 'MISSING']))
}

const runTests = process.argv.includes('--run-tests')
const outcomes = runTests ? runLinkedTests() : {}

// The approval file is read from this fixed path and nowhere else. It is never taken from argv or
// the environment, so no caller can point the gate at an approval file of their choosing. A missing
// or unreadable file means "no approvals", which can only ever keep the verdict at NO_GO.
const APPROVALS_URL = new URL('./approvals.json', import.meta.url)
let approvalFile
if (existsSync(APPROVALS_URL)) {
  try {
    approvalFile = JSON.parse(readFileSync(APPROVALS_URL, 'utf8'))
  } catch {
    // An unparsable file must not be silently treated as empty and must not crash the gate either.
    approvalFile = { unparsable: true }
  }
}

const report = buildGoldenReport(manifest, coverage, outcomes, approvalFile, {
  repoRoot: root,
  allowedApprovers: ALLOWED_APPROVERS,
})
// Legacy trace-based rubric stays: no trace is supplied here, so it can only say NO_TRACE.
const expected = { commitSha, model: 'NOT_OBSERVED', prompt: 'NOT_OBSERVED', tools: 'NOT_OBSERVED', rubric: manifest.version }
const traceRubric = summarize(manifest.tasks.map((task) => assessTask(task, undefined, expected)))

console.log(JSON.stringify({
  rubric: report.rubric, generatedAt: new Date().toISOString(), environment: 'OFFLINE_RUBRIC', baseCommitSha: commitSha,
  sourceState: 'WORKTREE_NOT_PRODUCTION_ATTESTATION', testsExecuted: runTests,
  tasks: report.tasks, counts: report.counts, checkCounts: report.checkCounts, releaseVerdict: report.releaseVerdict,
  approvalsApplied: report.approvalsApplied, approvalErrors: report.approvalErrors, traceRubricCounts: traceRubric.counts,
  limitation: 'CONTRACT_PASS = offline deterministic tests only. Live DB/browser/provider evidence is NOT_VERIFIED and is never counted as a pass. NOT_VERIFIED_APPROVED is a human-accepted gap, not evidence.',
}, null, 2))
// 1 = known failure, 2 = not verified. Never report absent evidence as CI green.
process.exitCode = report.exitCode
