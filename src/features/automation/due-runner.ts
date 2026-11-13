import { aggregatePerformance } from '@/features/performance/aggregate-performance'
import type { ChannelPerformanceObservation } from '@/features/performance/types'
import { nextScheduledRun, type AutomationBudgetPort, type V08AutomationRuleInput } from './v08-rule-schema'

export type ClaimedDueAutomation = Readonly<{ runId: string; workspaceId: string; ruleId: string; scheduledFor: string }>
type StructuredReport = Readonly<{ observations: readonly string[]; interpretations: readonly string[]; unknowns: readonly string[]; proposal: string; requiredDecision: string }>
export type AutomationScheduleUpdate = Readonly<{ kind: 'next_scheduled' | 'retry'; at: string }>

export type DueAutomationDependencies = Readonly<{
  repository: Readonly<{
    claimDue(now: Date, workerId: string): Promise<readonly ClaimedDueAutomation[]>
    recheck(run: ClaimedDueAutomation): Promise<Readonly<{ active: boolean; scheduleValid: boolean; rule?: V08AutomationRuleInput }>>
    persistReport(run: ClaimedDueAutomation, report: StructuredReport): Promise<string>
    complete(run: ClaimedDueAutomation, input: Readonly<{ status: 'succeeded' | 'failed' | 'skipped_credit_cap' | 'skipped_inactive'; safeErrorCode: string | null; reportSnapshotId: string | null }>): Promise<void>
    scheduleNext(run: ClaimedDueAutomation, update: AutomationScheduleUpdate): Promise<void>
    notifyOnce(run: ClaimedDueAutomation, input: Readonly<{ status: string; safeErrorCode: string | null }>): Promise<void>
  }>
  credits: AutomationBudgetPort
  performance: Readonly<{ collect(run: ClaimedDueAutomation): Promise<readonly ChannelPerformanceObservation[]> }>
  reports: Readonly<{ generate(input: Readonly<{ run: ClaimedDueAutomation; performance: Awaited<ReturnType<typeof aggregatePerformance>> }>): Promise<StructuredReport> }>
  guard?: Readonly<{ checkSoheeReady?(workspaceId: string): Promise<boolean> }>
}>

export type DueAutomationResult = Readonly<{ runs: readonly Readonly<{ runId: string; status: 'succeeded' | 'failed' | 'skipped_credit_cap' | 'skipped_inactive'; safeErrorCode: string | null }>[]}>

function retryAt(now: Date): string { return new Date(now.getTime() + 15 * 60_000).toISOString() }

type FailureCode = 'collection_failed' | 'report_failed' | 'report_persist_failed' | 'credit_settle_failed' | 'next_schedule_failed' | 'run_complete_failed' | 'credit_reserve_failed'

async function bestEffort(operation: () => Promise<void>): Promise<void> {
  try { await operation() } catch { /* A secondary persistence or notification failure must not stop recovery. */ }
}

