import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from './manifest.json'
import coverageJson from './coverage.json'
import { assessCheck, assessTaskCoverage, buildGoldenReport, uniqueContractTests, type CoverageFile, type FileOutcome } from './coverage'
import { ALLOWED_APPROVERS, type ApprovalRecord } from './approvals'
import type { GoldenTask } from './engine'

const tasks: GoldenTask[] = manifest.tasks
const coverage = coverageJson as unknown as CoverageFile
const allPass = (): Record<string, FileOutcome> => Object.fromEntries(uniqueContractTests(coverage).map((file) => [file, 'PASS' as const]))

describe('ANI-1632 coverage map is complete and honest', () => {
  it('maps exactly the manifest checks of exactly G093-01..12 (Doc 12 §2)', () => {
    expect(tasks.map((task) => task.id)).toEqual(Array.from({ length: 12 }, (_, i) => `G093-${String(i + 1).padStart(2, '0')}`))
    expect(Object.keys(coverage.tasks)).toEqual(tasks.map((task) => task.id))
    for (const task of tasks) expect(Object.keys(coverage.tasks[task.id]).sort()).toEqual([...task.checks].sort())
  })

  it('links only existing repo-relative test files', () => {
    for (const file of uniqueContractTests(coverage)) {
      expect(file.startsWith('/') || file.includes('..'), file).toBe(false)
      expect(existsSync(resolve(__dirname, '../..', file)), file).toBe(true)
    }
  })

  it('requires a contract test or a stated live requirement for every check, with a written reason', () => {
    for (const task of tasks) for (const [checkId, entry] of Object.entries(coverage.tasks[task.id])) {
      expect(entry.contractTests.length > 0 || entry.live, `${task.id}/${checkId}`).toBeTruthy()
      if (entry.live) expect(entry.live.reason.length, `${task.id}/${checkId}`).toBeGreaterThan(8)
    }
  })

  it('keeps every contract-gated check live-required, so a missing contract can never read as a pass', () => {
    for (const task of tasks.filter((t) => t.requiresContract)) {
      expect(coverage.tasks[task.id]['contract-gate'].live?.requires, task.id).toBe('PROVIDER_CONTRACT')
    }
  })

  it('covers every common failure scenario named in Doc 12 §4', () => {
    const scenarios = (id: string) => tasks.find((t) => t.id === id)!.failureScenarios.join('|')
    expect(scenarios('G093-04')).toMatch(/만료 토큰/) // OAuth expiry
    expect(scenarios('G093-03')).toMatch(/429\/5xx/)
    expect(scenarios('G093-05')).toMatch(/429\/5xx/)
    expect(scenarios('G093-05')).toMatch(/DM timeout/)
    expect(scenarios('G093-06')).toMatch(/승인 직후 새 메시지/)
    expect(scenarios('G093-07')).toMatch(/동시 2요청/)
    expect(scenarios('G093-09')).toMatch(/중복 webhook/)
    expect(scenarios('G093-09')).toMatch(/환불 지연/)
    expect(scenarios('G093-12')).toMatch(/빈 데이터/)
    expect(scenarios('G093-02')).toMatch(/크레딧 예약 실패/)
    const crossTenant = tasks.filter((t) => t.forbiddenActions.includes('cross_tenant')).map((t) => t.id)
    expect(crossTenant).toEqual(expect.arrayContaining(['G093-01', 'G093-02', 'G093-05', 'G093-07', 'G093-09', 'G093-12']))
  })

  it('records the mobile/offline Doc 12 §4 scenarios as NOT_VERIFIED, never as covered', () => {
    const common = (coverageJson as { commonScenarios: Record<string, { status: string }> }).commonScenarios
    expect(common['mobile-360-375-ios-android'].status).toBe('NOT_VERIFIED')
    expect(common['network-loss-and-pwa-resume'].status).toBe('NOT_VERIFIED')
  })
})

