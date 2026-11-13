import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ChannelPerformanceObservation, PerformanceMetricState } from '@/features/performance/types'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { ClaimedDueAutomation, DueAutomationDependencies } from './due-runner'
import { reportOnlyRuntimeFromEnv, type ReportOnlyRuntime } from './report-only-due-runtime'
import { v08AutomationRuleSchema, type AutomationBudgetPort, type V08AutomationRuleInput } from './v08-rule-schema'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const safeMetric = z.object({
  channel: z.enum(['instagram', 'threads']),
  metric: z.enum(['views', 'likes', 'comments', 'saves', 'shares', 'replies', 'reposts', 'quotes', 'visits', 'inquiries']),
  state: z.enum(['available', 'collecting', 'not_supported', 'permission_denied', 'failed', 'not_connected']),
  value: z.number().int().nonnegative().nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === 'available') !== (value.value !== null)) context.addIssue({ code: 'custom', message: 'METRIC_STATE_VALUE_MISMATCH' })
})

export type ProductionAutomationAdminPort = Readonly<{
  claimDue(now: Date, workerId: string): Promise<readonly ClaimedDueAutomation[]>
  recheckRule(run: ClaimedDueAutomation): Promise<Readonly<{ active: boolean; rule: V08AutomationRuleInput | null }>>
  readStoredMetrics(run: ClaimedDueAutomation): Promise<readonly ChannelPerformanceObservation[]>
  persistReport(run: ClaimedDueAutomation, report: StructuredReport): Promise<string>
  complete(run: ClaimedDueAutomation, input: Readonly<{ status: 'succeeded' | 'failed' | 'skipped_credit_cap' | 'skipped_inactive'; safeErrorCode: string | null; reportSnapshotId: string | null }>): Promise<void>
  notificationRecipients(workspaceId: string): Promise<readonly string[]>
  upsertNotification(input: Readonly<{ workspaceId: string; userId: string; eventKey: string; safeCode: string }>): Promise<void>
  scheduleNext(run: ClaimedDueAutomation, update: Readonly<{ kind: 'next_scheduled' | 'retry'; at: string }>): Promise<void>
}>

type StructuredReport = Readonly<{ observations: readonly string[]; interpretations: readonly string[]; unknowns: readonly string[]; proposal: string; requiredDecision: string }>
type CompletionInput = Parameters<DueAutomationDependencies['repository']['complete']>[1]
type ScheduleUpdate = Parameters<DueAutomationDependencies['repository']['scheduleNext']>[1]
type NotificationInput = Parameters<DueAutomationDependencies['repository']['notifyOnce']>[1]
type ReportInput = Parameters<DueAutomationDependencies['reports']['generate']>[0]

export type ProductionDuePorts = Readonly<{ admin: ProductionAutomationAdminPort; credits: AutomationBudgetPort }>

type DeterministicPerformance = Readonly<{
  channels: Record<string, Readonly<{
    metrics: Record<string, Readonly<{ state: PerformanceMetricState; value: number | null }>>
  }>>
}>

export function createDeterministicStructuredReport(input: Readonly<{ performance: DeterministicPerformance }>): StructuredReport {
  const observations: string[] = []
  const unknowns: string[] = []
  for (const channel of ['instagram', 'threads']) {
    const metrics = input.performance.channels[channel]?.metrics ?? {}
    for (const [metric, item] of Object.entries(metrics)) {
      if (item.state === 'available' && item.value !== null) observations.push(`${channel} ${metric}: ${item.value}`)
      else unknowns.push(`${channel} ${metric}: ${item.state}`)
    }
  }
  return Object.freeze({
    observations: Object.freeze(observations),
    interpretations: Object.freeze([]),
    unknowns: Object.freeze(unknowns),
    proposal: observations.length > 0 ? '관찰된 성과를 다음 계획에서 검토해 주세요.' : '저장된 성과가 없어 연결 상태를 검토해 주세요.',
    requiredDecision: '다음 방향 제안을 검토하고 승인해 주세요.',
  })
}

