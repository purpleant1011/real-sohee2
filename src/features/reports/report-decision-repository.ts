import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type QueryResult = Promise<Readonly<{ data: unknown; error: unknown }>>

export type ReportDecisionGateway = Readonly<{
  insertDecisionWithEvidence(input: Record<string, unknown>): QueryResult
  listDecisions(workspaceId: string): QueryResult
  insertExperiment(input: Record<string, unknown>): QueryResult
  findDecision?(workspaceId: string, decisionId: string): QueryResult
  listEvidence?(workspaceId: string, decisionId: string): QueryResult
  findExperiment?(workspaceId: string, experimentId: string): QueryResult
}>

export type ReportDecisionInput = Readonly<{
  workspaceId: string
  insightKey: string
  periodStart: string
  periodEnd: string
  observedFacts: readonly string[]
  hypothesis: string
  changeVariable: 'opening' | 'format' | 'cta' | 'timing' | 'other'
  invariants: readonly string[]
  customerSignalIds: readonly string[]
  ownerNote?: string | null
  evidenceVersionIds: readonly string[]
}>

export type ReportExperimentInput = Readonly<{
  workspaceId: string
  decisionId: string
  hypothesis: string
  changeVariable: 'opening' | 'format' | 'cta' | 'timing' | 'other'
  invariantKeys: readonly string[]
  variantAContentVersionId: string
  variantBContentVersionId: string
  variantAScheduledAt: string
  variantBScheduledAt: string
  primaryMetric: string
  secondaryMetrics: readonly string[]
  guardrailMetrics: readonly string[]
  reviewAt: string
}>

export type ReportDecisionSummary = Readonly<{
  id: string
  insightKey: string
  observedFacts: readonly string[]
  hypothesis: string
  changeVariable: ReportDecisionInput['changeVariable']
  invariants: readonly string[]
  evidenceVersionIds: readonly string[]
  conversationThreadId: string | null
  experimentId: string | null
  experimentStatus: ReportExperimentContext['status'] | null
  status: 'draft' | 'conversation_started' | 'experiment_planned' | 'result_ready' | 'learning_candidate'
  createdAt: string
}>

export type ReportDecisionContext = Readonly<{
  id: string
  title: string
  hypothesis: string
  changeVariable: ReportDecisionInput['changeVariable']
  invariants: readonly string[]
  evidenceVersionIds: readonly string[]
}>

export type ReportExperimentContext = Readonly<{
  id: string
  hypothesis: string
  changeVariable: ReportExperimentInput['changeVariable']
  variantAContentVersionId: string
  variantBContentVersionId: string
  variantAScheduledAt: string
  variantBScheduledAt: string
  primaryMetric: string
  reviewAt: string
  approvalState: 'not_requested' | 'pending' | 'approved'
  status: 'planned' | 'running' | 'result_ready' | 'completed' | 'cancelled'
}>

export type ReportDecisionRepository = Readonly<{
  createReportDecision(input: ReportDecisionInput): Promise<
    | Readonly<{ ok: true; decisionId: string }>
    | Readonly<{ ok: false; code: 'REPORT_DECISION_CONFLICT' }>
  >
  listReportDecisions(workspaceId: string): Promise<readonly ReportDecisionSummary[]>
  createReportExperiment(input: ReportExperimentInput): Promise<
    | Readonly<{ ok: true; experimentId: string }>
    | Readonly<{ ok: false; code: 'REPORT_EXPERIMENT_CONFLICT' }>
  >
  getReportDecision(workspaceId: string, decisionId: string): Promise<ReportDecisionContext | null>
  getReportExperiment(workspaceId: string, experimentId: string): Promise<ReportExperimentContext | null>
}>

const insertedSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid() }).strict()
const decisionRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  insight_key: z.string(),
  observed_facts: z.array(z.string()).optional().default([]),
  hypothesis: z.string(),
  change_variable: z.enum(['opening', 'format', 'cta', 'timing', 'other']),
  invariants: z.array(z.string()).optional().default([]),
  conversation_thread_id: z.string().uuid().nullable().optional().default(null),
  report_decision_evidence: z.array(z.object({ content_version_id: z.string().uuid() }).strict()).optional().default([]),
  report_experiments: z.array(z.object({
    id: z.string().uuid(),
    status: z.enum(['planned', 'running', 'result_ready', 'completed', 'cancelled']),
  }).strict()).optional().default([]),
  status: z.enum(['draft', 'conversation_started', 'experiment_planned', 'result_ready', 'learning_candidate']),
  created_at: z.string().datetime({ offset: true }),
}).strict()
const decisionContextRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  observed_facts: z.array(z.string()).min(1),
  hypothesis: z.string(),
  change_variable: z.enum(['opening', 'format', 'cta', 'timing', 'other']),
  invariants: z.array(z.string()),
}).strict()
const evidenceRowSchema = z.object({ content_version_id: z.string().uuid() }).strict()
const experimentContextRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  hypothesis: z.string(),
  change_variable: z.enum(['opening', 'format', 'cta', 'timing', 'other']),
  variant_a_content_version_id: z.string().uuid(),
  variant_b_content_version_id: z.string().uuid(),
  variant_a_scheduled_at: z.string().datetime({ offset: true }),
  variant_b_scheduled_at: z.string().datetime({ offset: true }),
  primary_metric: z.string(),
  review_at: z.string().datetime({ offset: true }),
  approval_state: z.enum(['not_requested', 'pending', 'approved']),
  status: z.enum(['planned', 'running', 'result_ready', 'completed', 'cancelled']),
}).strict()

export function createReportDecisionRepository(
  gateway: ReportDecisionGateway,
  actorUserId: string | null = null,
): ReportDecisionRepository {
  return {
    async createReportDecision(input) {
      const inserted = await gateway.insertDecisionWithEvidence({
        workspace_id: input.workspaceId,
        insight_key: input.insightKey,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        observed_facts: input.observedFacts,
        hypothesis: input.hypothesis,
        change_variable: input.changeVariable,
        invariants: input.invariants,
        customer_signal_ids: input.customerSignalIds,
        owner_note: input.ownerNote ?? null,
        evidence_version_ids: input.evidenceVersionIds,
        ...(actorUserId ? { created_by: actorUserId } : {}),
      })
      const row = insertedSchema.safeParse(inserted.data)
      if (inserted.error || !row.success || row.data.workspace_id !== input.workspaceId) {
        return { ok: false, code: 'REPORT_DECISION_CONFLICT' }
      }
      return { ok: true, decisionId: row.data.id }
    },

    async listReportDecisions(workspaceId) {
      const result = await gateway.listDecisions(workspaceId)
      const rows = z.array(decisionRowSchema).safeParse(result.data)
      if (result.error || !rows.success || rows.data.some((row) => row.workspace_id !== workspaceId)) return []
      return Object.freeze(rows.data.map((row) => Object.freeze({
        id: row.id,
        insightKey: row.insight_key,
        observedFacts: Object.freeze(row.observed_facts),
        hypothesis: row.hypothesis,
        changeVariable: row.change_variable,
        invariants: Object.freeze(row.invariants),
        evidenceVersionIds: Object.freeze(row.report_decision_evidence.map((item) => item.content_version_id)),
        conversationThreadId: row.conversation_thread_id,
        experimentId: row.report_experiments[0]?.id ?? null,
        experimentStatus: row.report_experiments[0]?.status ?? null,
        status: row.status,
        createdAt: row.created_at,
      })))
    },

    async createReportExperiment(input) {
      const result = await gateway.insertExperiment({
        workspace_id: input.workspaceId,
        decision_id: input.decisionId,
        hypothesis: input.hypothesis,
        change_variable: input.changeVariable,
        invariant_keys: input.invariantKeys,
        variant_a_content_version_id: input.variantAContentVersionId,
        variant_b_content_version_id: input.variantBContentVersionId,
        variant_a_scheduled_at: input.variantAScheduledAt,
        variant_b_scheduled_at: input.variantBScheduledAt,
        primary_metric: input.primaryMetric,
        secondary_metrics: input.secondaryMetrics,
        guardrail_metrics: input.guardrailMetrics,
        collection_cadence_hours: [4, 24, 168],
        review_at: input.reviewAt,
        approval_state: 'not_requested',
        status: 'planned',
        ...(actorUserId ? { created_by: actorUserId } : {}),
      })
      const row = insertedSchema.safeParse(result.data)
      if (result.error || !row.success || row.data.workspace_id !== input.workspaceId) {
        return { ok: false, code: 'REPORT_EXPERIMENT_CONFLICT' }
      }
      return { ok: true, experimentId: row.data.id }
    },

    async getReportDecision(workspaceId, decisionId) {
      if (!gateway.findDecision || !gateway.listEvidence) return null
      const [decisionResult, evidenceResult] = await Promise.all([
        gateway.findDecision(workspaceId, decisionId),
        gateway.listEvidence(workspaceId, decisionId),
      ])
      const decision = decisionContextRowSchema.safeParse(decisionResult.data)
      const evidence = z.array(evidenceRowSchema).safeParse(evidenceResult.data)
      if (
        decisionResult.error
        || evidenceResult.error
        || !decision.success
        || !evidence.success
        || decision.data.workspace_id !== workspaceId
      ) return null
      return Object.freeze({
        id: decision.data.id,
        title: decision.data.observed_facts[0],
        hypothesis: decision.data.hypothesis,
        changeVariable: decision.data.change_variable,
        invariants: Object.freeze(decision.data.invariants),
        evidenceVersionIds: Object.freeze(evidence.data.map((item) => item.content_version_id)),
      })
    },

    async getReportExperiment(workspaceId, experimentId) {
      if (!gateway.findExperiment) return null
      const result = await gateway.findExperiment(workspaceId, experimentId)
      const row = experimentContextRowSchema.safeParse(result.data)
      if (result.error || !row.success || row.data.workspace_id !== workspaceId) return null
      return Object.freeze({
        id: row.data.id,
        hypothesis: row.data.hypothesis,
        changeVariable: row.data.change_variable,
        variantAContentVersionId: row.data.variant_a_content_version_id,
        variantBContentVersionId: row.data.variant_b_content_version_id,
        variantAScheduledAt: row.data.variant_a_scheduled_at,
        variantBScheduledAt: row.data.variant_b_scheduled_at,
        primaryMetric: row.data.primary_metric,
        reviewAt: row.data.review_at,
        approvalState: row.data.approval_state,
        status: row.data.status,
      })
    },
  }
}