export async function runDueAutomations(now: Date, workerId: string, dependencies: DueAutomationDependencies): Promise<DueAutomationResult> {
  const claimed = await dependencies.repository.claimDue(now, workerId)
  const results: Array<{ runId: string; status: 'succeeded' | 'failed' | 'skipped_credit_cap' | 'skipped_inactive'; safeErrorCode: string | null }> = []
  for (const run of claimed) {
    const current = await dependencies.repository.recheck(run)
    if (!current.active || !current.scheduleValid) {
      await dependencies.repository.complete(run, { status: 'skipped_inactive', safeErrorCode: 'rule_inactive', reportSnapshotId: null })
      await dependencies.repository.notifyOnce(run, { status: 'skipped_inactive', safeErrorCode: 'rule_inactive' })
      results.push({ runId: run.runId, status: 'skipped_inactive', safeErrorCode: 'rule_inactive' }); continue
    }

    // [P0-3] Production Execution Admission Guard (Fail-Closed when guard is configured)
    if (dependencies.guard?.checkSoheeReady) {
      try {
        const isReady = await dependencies.guard.checkSoheeReady(run.workspaceId)
        if (!isReady) {
          await dependencies.repository.complete(run, { status: 'skipped_inactive', safeErrorCode: 'sohee_not_ready', reportSnapshotId: null })
          await dependencies.repository.notifyOnce(run, { status: 'skipped_inactive', safeErrorCode: 'sohee_not_ready' })
          results.push({ runId: run.runId, status: 'skipped_inactive', safeErrorCode: 'sohee_not_ready' }); continue
        }
      } catch {
        await dependencies.repository.complete(run, { status: 'skipped_inactive', safeErrorCode: 'sohee_not_ready', reportSnapshotId: null })
        await dependencies.repository.notifyOnce(run, { status: 'skipped_inactive', safeErrorCode: 'sohee_not_ready' })
        results.push({ runId: run.runId, status: 'skipped_inactive', safeErrorCode: 'sohee_not_ready' }); continue
      }
    }
    const preview = await dependencies.credits.previewAutomationBudget({ workspaceId: run.workspaceId, ruleId: run.ruleId, scheduledFor: run.scheduledFor })
    if (!preview.allowed) {
      const code = preview.reason ?? 'balance'
      await dependencies.repository.complete(run, { status: 'skipped_credit_cap', safeErrorCode: code, reportSnapshotId: null })
      await dependencies.repository.notifyOnce(run, { status: 'skipped_credit_cap', safeErrorCode: code })
      results.push({ runId: run.runId, status: 'skipped_credit_cap', safeErrorCode: code }); continue
    }
    let reservationId: string | null = null
    let creditSettled = false
    let snapshotId: string | null = null
    const failRun = async (code: FailureCode, releaseReason: 'collection_failed' | 'report_failed' | 'credit_settle_failed' | null) => {
      if (reservationId !== null && !creditSettled && releaseReason !== null) {
        const unreleasedReservationId = reservationId
        await bestEffort(() => dependencies.credits.releaseAutomationCredit({ reservationId: unreleasedReservationId, reason: releaseReason }))
      }
      await bestEffort(() => dependencies.repository.complete(run, { status: 'failed', safeErrorCode: code, reportSnapshotId: snapshotId }))
      await bestEffort(() => dependencies.repository.scheduleNext(run, { kind: 'retry', at: retryAt(now) }))
      await bestEffort(() => dependencies.repository.notifyOnce(run, { status: 'failed', safeErrorCode: code }))
      results.push({ runId: run.runId, status: 'failed', safeErrorCode: code })
    }
    try {
      const reservation = await dependencies.credits.reserveAutomationCredit({ workspaceId: run.workspaceId, ruleId: run.ruleId, scheduledFor: run.scheduledFor })
      reservationId = reservation.reservationId
    } catch {
      await failRun('credit_reserve_failed', null)
      continue
    }
    try {
      const observations = await dependencies.performance.collect(run)
      const performance = await aggregatePerformance(observations)
      let report: StructuredReport
      try { report = await dependencies.reports.generate({ run, performance }) } catch {
        await failRun('report_failed', 'report_failed')
        continue
      }
      try { snapshotId = await dependencies.repository.persistReport(run, report) } catch {
        await failRun('report_persist_failed', 'report_failed')
        continue
      }
      try {
        await dependencies.credits.settleAutomationCredit({ reservationId: reservationId! })
        creditSettled = true
      } catch {
        await failRun('credit_settle_failed', 'credit_settle_failed')
        continue
      }
      const next = current.rule ? nextScheduledRun(current.rule, now).toISOString() : retryAt(now)
      try { await dependencies.repository.scheduleNext(run, { kind: current.rule ? 'next_scheduled' : 'retry', at: next }) } catch {
        await failRun('next_schedule_failed', null)
        continue
      }
      try { await dependencies.repository.complete(run, { status: 'succeeded', safeErrorCode: null, reportSnapshotId: snapshotId }) } catch {
        await failRun('run_complete_failed', null)
        continue
      }
      await bestEffort(() => dependencies.repository.notifyOnce(run, { status: 'succeeded', safeErrorCode: null }))
      results.push({ runId: run.runId, status: 'succeeded', safeErrorCode: null })
    } catch {
      await failRun('collection_failed', 'collection_failed')
    }
  }
  return Object.freeze({ runs: Object.freeze(results) })
}
