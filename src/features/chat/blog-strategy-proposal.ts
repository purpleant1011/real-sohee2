import { randomUUID } from 'node:crypto'
import { parseBlogStrategySelection } from './blog-strategy-selection'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { listApprovedKnowledgeFacts } from '@/features/harness/repository'
import { recommendBlogTopics } from '@/features/content/blog-topic-recommender'
import { buildBlogStrategyBrief, extractExcludedClaims, marketingStrategyBriefSchema } from '@/features/content/blog-strategy-brief'
import { loadMarketingStrategyScope, marketingStrategyReferenceSchema } from './conversation-marketing-strategy'

const text = (max: number) => z.string().trim().min(1).max(max)
export const blogStrategyDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open') }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
  z.object({ action: z.literal('respond'), proposalId: z.string().uuid(), expectedRevision: z.number().int().positive(),
    text: text(320) }).strict(),
  z.object({ action: z.literal('select'), proposalId: z.string().uuid(), expectedRevision: z.number().int().positive(),
    selectedIndex: z.number().int().min(0).max(2), audience: text(300).optional(), constraints: z.string().trim().max(300).optional() }).strict(),
  z.object({ action: z.literal('approve'), proposalId: z.string().uuid(), expectedRevision: z.number().int().positive(),
    confirmed: z.literal(true), outcome: z.enum(['valid_inquiry', 'confirmed_booking', 'verified_sale']) }).strict(),
])
const proposalSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), status: z.enum(['proposed', 'approved']),
  topics: z.array(z.object({ title: text(200), evidence: z.array(text(1000)).min(1), questionSource: z.literal('inferred'),
    primaryKeyword: text(100).optional(), keywordStatus: z.enum(['OBSERVED', 'NOT_OBSERVED']).optional(),
    // 소희 내부 1st-party 점수. 검색 수요·노출 점수가 아니다.
    keywordScore: z.object({ score: z.number().min(0).max(100), coverage: z.number().min(0).max(100),
      unmeasured: z.array(z.string().max(40)).max(5), policyVersion: z.string().max(40) }).strict().optional() }).strict()).length(3),
  goal: z.object({ description: text(500) }).strict(),
  unknowns: z.array(text(200)), selectedIndex: z.number().int().min(0).max(2).nullable(),
  audience: text(300), constraints: z.string().max(300),
  reference: marketingStrategyReferenceSchema.optional(),
}).strict()
const storedSchema = z.object({ view: proposalSchema, snapshot: z.string(), goalId: z.string().uuid() }).strict()
export type BlogStrategyProposal = z.infer<typeof proposalSchema>
type Input = { client: SupabaseClient<Database>; workspaceId: string; threadId: string; userId: string; now?: string }
const fail = (code: string): never => { throw new Error(`MARKETING_STRATEGY_${code}`) }