type RawQuery = Readonly<{
  insert(input: unknown): RawQuery
  select(fields: string): RawQuery
  eq(column: string, value: unknown): RawQuery
  order(column: string, options: Readonly<{ ascending: boolean }>): RawQuery
  limit(value: number): RawQuery
  maybeSingle(): QueryResult
}> & PromiseLike<Readonly<{ data: unknown; error: unknown }>>

type RawClient = Readonly<{ from(table: string): RawQuery; rpc(name: string, input: Record<string, unknown>): RawQuery }>

export async function createProductionReportDecisionRepository(): Promise<ReportDecisionRepository> {
  const client = await createServerSupabaseClient() as unknown as RawClient
  const gateway: ReportDecisionGateway = {
    insertDecisionWithEvidence: (input) => client.rpc('create_report_decision_with_evidence', {
      p_workspace_id: input.workspace_id,
      p_insight_key: input.insight_key,
      p_period_start: input.period_start,
      p_period_end: input.period_end,
      p_observed_facts: input.observed_facts,
      p_hypothesis: input.hypothesis,
      p_change_variable: input.change_variable,
      p_invariants: input.invariants,
      p_customer_signal_ids: input.customer_signal_ids,
      p_owner_note: input.owner_note,
      p_evidence_version_ids: input.evidence_version_ids,
    }).maybeSingle(),
    listDecisions: (workspaceId) => client.from('report_decisions')
      .select('id, workspace_id, insight_key, observed_facts, hypothesis, change_variable, invariants, conversation_thread_id, status, created_at, report_decision_evidence(content_version_id), report_experiments(id, status)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50) as unknown as QueryResult,
    insertExperiment: (input) => client.from('report_experiments').insert(input).select('id, workspace_id').maybeSingle(),
    findDecision: (workspaceId, decisionId) => client.from('report_decisions')
      .select('id, workspace_id, observed_facts, hypothesis, change_variable, invariants')
      .eq('workspace_id', workspaceId)
      .eq('id', decisionId)
      .maybeSingle(),
    listEvidence: (workspaceId, decisionId) => client.from('report_decision_evidence')
      .select('content_version_id')
      .eq('workspace_id', workspaceId)
      .eq('decision_id', decisionId)
      .order('position', { ascending: true }) as unknown as QueryResult,
    findExperiment: (workspaceId, experimentId) => client.from('report_experiments')
      .select('id, workspace_id, hypothesis, change_variable, variant_a_content_version_id, variant_b_content_version_id, variant_a_scheduled_at, variant_b_scheduled_at, primary_metric, review_at, approval_state, status')
      .eq('workspace_id', workspaceId)
      .eq('id', experimentId)
      .maybeSingle(),
  }
  return createReportDecisionRepository(gateway)
}