export function createProductionReportOnlyDueDependencies(ports: ProductionDuePorts): DueAutomationDependencies {
  return Object.freeze({
    repository: Object.freeze({
      claimDue: (now: Date, workerId: string) => ports.admin.claimDue(now, workerId),
      async recheck(run: ClaimedDueAutomation) {
        const current = await ports.admin.recheckRule(run)
        return Object.freeze({ active: current.active, scheduleValid: current.rule !== null, rule: current.rule ?? undefined })
      },
      persistReport: (run: ClaimedDueAutomation, report: StructuredReport) => ports.admin.persistReport(run, report),
      complete: (run: ClaimedDueAutomation, input: CompletionInput) => ports.admin.complete(run, input),
      scheduleNext: (run: ClaimedDueAutomation, update: ScheduleUpdate) => ports.admin.scheduleNext(run, update),
      async notifyOnce(run: ClaimedDueAutomation, input: NotificationInput) {
        const recipients = await ports.admin.notificationRecipients(run.workspaceId)
        await Promise.all(recipients.map((userId) => ports.admin.upsertNotification({
          workspaceId: run.workspaceId,
          userId,
          eventKey: `automation:${run.runId}:${input.status}`,
          safeCode: input.safeErrorCode ?? 'AUTOMATION_REPORT_READY',
        })))
      },
    }),
    credits: ports.credits,
    performance: Object.freeze({ collect: (run: ClaimedDueAutomation) => ports.admin.readStoredMetrics(run) }),
    reports: Object.freeze({ generate: async (input: ReportInput) => createDeterministicStructuredReport({ performance: input.performance }) }),
  })
}

type RuntimeInput = Readonly<{
  enabled: boolean
  serviceRoleKey: string | undefined
  createPorts?: () => ProductionDuePorts
}>

export function createProductionReportOnlyRuntime(input: RuntimeInput = {
  enabled: process.env.SOHEE_REPORT_ONLY_DUE_ENABLED === '1',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  createPorts: createDefaultProductionDuePorts,
}): ReportOnlyRuntime {
  if (!input.enabled || !input.serviceRoleKey || !input.createPorts) return Object.freeze({ enabled: false, dependencies: undefined })
  try { return reportOnlyRuntimeFromEnv(createProductionReportOnlyDueDependencies(input.createPorts())) } catch { return Object.freeze({ enabled: false, dependencies: undefined }) }
}

type RpcResponse = Promise<Readonly<{ data: unknown; error: unknown }>>
type AdminRpc = Readonly<{ rpc(name: string, args: Record<string, unknown>): RpcResponse }>
type QueryResponse = PromiseLike<Readonly<{ data: unknown; error: unknown }>>
type QueryBuilder = PromiseLike<Readonly<{ data: unknown; error: unknown }>> & Readonly<{
  select(columns: string): QueryBuilder
  insert(row: Record<string, unknown>): QueryBuilder
  update(row: Record<string, unknown>): QueryBuilder
  upsert(row: Record<string, unknown>, options: Record<string, unknown>): QueryBuilder
  eq(column: string, value: unknown): QueryBuilder
  gte(column: string, value: string): QueryBuilder
  lte(column: string, value: string): QueryBuilder
  order(column: string, options: Readonly<{ ascending: boolean }>): QueryBuilder
  limit(count: number): QueryBuilder
  maybeSingle(): QueryResponse
}>
type AdminDataGateway = AdminRpc & Readonly<{ from(table: string): QueryBuilder }>

function requireData<T>(result: Readonly<{ data: unknown; error: unknown }>, schema: z.ZodType<T>, code: string): T {
  const parsed = schema.safeParse(result.data)
  if (result.error || !parsed.success) throw new Error(code)
  return parsed.data
}

