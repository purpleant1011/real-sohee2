import type { GoldenTask } from './engine.ts'
import { approvalKey, indexApprovals, validateApprovals, type ApprovalRecord } from './approvals.ts'

export type LiveRequirement = 'ISOLATED_DB' | 'BROWSER' | 'PROVIDER_ALLOWLIST' | 'PROVIDER_CONTRACT' | 'PG_SANDBOX'
export interface CheckCoverage { contractTests: string[]; live?: { requires: LiveRequirement; reason: string } }
export interface CoverageFile { version: string; tasks: Record<string, Record<string, CheckCoverage>> }
/** File-level outcome of the deterministic runner. undefined = the file was not run. */
export type FileOutcome = 'PASS' | 'FAIL' | 'MISSING'
/**
 * NOT_VERIFIED_APPROVED is NOT a pass. It marks a live-gated check whose gap a named human accepted
 * for a bounded window. It is only ever produced from a validated approval record, never from test
 * outcomes, and it never overrides FAIL.
 */
export type CheckStatus = 'CONTRACT_PASS' | 'FAIL' | 'NOT_VERIFIED' | 'NOT_VERIFIED_APPROVED'
export interface CheckAssessment { checkId: string; status: CheckStatus; reasons: string[] }
export interface TaskAssessment {
  taskId: string
  status: CheckStatus
  checks: CheckAssessment[]
  evalIds: string[]
}

/**
 * Per-check verdict. A failing/missing linked test is FAIL and dominates. A check that needs live evidence
 * (DB/browser/provider/contract) is NOT_VERIFIED even when its contract tests pass: green offline tests never
 * stand in for live proof. A check with no contract test and no live requirement is itself NOT_VERIFIED.
 *
 * An approval record can only promote the LIVE_REQUIRED branch to NOT_VERIFIED_APPROVED. Checks that failed,
 * that were not run, or that have no coverage entry stay exactly as they are, so no approval can launder a
 * missing or failing test into something that counts toward release.
 */
export function assessCheck(
  checkId: string,
  coverage: CheckCoverage | undefined,
  outcomes: Record<string, FileOutcome | undefined>,
  approval?: ApprovalRecord,
): CheckAssessment {
  if (!coverage) return { checkId, status: 'NOT_VERIFIED', reasons: ['NO_COVERAGE_ENTRY'] }
  const failed = coverage.contractTests.filter((file) => outcomes[file] === 'FAIL' || outcomes[file] === 'MISSING')
  if (failed.length) return { checkId, status: 'FAIL', reasons: failed.map((file) => `${outcomes[file] === 'MISSING' ? 'TEST_FILE_MISSING' : 'CONTRACT_TEST_FAILED'}:${file}`) }
  const notRun = coverage.contractTests.filter((file) => outcomes[file] === undefined)
  if (notRun.length) return { checkId, status: 'NOT_VERIFIED', reasons: ['CONTRACT_TESTS_NOT_RUN'] }
  if (coverage.live) {
    if (approval) {
      return { checkId, status: 'NOT_VERIFIED_APPROVED', reasons: [`LIVE_REQUIRED:${coverage.live.requires}`, `APPROVED:${approval.approvalRef}`] }
    }
    return { checkId, status: 'NOT_VERIFIED', reasons: [`LIVE_REQUIRED:${coverage.live.requires}`] }
  }
  if (!coverage.contractTests.length) return { checkId, status: 'NOT_VERIFIED', reasons: ['NO_EVIDENCE_SOURCE'] }
  return { checkId, status: 'CONTRACT_PASS', reasons: ['OFFLINE_CONTRACT_ONLY'] }
}

export function assessTaskCoverage(
  task: GoldenTask,
  coverage: CoverageFile,
  outcomes: Record<string, FileOutcome | undefined>,
  rubric: string,
  approvals: Map<string, ApprovalRecord> = new Map(),
): TaskAssessment {
  const checks = task.checks.map((checkId) => assessCheck(checkId, coverage.tasks[task.id]?.[checkId], outcomes, approvals.get(approvalKey(task.id, checkId))))
  const status: CheckStatus = checks.some((c) => c.status === 'FAIL') ? 'FAIL'
    : checks.every((c) => c.status === 'CONTRACT_PASS') ? 'CONTRACT_PASS'
      : checks.every((c) => c.status === 'CONTRACT_PASS' || c.status === 'NOT_VERIFIED_APPROVED') ? 'NOT_VERIFIED_APPROVED'
        : 'NOT_VERIFIED'
  return { taskId: task.id, status, checks, evalIds: ['success', 'failure', 'trajectory'].map((kind) => `${task.id}:${kind}:${rubric}`) }
}

