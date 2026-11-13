import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import type { AutomationRuleKind } from './rule-schema'

type QueryResult = Promise<{ data: unknown; error: unknown }>

export type AutomationGateway = {
  listRules(workspaceId: string): QueryResult
  listRuns(workspaceId: string): QueryResult
}

export type AutomationRunSummary = Readonly<{
  id: string
  status: 'awaiting_approval' | 'succeeded' | 'failed'
  mode: 'mock'
  summary: string
  errorCode: string | null
  createdAt: string
  finishedAt: string
}>

export type AutomationRuleSummary = Readonly<{
  id: string
  kind: AutomationRuleKind
  active: boolean
  approvalRequired: boolean
  updatedAt: string
  lastRun: AutomationRunSummary | null
}>

export type AutomationDashboardData = Readonly<{
  rules: readonly AutomationRuleSummary[]
}>

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const kindSchema = z.enum(['faq_safe_reply', 'schedule_reminder', 'content_draft'])
const ruleRowSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  kind: kindSchema,
  active: z.boolean(),
  approval_required: z.boolean(),
  updated_at: timestampSchema,
}).strict()
const runRowSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  rule_id: uuidSchema,
  status: z.enum(['awaiting_approval', 'succeeded', 'failed']),
  output_summary: z.object({
    mode: z.literal('mock'),
    summary: z.string().min(1).max(200),
  }).passthrough(),
  error_code: z.string().max(120).nullable(),
  created_at: timestampSchema,
  finished_at: timestampSchema,
}).strict()

function failure<T>(): ActionResult<T> {
  return {
    error: {
      message: '자동화 규칙과 실행 이력을 불러오지 못했습니다.',
      requestId: 'automation-dashboard',
    },
  }
}

async function createGateway(): Promise<AutomationGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    async listRules(workspaceId) {
      return supabase.from('automation_rules')
        .select('id, workspace_id, kind, active, approval_required, updated_at')
        .eq('workspace_id', workspaceId)
        .in('kind', ['faq_safe_reply', 'schedule_reminder', 'content_draft'])
        .order('updated_at', { ascending: false })
        .limit(100)
    },
    async listRuns(workspaceId) {
      return supabase.from('automation_runs')
        .select('id, workspace_id, rule_id, status, output_summary, error_code, created_at, finished_at')
        .eq('workspace_id', workspaceId)
        .not('finished_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300)
    },
  }
}

export async function getAutomationDashboard(
  workspaceId: string,
  providedGateway?: AutomationGateway,
): Promise<ActionResult<AutomationDashboardData>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return failure()

  try {
    const gateway = providedGateway ?? (await createGateway())
    const [ruleResult, runResult] = await Promise.all([
      gateway.listRules(parsedWorkspaceId.data),
      gateway.listRuns(parsedWorkspaceId.data),
    ])
    const rules = z.array(ruleRowSchema).safeParse(ruleResult.data)
    const runs = z.array(runRowSchema).safeParse(runResult.data)
    if (ruleResult.error || runResult.error || !rules.success || !runs.success) return failure()
    if (
      rules.data.some((row) => row.workspace_id !== parsedWorkspaceId.data) ||
      runs.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)
    ) return failure()

    const ruleIds = new Set(rules.data.map((rule) => rule.id))
    if (runs.data.some((run) => !ruleIds.has(run.rule_id))) return failure()

    const latestRuns = new Map<string, z.infer<typeof runRowSchema>>()
    for (const run of runs.data) {
      if (!latestRuns.has(run.rule_id)) latestRuns.set(run.rule_id, run)
    }

    return {
      data: Object.freeze({
        rules: Object.freeze(rules.data.map((rule) => {
          const run = latestRuns.get(rule.id)
          return Object.freeze({
            id: rule.id,
            kind: rule.kind,
            active: rule.active,
            approvalRequired: rule.approval_required,
            updatedAt: rule.updated_at,
            lastRun: run ? Object.freeze({
              id: run.id,
              status: run.status,
              mode: run.output_summary.mode,
              summary: run.output_summary.summary,
              errorCode: run.error_code,
              createdAt: run.created_at,
              finishedAt: run.finished_at,
            }) : null,
          })
        })),
      }),
    }
  } catch {
    return failure()
  }
}