export function createAdminCreditGateway(gateway: AdminRpc): AutomationBudgetPort {
  const reservations = new Map<string, Readonly<{ workspaceId: string; idempotencyKey: string }>>()
  return Object.freeze({
    async previewAutomationBudget(input: Parameters<AutomationBudgetPort['previewAutomationBudget']>[0]) {
      const result = await gateway.rpc('preview_v08_automation_budget', {
        p_workspace_id: input.workspaceId, p_rule_id: input.ruleId, p_scheduled_for: input.scheduledFor,
      })
      const preview = z.object({
        allowed: z.boolean(),
        reason: z.enum(['per_run_cap', 'daily_cap', 'weekly_cap', 'balance']).nullable(),
      }).strict().safeParse(result.data)
      if (result.error || !preview.success || (preview.data.allowed && preview.data.reason !== null) || (!preview.data.allowed && preview.data.reason === null)) {
        return Object.freeze({ allowed: false, reason: 'balance' as const })
      }
      return Object.freeze(preview.data)
    },
    async reserveAutomationCredit(input: Parameters<AutomationBudgetPort['reserveAutomationCredit']>[0]) {
      const idempotencyKey = randomUUID()
      const requestedId = randomUUID()
      const reservation = requireData(await gateway.rpc('reserve_workspace_credits', {
        p_workspace_id: input.workspaceId, p_action: 'performance_report', p_credits: 1,
        p_idempotency_key: idempotencyKey, p_reservation_id: requestedId,
      }), z.object({ reservationId: uuid }).passthrough(), 'CREDIT_RESERVE_FAILED')
      reservations.set(reservation.reservationId, Object.freeze({ workspaceId: input.workspaceId, idempotencyKey }))
      return Object.freeze({ reservationId: reservation.reservationId })
    },
    async settleAutomationCredit(input: Parameters<AutomationBudgetPort['settleAutomationCredit']>[0]) {
      const reservation = reservations.get(input.reservationId)
      if (!reservation) throw new Error('CREDIT_RESERVATION_MISSING')
      requireData(await gateway.rpc('settle_credit_reservation', {
        p_workspace_id: reservation.workspaceId, p_reservation_id: input.reservationId, p_actual_credits: 1, p_idempotency_key: reservation.idempotencyKey,
      }), z.object({ reservationId: uuid, state: z.literal('settled') }).passthrough(), 'CREDIT_SETTLE_FAILED')
    },
    async releaseAutomationCredit(input: Parameters<AutomationBudgetPort['releaseAutomationCredit']>[0]) {
      const reservation = reservations.get(input.reservationId)
      if (!reservation) throw new Error('CREDIT_RESERVATION_MISSING')
      requireData(await gateway.rpc('release_credit_reservation', {
        p_workspace_id: reservation.workspaceId, p_reservation_id: input.reservationId, p_release_credits: 1, p_idempotency_key: reservation.idempotencyKey,
      }), z.object({ reservationId: uuid }).passthrough(), 'CREDIT_RELEASE_FAILED')
    },
  })
}

function createDefaultProductionDuePorts(): ProductionDuePorts {
  const admin = createAdminSupabaseClient() as unknown as AdminDataGateway
  return Object.freeze({
    admin: createAdminAutomationGateway(admin),
    credits: createAdminCreditGateway(admin),
  })
}

const storedMetricRow = z.object({
  channel: z.enum(['instagram', 'threads']),
  metrics: z.array(z.object({
    metric: z.enum(['views', 'likes', 'comments', 'saved', 'saves', 'shares', 'replies', 'reposts', 'quotes', 'visits', 'inquiries']),
    state: z.enum(['available', 'no_data', 'not_supported', 'permission_denied', 'failed']),
    value: z.number().int().nonnegative().nullable(),
  }).strict()).nullable(),
}).passthrough()

const ruleRow = z.object({
  workspace_id: uuid, id: uuid, active: z.boolean(),
  kind: z.enum(['daily_performance_report', 'twice_daily_performance_report', 'weekly_plan_proposal']),
  configuration: z.unknown(), timezone: z.string().min(1).max(64),
}).passthrough()

function metricState(value: 'available' | 'no_data' | 'not_supported' | 'permission_denied' | 'failed'): PerformanceMetricState {
  return value === 'no_data' ? 'collecting' : value
}

