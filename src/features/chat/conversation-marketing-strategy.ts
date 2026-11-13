import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { buildBlogStrategyBrief, marketingStrategyBriefSchema, type MarketingStrategyBrief } from '@/features/content/blog-strategy-brief'

export { marketingStrategyReferenceSchema, marketingStrategyApprovalSchema } from './marketing-strategy-schema'
const recordSchema = z.object({
  brief: marketingStrategyBriefSchema, goalVersion: z.number().int().positive(),
  approvedBy: z.string().uuid(), approvedAt: z.string().datetime({ offset: true }),
}).strict()

type Scope = { client: SupabaseClient<Database>; workspaceId: string; threadId: string; missionId: string; runId: string }
const fail = (code = 'INVALID'): never => { throw new Error(`MARKETING_STRATEGY_${code}`) }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : fail()

export async function loadMarketingStrategyScope(input: Scope) {
  const { client, workspaceId, threadId, missionId, runId } = input
  const [registry, thread, mission, run] = await Promise.all([
    client.from('workspace_registry').select('dataset_mode').eq('workspace_id', workspaceId).maybeSingle(),
    client.from('conversation_threads').select('id').eq('workspace_id', workspaceId).eq('id', threadId).eq('status', 'active').maybeSingle(),
    client.from('marketing_missions').select('id, status, source_conversation_job_id, metadata').eq('workspace_id', workspaceId).eq('id', missionId).maybeSingle(),
    client.from('conversation_jobs').select('id, thread_id, status, plan_data').eq('workspace_id', workspaceId).eq('id', runId).eq('thread_id', threadId).maybeSingle(),
  ])
  if ([registry, thread, mission, run].some((result) => result.error || !result.data)) fail('UNAVAILABLE')
  if (mission.data!.source_conversation_job_id !== runId
    || !['RECEIVED', 'PLANNING', 'PRODUCING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(mission.data!.status)
    || !['queued', 'running', 'planning', 'executing', 'verifying', 'awaiting_approval', 'succeeded', 'completed'].includes(run.data!.status)) fail()
  const metadata = object(mission.data!.metadata ?? {})
  if (metadata.execution_state !== undefined && !['DRAFT', 'READY', 'RUNNING'].includes(String(metadata.execution_state))) fail('CONTROL_BLOCKED')
  const mode = z.enum(['ACTUAL', 'SHOWCASE_DEMO', 'TEST']).parse(registry.data!.dataset_mode)
  return { mode, plan: object(run.data!.plan_data), rawPlan: run.data!.plan_data }
}

async function loadGoal(input: Scope, id: string) {
  const result = await input.client.from('sohee_goals').select('id, status, version, desired_outcome')
    .eq('workspace_id', input.workspaceId).eq('id', id).eq('status', 'active').maybeSingle()
  if (result.error || !result.data) fail('GOAL_UNAVAILABLE')
  return result.data!
}

export async function loadConversationMarketingStrategy(input: Scope & { briefId: string; revision: number }) {
  const stored = await loadMarketingStrategyScope(input)
  const record = recordSchema.parse(stored.plan.marketing_strategy)
  const brief = record.brief
  if (stored.plan.blog_strategy_proposal) {
    const { assertBlogStrategyProposalFresh } = await import('./blog-strategy-proposal')
    await assertBlogStrategyProposalFresh({ ...input, userId: record.approvedBy })
  }
  const goal = await loadGoal(input, brief.businessGoal.id)
  if (brief.datasetMode !== stored.mode) fail('DATASET_MISMATCH')
  if (brief.id !== input.briefId || brief.revision !== input.revision || goal.version !== record.goalVersion
    || goal.desired_outcome !== brief.businessGoal.description) fail('STALE')
  const lineage = { conversationId: input.threadId, missionId: input.missionId, runId: input.runId }
  buildBlogStrategyBrief(brief, { workspaceId: input.workspaceId, datasetMode: stored.mode, lineage })
  return { brief, datasetMode: stored.mode, lineage }
}

// Explicit owner attestation only. Public observations/inquiry imports need their own verified producer.
// Uses existing run JSON with compare-and-swap; never creates a new mission/run or calls a provider.
export async function approveConversationMarketingStrategy(input: Scope & {
  userId: string; expectedRevision: number; brief: unknown; now?: string
}): Promise<MarketingStrategyBrief> {
  const membership = await input.client.from('workspace_members').select('role')
    .eq('workspace_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle()
  if (membership.error || membership.data?.role !== 'owner') fail('FORBIDDEN')
  const stored = await loadMarketingStrategyScope(input)
  const submitted = marketingStrategyBriefSchema.parse(input.brief)
  if (submitted.questions.some((row) => row.source !== 'verified_owner')
    || submitted.evidence.some((row) => row.source !== 'verified_owner')) fail('OWNER_EVIDENCE_REQUIRED')
  const current = stored.plan.marketing_strategy === undefined ? null : recordSchema.parse(stored.plan.marketing_strategy)
  if ((current?.brief.revision ?? 0) !== input.expectedRevision || (current && current.brief.id !== submitted.id)) fail('STALE')
  const goal = await loadGoal(input, submitted.businessGoal.id)
  const approvedAt = input.now ?? new Date().toISOString()
  const revision = input.expectedRevision + 1
  const attestationRef = (id: string) => `owner-attestation:${input.userId}:${submitted.id}:${revision}:${id}`
  const brief = marketingStrategyBriefSchema.parse({ ...submitted, revision,
    businessGoal: { ...submitted.businessGoal, description: goal.desired_outcome },
    questions: submitted.questions.map((row) => ({ ...row, evidenceRef: attestationRef(row.id), observedAt: approvedAt })),
    evidence: submitted.evidence.map((row) => ({ ...row, sourceRef: attestationRef(row.id), observedAt: approvedAt })),
  })
  buildBlogStrategyBrief(brief, { workspaceId: input.workspaceId, datasetMode: stored.mode,
    lineage: { conversationId: input.threadId, missionId: input.missionId, runId: input.runId } })
  const record = recordSchema.parse({ brief, goalVersion: goal.version, approvedBy: input.userId,
    approvedAt })
  const plan = JSON.parse(JSON.stringify({ ...stored.plan, marketing_strategy: record }))
  const saved = await input.client.from('conversation_jobs').update({ plan_data: plan })
    .eq('workspace_id', input.workspaceId).eq('id', input.runId).eq('thread_id', input.threadId)
    .eq('plan_data', JSON.stringify(stored.rawPlan)).select('id').maybeSingle()
  if (saved.error || !saved.data) fail('CONFLICT')
  return (await loadConversationMarketingStrategy({ ...input, briefId: brief.id, revision: brief.revision })).brief
}