describe('ANI-1632 check/task verdicts (BDD)', () => {
  const entry = { contractTests: ['a.test.ts'] }
  it('Given green contract tests and no live requirement, Then CONTRACT_PASS (offline only)', () => {
    expect(assessCheck('c', entry, { 'a.test.ts': 'PASS' })).toMatchObject({ status: 'CONTRACT_PASS' })
  })
  it('Given green contract tests but a live requirement, Then NOT_VERIFIED, not PASS', () => {
    expect(assessCheck('c', { ...entry, live: { requires: 'ISOLATED_DB', reason: '실DB가 필요합니다' } }, { 'a.test.ts': 'PASS' }))
      .toEqual({ checkId: 'c', status: 'NOT_VERIFIED', reasons: ['LIVE_REQUIRED:ISOLATED_DB'] })
  })
  it('Given a failing or missing linked test, Then FAIL even when live evidence is also missing', () => {
    expect(assessCheck('c', { ...entry, live: { requires: 'BROWSER', reason: '실브라우저가 필요합니다' } }, { 'a.test.ts': 'FAIL' }).status).toBe('FAIL')
    expect(assessCheck('c', entry, { 'a.test.ts': 'MISSING' }).reasons).toEqual(['TEST_FILE_MISSING:a.test.ts'])
  })
  it('Given tests that were not run, Then NOT_VERIFIED rather than PASS or FAIL', () => {
    expect(assessCheck('c', entry, {})).toMatchObject({ status: 'NOT_VERIFIED', reasons: ['CONTRACT_TESTS_NOT_RUN'] })
  })
  it('Given a check without contract test or live requirement, Then NOT_VERIFIED (no evidence source)', () => {
    expect(assessCheck('c', { contractTests: [] }, {})).toMatchObject({ status: 'NOT_VERIFIED', reasons: ['NO_EVIDENCE_SOURCE'] })
    expect(assessCheck('c', undefined, {})).toMatchObject({ status: 'NOT_VERIFIED', reasons: ['NO_COVERAGE_ENTRY'] })
  })
  it('a single failing check fails its task regardless of the other passing checks', () => {
    const g06 = tasks.find((t) => t.id === 'G093-06')!
    const outcomes = allPass()
    expect(assessTaskCoverage(g06, coverage, outcomes, manifest.version).status).toBe('CONTRACT_PASS')
    outcomes['src/features/booking-recovery/__tests__/approval-binding.test.ts'] = 'FAIL'
    expect(assessTaskCoverage(g06, coverage, outcomes, manifest.version).status).toBe('FAIL')
  })
  it('live-gated tasks stay NOT_VERIFIED even when every linked test passes', () => {
    for (const id of ['G093-01', 'G093-07', 'G093-09', 'G093-10']) {
      expect(assessTaskCoverage(tasks.find((t) => t.id === id)!, coverage, allPass(), manifest.version).status, id).toBe('NOT_VERIFIED')
    }
  })
})

describe('ANI-1632 report', () => {
  it('without any test run every task is NOT_VERIFIED, the verdict is NO_GO and exit code is 2', () => {
    const report = buildGoldenReport(manifest as never, coverage, {})
    expect(report.tasks).toHaveLength(12)
    expect(report.tasks.every((t) => t.status === 'NOT_VERIFIED')).toBe(true)
    expect(report).toMatchObject({ releaseVerdict: 'NO_GO', exitCode: 2 })
  })
  it('with all linked tests green but no approval file the verdict is still NO_GO (exit 2), never 0', () => {
    const report = buildGoldenReport(manifest as never, coverage, allPass())
    expect(report.counts.FAIL).toBe(0)
    // Every live-gated check is still unattributed, so nothing may reach GO.
    expect(report.checkCounts.NOT_VERIFIED).toBeGreaterThan(0)
    expect(report.approvalsApplied).toBe(0)
    expect(report).toMatchObject({ releaseVerdict: 'NO_GO', exitCode: 2 })
  })
  it('a failing linked test is exit 1 and names the file but no payloads', () => {
    const outcomes = allPass()
    outcomes['src/features/membership/grant-connected-signup-credits.test.ts'] = 'FAIL'
    const report = buildGoldenReport(manifest as never, coverage, outcomes)
    expect(report.exitCode).toBe(1)
    expect(report.tasks[0].checks.find((c) => c.checkId === 'taste-grant-once')!.reasons)
      .toEqual(['CONTRACT_TEST_FAILED:src/features/membership/grant-connected-signup-credits.test.ts'])
  })
})

// --- ANI-1655: approved NOT_VERIFIED ------------------------------------------------
const NOW = new Date('2026-10-23T03:00:00Z')
const approver = ALLOWED_APPROVERS[0]
const approvalCtx = { repoRoot: resolve(__dirname, '../..'), allowedApprovers: ALLOWED_APPROVERS, now: NOW }