export function createAdminAutomationGateway(gateway: AdminDataGateway): ProductionAutomationAdminPort {
  return Object.freeze({
    async claimDue(now, workerId) {
      const claimed: ClaimedDueAutomation[] = []
      const seenRunIds = new Set<string>()
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const response = await gateway.rpc('claim_due_v08_automation', { p_now: now.toISOString(), p_worker_id: workerId })
        const rows = z.array(z.object({ run_id: uuid, workspace_id: uuid, rule_id: uuid, scheduled_for: timestamp }).strict()).safeParse(response.data)
        if (response.error || !rows.success || rows.data.length === 0) break
        if (rows.data.length !== 1) break
        const row = rows.data[0]!
        if (seenRunIds.has(row.run_id)) break
        seenRunIds.add(row.run_id)
        claimed.push(Object.freeze({ runId: row.run_id, workspaceId: row.workspace_id, ruleId: row.rule_id, scheduledFor: row.scheduled_for }))
      }
      return Object.freeze(claimed)
    },
    async recheckRule(run) {
      const response = await gateway.from('automation_rules').select('workspace_id,id,active,kind,configuration,timezone').eq('workspace_id', run.workspaceId).eq('id', run.ruleId).maybeSingle()
      const row = ruleRow.safeParse(response.data)
      if (response.error || !row.success || row.data.workspace_id !== run.workspaceId || row.data.id !== run.ruleId || !row.data.active) return Object.freeze({ active: false, rule: null })
      const rule = v08AutomationRuleSchema.safeParse({
        ...(typeof row.data.configuration === 'object' && row.data.configuration !== null ? row.data.configuration : {}),
        kind: row.data.kind, active: row.data.active, approvalRequired: true, timezone: row.data.timezone,
      })
      return Object.freeze({ active: true, rule: rule.success ? rule.data : null })
    },
    async readStoredMetrics(run) {
      const response = await gateway.rpc('list_social_post_reports', {
        p_workspace_id: run.workspaceId,
        p_period_start: new Date(new Date(run.scheduledFor).getTime() - 24 * 60 * 60_000).toISOString(),
        p_period_end: run.scheduledFor,
        p_content_id: null,
      })
      const rows = z.array(storedMetricRow).safeParse(response.data)
      if (response.error || !rows.success) return Object.freeze([])
      const byMetric = new Map<string, ChannelPerformanceObservation>()
      for (const row of rows.data) for (const metric of row.metrics ?? []) {
        const normalizedMetric = metric.metric === 'saved' ? 'saves' : metric.metric
        const parsed = safeMetric.safeParse({ channel: row.channel, metric: normalizedMetric, state: metricState(metric.state), value: metric.state === 'available' ? metric.value : null })
        if (parsed.success) byMetric.set(`${parsed.data.channel}:${parsed.data.metric}`, Object.freeze(parsed.data))
      }
      return Object.freeze([...byMetric.values()])
    },
    async persistReport(run, report) {
      const sourceReady = report.observations.length > 0
      const response = await gateway.from('report_snapshots').upsert({
        workspace_id: run.workspaceId,
        period_start: run.scheduledFor.slice(0, 10), period_end: run.scheduledFor.slice(0, 10),
        status: sourceReady ? 'sufficient' : report.unknowns.length > 0 ? 'insufficient' : 'unavailable',
        source_ready: sourceReady, checked_at: new Date().toISOString(),
        metrics: { format: 'v08_report_only', run_id: run.runId, observations: report.observations, unknowns: report.unknowns, proposal: report.proposal, required_decision: report.requiredDecision },
      }, { onConflict: 'workspace_id,period_start,period_end' }).select('id').maybeSingle()
      return requireData(response, z.object({ id: uuid }).strict(), 'REPORT_PERSIST_FAILED').id
    },
    async complete(run, input) {
      const status = input.status === 'skipped_credit_cap' || input.status === 'skipped_inactive' ? 'failed' : input.status
      const result = await gateway.rpc('complete_v08_automation_run', { p_run_id: run.runId, p_status: status, p_report_snapshot_id: input.reportSnapshotId, p_safe_error_code: input.safeErrorCode })
      if (result.error || result.data !== true) throw new Error('AUTOMATION_COMPLETE_FAILED')
    },
    async notificationRecipients(workspaceId) {
      const response = await gateway.from('workspace_members').select('user_id,role,status').eq('workspace_id', workspaceId)
      const rows = z.array(z.object({ user_id: uuid, role: z.enum(['owner', 'manager', 'reviewer', 'viewer']), status: z.literal('active') }).strict()).safeParse(response.data)
      if (response.error || !rows.success) return Object.freeze([])
      return Object.freeze([...new Set(rows.data.filter((row) => row.role === 'owner' || row.role === 'manager').map((row) => row.user_id))])
    },
    async upsertNotification(input) {
      const response = await gateway.from('notifications').upsert({
        workspace_id: input.workspaceId, user_id: input.userId, event_key: input.eventKey,
        kind: 'system', body: input.safeCode, href: '/app',
      }, { onConflict: 'workspace_id,user_id,event_key' }).maybeSingle()
      if (response.error) throw new Error('NOTIFICATION_PERSIST_FAILED')
    },
    async scheduleNext(run, update) {
      const response = await gateway.from('automation_rules').update({ next_run_at: update.at }).eq('workspace_id', run.workspaceId).eq('id', run.ruleId).eq('active', true).maybeSingle()
      if (response.error) throw new Error(update.kind === 'retry' ? 'AUTOMATION_RETRY_SCHEDULE_FAILED' : 'AUTOMATION_NEXT_SCHEDULE_FAILED')
    },
  })
}
