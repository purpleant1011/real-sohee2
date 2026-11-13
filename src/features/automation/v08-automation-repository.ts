import 'server-only'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { AutomationActionRepository, V08AutomationActionInput } from './actions/save-v08-automation'
import { nextScheduledRun, v08AutomationKinds, v08AutomationRuleSchema, type V08AutomationRuleInput } from './v08-rule-schema'

type QueryResult = Promise<Readonly<{ data: unknown; error: unknown }>>

export type V08AutomationGateway = Readonly<{
  list(workspaceId: string): QueryResult
  find(workspaceId: string, ruleId: string): QueryResult
  insert(input: Record<string, unknown>): QueryResult
  update(input: Readonly<{ workspaceId: string; ruleId: string; expectedVersion: number; active: boolean; nextRunAt: string | null; configurationVersion: number }>): QueryResult
}>

export type V08AutomationRuleSummary = Readonly<{
  id: string
  configurationVersion: number
  active: boolean
  nextRunAt: string | null
  configuration: V08AutomationRuleInput
}>

const rowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  kind: z.enum(v08AutomationKinds),
  active: z.boolean(),
  approval_required: z.literal(true),
  timezone: z.string().min(1).max(64),
  next_run_at: z.string().datetime({ offset: true }).nullable(),
  configuration_version: z.number().int().positive(),
  configuration: z.object({
    localTimes: z.array(z.string()),
    weekday: z.number().int().min(0).max(6).nullable(),
    quietHours: z.object({ start: z.string(), end: z.string() }).strict(),
    perRunCreditCap: z.number().int().positive(),
    dailyCreditCap: z.number().int().positive(),
    weeklyCreditCap: z.number().int().positive(),
    channels: z.array(z.enum(['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business'])),
  }).strict(),
}).strict()

const insertedRuleSchema = z.object({ id: z.string().uuid() }).strict()
const updatedRuleSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid() }).strict()

function asSummary(value: unknown, workspaceId: string): V08AutomationRuleSummary | null {
  const row = rowSchema.safeParse(value)
  if (!row.success || row.data.workspace_id !== workspaceId) return null
  const configuration = v08AutomationRuleSchema.safeParse({
    kind: row.data.kind,
    active: row.data.active,
    approvalRequired: row.data.approval_required,
    timezone: row.data.timezone,
    localTimes: row.data.configuration.localTimes,
    weekday: row.data.configuration.weekday ?? undefined,
    quietHours: row.data.configuration.quietHours,
    perRunCreditCap: row.data.configuration.perRunCreditCap,
    dailyCreditCap: row.data.configuration.dailyCreditCap,
    weeklyCreditCap: row.data.configuration.weeklyCreditCap,
    channels: row.data.configuration.channels,
  })
  if (!configuration.success) return null
  return Object.freeze({
    id: row.data.id,
    configurationVersion: row.data.configuration_version,
    active: row.data.active,
    nextRunAt: row.data.next_run_at,
    configuration: configuration.data,
  })
}

function storedConfiguration(value: V08AutomationRuleInput) {
  return {
    localTimes: value.localTimes,
    weekday: value.weekday ?? null,
    quietHours: value.quietHours,
    perRunCreditCap: value.perRunCreditCap,
    dailyCreditCap: value.dailyCreditCap,
    weeklyCreditCap: value.weeklyCreditCap,
    channels: value.channels,
  }
}

function failure<T>(): ActionResult<T> {
  return { error: { message: 'V0.8 자동화 규칙을 불러오지 못했습니다.', requestId: 'v08-automation-list' } }
}

export function createV08AutomationRepository(
  gateway: V08AutomationGateway,
  now: () => Date = () => new Date(),
  actorUserId: string | null = null,
): AutomationActionRepository & Readonly<{ list(workspaceId: string): Promise<ActionResult<readonly V08AutomationRuleSummary[]>> }> {
  return {
    async list(workspaceId) {
      const result = await gateway.list(workspaceId)
      const rows = z.array(rowSchema).safeParse(result.data)
      if (result.error || !rows.success) return failure()
      const summaries = rows.data.map((row) => asSummary(row, workspaceId))
      if (summaries.some((summary) => summary === null)) return failure()
      return { data: Object.freeze(summaries as V08AutomationRuleSummary[]) }
    },
    async save(value: V08AutomationActionInput) {
      if (value.mode === 'save') {
        if (!actorUserId) return 'workspace_conflict'
        const result = await gateway.insert({
          workspace_id: value.workspaceId,
          created_by: actorUserId,
          kind: value.configuration.kind,
          active: false,
          approval_required: true,
          timezone: value.configuration.timezone,
          next_run_at: null,
          configuration: storedConfiguration(value.configuration),
        })
        const inserted = insertedRuleSchema.safeParse(result.data)
        return result.error || !inserted.success ? 'workspace_conflict' : 'saved'
      }
      const found = await gateway.find(value.workspaceId, value.ruleId)
      const summary = found.error ? null : asSummary(found.data, value.workspaceId)
      if (!summary) return 'workspace_conflict'
      if (summary.configurationVersion !== value.expectedVersion) return 'version_conflict'
      const active = value.mode === 'resume'
      const nextRunAt = active ? nextScheduledRun({ ...summary.configuration, active: true }, now()).toISOString() : null
      const result = await gateway.update({
        workspaceId: value.workspaceId,
        ruleId: value.ruleId,
        expectedVersion: value.expectedVersion,
        active,
        nextRunAt,
        configurationVersion: value.expectedVersion + 1,
      })
      const updated = updatedRuleSchema.safeParse(result.data)
      if (result.error || !updated.success || updated.data.id !== value.ruleId || updated.data.workspace_id !== value.workspaceId) return 'version_conflict'
      return value.mode === 'resume' ? 'resumed' : 'paused'
    },
  }
}

type RawTable = Readonly<{
  select(fields: string): RawTable
  eq(column: string, value: unknown): RawTable
  in(column: string, values: readonly string[]): RawTable
  order(column: string, options: Readonly<{ ascending: boolean }>): RawTable
  insert(input: Record<string, unknown>): RawTable
  update(input: Record<string, unknown>): RawTable
  maybeSingle(): QueryResult
}> & PromiseLike<Readonly<{ data: unknown; error: unknown }>>

type RawAdmin = Readonly<{ from(table: 'automation_rules'): RawTable }>

function productionGateway(): V08AutomationGateway {
  const admin = createAdminSupabaseClient() as unknown as RawAdmin
  const fields = 'id, workspace_id, kind, active, approval_required, timezone, next_run_at, configuration_version, configuration'
  return {
    list: (workspaceId) => admin.from('automation_rules').select(fields).eq('workspace_id', workspaceId).in('kind', v08AutomationKinds).order('updated_at', { ascending: false }) as unknown as QueryResult,
    find: (workspaceId, ruleId) => admin.from('automation_rules').select(fields).eq('workspace_id', workspaceId).eq('id', ruleId).maybeSingle(),
    insert: (input) => admin.from('automation_rules').insert(input).select('id').maybeSingle(),
    update: (input) => admin.from('automation_rules').update({ active: input.active, next_run_at: input.nextRunAt, configuration_version: input.configurationVersion }).eq('workspace_id', input.workspaceId).eq('id', input.ruleId).eq('configuration_version', input.expectedVersion).select('id, workspace_id').maybeSingle(),
  }
}

export function createProductionV08AutomationRepository(actorUserId: string | null = null) {
  return createV08AutomationRepository(productionGateway(), () => new Date(), actorUserId)
}