export function uniqueContractTests(coverage: CoverageFile): string[] {
  return [...new Set(Object.values(coverage.tasks).flatMap((checks) => Object.values(checks).flatMap((c) => c.contractTests)))].sort()
}

export type ReleaseVerdict = 'GO' | 'NO_GO'

export interface GoldenReport {
  rubric: string
  tasks: TaskAssessment[]
  counts: Record<CheckStatus, number>
  releaseVerdict: ReleaseVerdict
  /** 1 = a known failure was observed, 2 = nothing failed but release is still not verified. Never 0. */
  exitCode: 1 | 2
  /** How many approvals were actually applied. 0 means every live gap is still unattributed. */
  approvalsApplied: number
  /** Schema problems found in the approval file. Any entry here forces NO_GO. */
  approvalErrors: string[]
  /** Check-level tally the verdict was computed from, so the reason for a GO is auditable. */
  checkCounts: Record<CheckStatus, number>
}

/**
 * GO requires every check to be either proven offline (CONTRACT_PASS) or an accepted, unexpired,
 * schema-valid human approval of a stated live gap. FAIL dominates: one failure anywhere is NO_GO
 * regardless of how many approvals exist. A report with zero checks is not GO either.
 *
 * This rule deliberately does NOT consult test outcomes directly. Callers can only reach GO by
 * supplying approval records that survived validateApprovals; there is no path that turns a bare
 * NOT_VERIFIED into something that counts.
 */
export function computeReleaseVerdict(input: {
  checkCounts: Record<CheckStatus, number>
  approvalErrors: readonly string[]
}): ReleaseVerdict {
  const { checkCounts, approvalErrors } = input
  if (approvalErrors.length) return 'NO_GO'
  if (checkCounts.FAIL > 0) return 'NO_GO'
  const total = checkCounts.CONTRACT_PASS + checkCounts.FAIL + checkCounts.NOT_VERIFIED + checkCounts.NOT_VERIFIED_APPROVED
  if (total === 0) return 'NO_GO'
  if (checkCounts.NOT_VERIFIED > 0) return 'NO_GO'
  return 'GO'
}

const emptyCheckCounts = (): Record<CheckStatus, number> =>
  ({ CONTRACT_PASS: 0, FAIL: 0, NOT_VERIFIED: 0, NOT_VERIFIED_APPROVED: 0 })

export function buildGoldenReport(
  manifest: { version: string; tasks: GoldenTask[] },
  coverage: CoverageFile,
  outcomes: Record<string, FileOutcome | undefined>,
  approvalFile?: unknown,
  approvalContext?: { repoRoot: string; allowedApprovers: readonly string[]; now?: Date },
): GoldenReport {
  let approvals = new Map<string, ApprovalRecord>()
  let approvalErrors: string[] = []

  if (approvalFile !== undefined) {
    if (!approvalContext) {
      approvalErrors = ['APPROVAL_CONTEXT_MISSING']
    } else {
      const validation = validateApprovals(approvalFile, {
        taskIds: manifest.tasks.map((task) => task.id),
        checkIdsFor: (taskId) => Object.keys(coverage.tasks[taskId] ?? {}),
        liveCheckIdsFor: (taskId) => Object.entries(coverage.tasks[taskId] ?? {})
          .filter(([, entry]) => Boolean(entry.live))
          .map(([checkId]) => checkId),
        repoRoot: approvalContext.repoRoot,
        allowedApprovers: approvalContext.allowedApprovers,
        now: approvalContext.now,
      })
      approvalErrors = validation.errors
      // A file with any error is not partially trusted: no approval from it is applied.
      approvals = validation.errors.length ? new Map() : indexApprovals(validation.approvals)
    }
  }

  const tasks = manifest.tasks.map((task) => assessTaskCoverage(task, coverage, outcomes, manifest.version, approvals))
  const counts = emptyCheckCounts()
  for (const task of tasks) counts[task.status]++

  const checkCounts = emptyCheckCounts()
  for (const task of tasks) for (const check of task.checks) checkCounts[check.status]++

  const releaseVerdict = computeReleaseVerdict({ checkCounts, approvalErrors })
  return {
    rubric: manifest.version,
    tasks,
    counts,
    releaseVerdict,
    // Exit code stays 1|2 on purpose: a pipeline must never turn green just because approvals exist,
    // and GO is a verdict to be read explicitly rather than inferred from a zero exit status.
    exitCode: counts.FAIL ? 1 : 2,
    approvalsApplied: [...approvals.keys()].length,
    approvalErrors,
    checkCounts,
  }
}