/** Builds a well-formed approval for every live-gated check in the current coverage map. */
function approveEveryLiveCheck(overrides: Partial<ApprovalRecord> = {}): { schemaVersion: number; approvals: ApprovalRecord[] } {
  const approvals: ApprovalRecord[] = []
  for (const task of tasks) {
    for (const [checkId, entry] of Object.entries(coverage.tasks[task.id])) {
      if (!entry.live) continue
      approvals.push({
        taskId: task.id,
        checkId,
        approvedBy: approver,
        approvedAt: '2026-10-23T02:00:00Z',
        approvalRef: `ANI-1655#comment-${task.id}-${checkId}`,
        reason: '외부 계정·실브라우저가 필요한 항목으로 파일럿 검증으로 이관합니다.',
        pilotPlanRef: 'docs/qa/v093/pilot-design.md',
        expiresAt: '2026-11-23T02:00:00Z',
        ...overrides,
      })
    }
  }
  return { schemaVersion: 1, approvals }
}

describe('ANI-1655 approved NOT_VERIFIED', () => {
  it('(a) without an approval file every live-gated check stays NOT_VERIFIED and the verdict is NO_GO', () => {
    const report = buildGoldenReport(manifest as never, coverage, allPass(), undefined, approvalCtx)
    expect(report.approvalsApplied).toBe(0)
    expect(report.checkCounts.NOT_VERIFIED_APPROVED).toBe(0)
    expect(report.checkCounts.NOT_VERIFIED).toBeGreaterThan(0)
    expect(report.releaseVerdict).toBe('NO_GO')
    expect(report.exitCode).toBe(2)
  })

  it('(b) with a valid approval file covering every live gap the verdict is GO', () => {
    const report = buildGoldenReport(manifest as never, coverage, allPass(), approveEveryLiveCheck(), approvalCtx)
    expect(report.approvalErrors).toEqual([])
    expect(report.approvalsApplied).toBe(report.checkCounts.NOT_VERIFIED_APPROVED)
    expect(report.checkCounts.NOT_VERIFIED).toBe(0)
    expect(report.checkCounts.FAIL).toBe(0)
    expect(report.releaseVerdict).toBe('GO')
  })

  it('(b2) an approval never turns a check into CONTRACT_PASS: it stays a distinct accepted gap', () => {
    const report = buildGoldenReport(manifest as never, coverage, allPass(), approveEveryLiveCheck(), approvalCtx)
    const g07 = report.tasks.find((t) => t.taskId === 'G093-07')!
    const race = g07.checks.find((c) => c.checkId === 'db-race-one-winner')!
    expect(race.status).toBe('NOT_VERIFIED_APPROVED')
    expect(race.reasons).toContain('LIVE_REQUIRED:ISOLATED_DB')
    expect(g07.status).toBe('NOT_VERIFIED_APPROVED')
  })

  it('(c) one FAIL forces NO_GO regardless of how many approvals exist', () => {
    const outcomes = allPass()
    outcomes['src/features/booking-recovery/__tests__/approval-binding.test.ts'] = 'FAIL'
    const report = buildGoldenReport(manifest as never, coverage, outcomes, approveEveryLiveCheck(), approvalCtx)
    expect(report.checkCounts.FAIL).toBeGreaterThan(0)
    expect(report.releaseVerdict).toBe('NO_GO')
    expect(report.exitCode).toBe(1)
  })

  it('(c2) an approval cannot rescue a failing check even when it targets that exact check', () => {
    const outcomes = allPass()
    outcomes['src/features/booking-recovery/__tests__/approval-binding.test.ts'] = 'FAIL'
    const file = approveEveryLiveCheck()
    file.approvals.push({
      taskId: 'G093-06', checkId: 'source-sequence-rechecked', approvedBy: approver,
      approvedAt: '2026-10-23T02:00:00Z', approvalRef: 'ANI-1655#comment-x',
      reason: '이 실패는 승인으로 덮으려는 시도입니다.', pilotPlanRef: 'docs/qa/v093/pilot-design.md',
      expiresAt: '2026-11-23T02:00:00Z',
    })
    const report = buildGoldenReport(manifest as never, coverage, outcomes, file, approvalCtx)
    // A check with no live requirement is not approvable at all, so this record is rejected outright.
    expect(report.approvalErrors.some((e) => e.endsWith(':CHECK_HAS_NO_LIVE_REQUIREMENT'))).toBe(true)
    expect(report.releaseVerdict).toBe('NO_GO')
  })

  it('(d) a malformed approval file is rejected wholesale and cannot produce GO', () => {
    const bad = [
      { schemaVersion: 1, approvals: [{}] },
      { schemaVersion: 1, approvals: [{ ...approveEveryLiveCheck().approvals[0], taskId: 'G093-99' }] },
      { schemaVersion: 1, approvals: [{ ...approveEveryLiveCheck().approvals[0], approvedBy: 'attacker' }] },
      { schemaVersion: 1, approvals: [{ ...approveEveryLiveCheck().approvals[0], approvalRef: 'none' }] },
      { schemaVersion: 1, approvals: [{ ...approveEveryLiveCheck().approvals[0], expiresAt: '2026-10-01T00:00:00Z' }] },
      { schemaVersion: 1, approvals: [{ ...approveEveryLiveCheck().approvals[0], pilotPlanRef: '../../etc/passwd' }] },
      { schemaVersion: 1, approvals: [{ ...approveEveryLiveCheck().approvals[0], pilotPlanRef: 'docs/does-not-exist.md' }] },
      { schemaVersion: 2, approvals: [] },
      'not-an-object',
    ]
    for (const file of bad) {
      const report = buildGoldenReport(manifest as never, coverage, allPass(), file, approvalCtx)
      expect(report.approvalErrors.length, JSON.stringify(file)).toBeGreaterThan(0)
      expect(report.approvalsApplied).toBe(0)
      expect(report.releaseVerdict).toBe('NO_GO')
    }
  })

  it('(d3) a missing pilot plan is rejected: an approval must point at a plan that actually exists', () => {
    const file = approveEveryLiveCheck()
    file.approvals[0] = { ...file.approvals[0], pilotPlanRef: 'docs/does-not-exist.md' }
    const report = buildGoldenReport(manifest as never, coverage, allPass(), file, approvalCtx)
    expect(report.approvalErrors).toEqual(['APPROVAL[0]:PILOT_PLAN_NOT_FOUND'])
    expect(report.releaseVerdict).toBe('NO_GO')
  })

  it('(d2) a partially valid file is not partially trusted: one bad record voids the whole file', () => {
    const file = approveEveryLiveCheck()
    file.approvals.push({ ...file.approvals[0], approvalRef: 'bogus' })
    const report = buildGoldenReport(manifest as never, coverage, allPass(), file, approvalCtx)
    expect(report.approvalErrors.length).toBeGreaterThan(0)
    expect(report.approvalsApplied).toBe(0)
    expect(report.checkCounts.NOT_VERIFIED_APPROVED).toBe(0)
    expect(report.releaseVerdict).toBe('NO_GO')
  })

  it('(e) the runner loads approvals only from the fixed in-repo path, never from argv or env', () => {
    const source = readFileSync(resolve(__dirname, 'run.mjs'), 'utf8')
    expect(source).toContain("new URL('./approvals.json', import.meta.url)")
    // No argv/env-driven approval path, no evidence path override of any kind.
    expect(source).not.toMatch(/process\.env\.[A-Z_]*APPROVAL/)
    expect(source).not.toMatch(/process\.argv\.includes\(['"]--approvals?/)
    expect(source).not.toMatch(/argv\[[^\]]*\].*approval/i)
    // The approver allowlist lives in code, not in the file it validates.
    const approvalSource = readFileSync(resolve(__dirname, 'approvals.ts'), 'utf8')
    expect(approvalSource).toContain('export const ALLOWED_APPROVERS')
  })

  it('(f) the committed approval file is empty, so today the gate still reports NO_GO', () => {
    const committed = JSON.parse(readFileSync(resolve(__dirname, 'approvals.json'), 'utf8'))
    expect(committed.schemaVersion).toBe(1)
    expect(committed.approvals).toEqual([])
    const report = buildGoldenReport(manifest as never, coverage, allPass(), committed, approvalCtx)
    expect(report.releaseVerdict).toBe('NO_GO')
  })
})