async function loadProposalRun(input: Input) {
  const membership = await input.client.from('workspace_members').select('role')
    .eq('workspace_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle()
  if (membership.error || !membership.data || !['owner', 'member'].includes(membership.data.role)) fail('FORBIDDEN')
  const runs = await input.client.from('conversation_jobs').select('id, plan_data').eq('workspace_id', input.workspaceId)
    .eq('thread_id', input.threadId).order('sequence_number', { ascending: false }).limit(1)
  if (runs.error) fail('UNAVAILABLE')
  return { role: membership.data!.role, run: runs.data?.[0] ?? null }
}

async function context(input: Input, loaded?: Awaited<ReturnType<typeof loadProposalRun>>) {
  const { role, run } = loaded ?? await loadProposalRun(input)
  if (!run) return fail('RUN_REQUIRED')
  const plan = run.plan_data as Record<string, unknown> | null
  const missionId = z.string().uuid().safeParse(plan?.missionId)
  if (!missionId.success) fail('MISSION_REQUIRED')
  const scope = { ...input, missionId: missionId.data!, runId: run.id }
  const stored = await loadMarketingStrategyScope(scope)
  const goals = await input.client.from('sohee_goals').select('id, status, version, desired_outcome')
    .eq('workspace_id', input.workspaceId).eq('status', 'active').order('updated_at', { ascending: false }).limit(2)
  if (goals.error) fail('GOAL_UNAVAILABLE')
  // Ambiguous goals must be resolved in the existing goal flow, not guessed here.
  if (goals.data?.length !== 1) fail('GOAL_REQUIRED')
  const goal = goals.data![0]
  const facts = await listApprovedKnowledgeFacts(input)
  const timestamp = Date.parse(input.now ?? new Date().toISOString())
  if (!Number.isFinite(timestamp)) fail('INVALID')
  const validFacts = facts.filter(fact => Date.parse(fact.approvedAt) <= timestamp
    && Date.parse(fact.validFrom) <= timestamp && (!fact.validUntil || Date.parse(fact.validUntil) > timestamp))
    .slice(0, 10).sort((a, b) => a.id.localeCompare(b.id))
  const snapshot = JSON.stringify({ mode: stored.mode, goal, facts: validFacts })
  return { ...stored, scope, role, goal, facts: validFacts, snapshot }
}
type Context = Awaited<ReturnType<typeof context>>
async function save(ctx: Context, view: BlogStrategyProposal, extra: Record<string, unknown> = {}) {
  const plan = JSON.parse(JSON.stringify({ ...ctx.plan, ...extra,
    blog_strategy_proposal: { view, snapshot: ctx.snapshot, goalId: ctx.goal.id } }))
  const result = await ctx.scope.client.from('conversation_jobs').update({ plan_data: plan })
    .eq('workspace_id', ctx.scope.workspaceId).eq('id', ctx.scope.runId).eq('thread_id', ctx.scope.threadId)
    .eq('plan_data', JSON.stringify(ctx.rawPlan)).select('id').maybeSingle()
  if (result.error || !result.data) fail('CONFLICT')
  return view
}
function current(ctx: Context, id: string, revision: number) {
  const stored = storedSchema.parse(ctx.plan.blog_strategy_proposal)
  if (stored.view.id !== id || stored.view.revision !== revision || stored.snapshot !== ctx.snapshot) fail('STALE')
  return stored.view
}

export async function readBlogStrategyProposal(input: Input): Promise<BlogStrategyProposal | null> {
  const loaded = await loadProposalRun(input)
  const plan = loaded.run?.plan_data as Record<string, unknown> | null
  // A read must not require creating a mission or goal for a conversation with no saved proposal.
  if (!plan?.blog_strategy_proposal) return null
  const ctx = await context(input, loaded)
  const stored = storedSchema.parse(ctx.plan.blog_strategy_proposal)
  if (stored.snapshot !== ctx.snapshot) fail('STALE')
  return stored.view
}

export async function openBlogStrategyProposal(input: Input & { prompt?: string; refresh?: boolean }): Promise<BlogStrategyProposal> {
  const ctx = await context(input)
  const previous = ctx.plan.blog_strategy_proposal ? storedSchema.parse(ctx.plan.blog_strategy_proposal).view : null
  if (previous && !input.refresh) {
    if (storedSchema.parse(ctx.plan.blog_strategy_proposal).snapshot !== ctx.snapshot) fail('STALE')
    return previous
  }
  if (!ctx.facts.length) fail('FACTS_REQUIRED')
  const recommended = recommendBlogTopics({
    facts: ctx.facts.map(f => ({ id: f.id, category: f.category, content: f.content, observedAt: f.approvedAt })),
    // 새로고침 때는 사장님이 앞서 적은 제외 조건을 후보 배제에 쓴다. 외부 검색 지표는 쓰지 않는다.
    scoring: { workspaceId: input.workspaceId, datasetMode: ctx.mode, excludedClaims: extractExcludedClaims(previous?.constraints ?? '') },
  })
  if (recommended.length < 3) fail('TOPICS_INSUFFICIENT')
  const view = proposalSchema.parse({ id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, status: 'proposed',
    goal: { description: ctx.goal.desired_outcome },
    topics: recommended.map(t => ({ title: t.title, evidence: t.evidence, questionSource: 'inferred',
      primaryKeyword: t.primaryKeyword || undefined, keywordStatus: t.keywordSignal.status,
      ...(t.keywordScore ? { keywordScore: { ...t.keywordScore, unmeasured: [...t.keywordScore.unmeasured] } } : {}) })),
    unknowns: ['검색 수요·AI 가시성·문의 성과는 아직 측정하지 않았어요.', '주제는 승인된 가게 정보를 바탕으로 한 제안이며 실제 고객 질문이 아니에요.'],
    selectedIndex: null, audience: '서비스 이용을 검토하는 분', constraints: '' })
  return save(ctx, view)
}

export async function updateBlogStrategyProposal(input: Input & {
  proposalId: string; expectedRevision: number; selectedIndex: number; audience?: string; constraints?: string
}): Promise<BlogStrategyProposal> {
  const ctx = await context(input)
  const view = current(ctx, input.proposalId, input.expectedRevision)
  const updated = proposalSchema.parse({ ...view, revision: view.revision + 1, status: 'proposed', reference: undefined,
    selectedIndex: input.selectedIndex, audience: input.audience ?? view.audience, constraints: input.constraints ?? view.constraints })
  return save(ctx, updated)
}

export async function respondToBlogStrategyProposal(input: Input & {
  proposalId: string; expectedRevision: number; text: string
}): Promise<BlogStrategyProposal> {
  const selection = parseBlogStrategySelection(input.text)
  if (!selection) fail('SELECTION_REQUIRED')
  return updateBlogStrategyProposal({ ...input, ...selection! })
}

export async function approveBlogStrategyProposal(input: Input & {
  proposalId: string; expectedRevision: number; confirmed: boolean;
  outcome: 'valid_inquiry' | 'confirmed_booking' | 'verified_sale'
}): Promise<BlogStrategyProposal> {
  const ctx = await context(input)
  if (ctx.role !== 'owner') fail('FORBIDDEN')
  const view = current(ctx, input.proposalId, input.expectedRevision)
  if (view.selectedIndex === null) fail('SELECTION_REQUIRED')
  if (!input.confirmed) fail('CONFIRMATION_REQUIRED')
  if (view.status === 'approved') return view
  const previous = ctx.plan.marketing_strategy === undefined ? null
    : marketingStrategyBriefSchema.parse((ctx.plan.marketing_strategy as { brief: unknown }).brief)
  const revision = (previous?.revision ?? 0) + 1
  const id = previous?.id ?? randomUUID()
  const approvedAt = input.now ?? new Date().toISOString()
  const actions = { valid_inquiry: ['inquire', '서비스에 대해 문의해 주세요.'],
    confirmed_booking: ['book', '예약 조건을 문의해 주세요.'], verified_sale: ['buy', '구매 조건을 문의해 주세요.'] } as const
  const [kind, instruction] = actions[input.outcome]
  const excludedClaims = extractExcludedClaims(view.constraints)
  const chosen = view.topics[view.selectedIndex!]
  // 선택한 주제의 키워드만 원고 전략으로 넘긴다. 점수는 소희 내부 1st-party 기준이고 검색 관측 여부는 그대로 보존한다.
  const focusKeyword = chosen.primaryKeyword ? { keyword: chosen.primaryKeyword, searchStatus: chosen.keywordStatus ?? 'NOT_OBSERVED',
    ...(chosen.keywordScore ? { internalScore: chosen.keywordScore.score } : {}) } : null
  const brief = marketingStrategyBriefSchema.parse({ schemaVersion: 1, id, revision,
    workspaceId: input.workspaceId, datasetMode: ctx.mode,
    lineage: { conversationId: input.threadId, missionId: ctx.scope.missionId, runId: ctx.scope.runId },
    businessGoal: { id: ctx.goal.id, description: ctx.goal.desired_outcome, outcome: input.outcome },
    opportunity: { id: view.id, description: view.topics[view.selectedIndex!].title }, targetAudience: view.audience,
    questions: [], evidence: ctx.facts.map(fact => ({ id: fact.id, summary: fact.content, source: 'verified_owner',
      sourceRef: `knowledge_fact:${fact.id}:owner-attestation:${input.userId}:${revision}`, observedAt: approvedAt })),
    nextAction: { kind, instruction: [instruction, view.constraints].filter(Boolean).join(' ') },
    ...(excludedClaims.length ? { excludedClaims } : {}), ...(focusKeyword ? { focusKeyword } : {}) })
  buildBlogStrategyBrief(brief, { workspaceId: input.workspaceId, datasetMode: ctx.mode, lineage: brief.lineage })
  const reference = { missionId: ctx.scope.missionId, runId: ctx.scope.runId, briefId: id, revision }
  // Approval and decision are one CAS: a partial write cannot leave an executable old approval.
  return save(ctx, proposalSchema.parse({ ...view, status: 'approved', revision: view.revision + 1, reference }), {
    marketing_strategy: { brief, goalVersion: ctx.goal.version, approvedBy: input.userId, approvedAt },
  })
}

export async function assertBlogStrategyProposalFresh(input: Input & { briefId: string; revision: number }) {
  const ctx = await context(input)
  const stored = storedSchema.parse(ctx.plan.blog_strategy_proposal)
  if (stored.snapshot !== ctx.snapshot || stored.view.status !== 'approved'
    || stored.view.reference?.briefId !== input.briefId || stored.view.reference?.revision !== input.revision) fail('STALE')
}
