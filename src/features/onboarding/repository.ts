import 'server-only'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { profileKeys, type OnboardingSnapshot } from './types'
import type { ProfileCandidateDraft } from './extraction-provider'

type QueryResult = Promise<{ data: unknown; error: unknown }>

type QueryBuilder = PromiseLike<{ data: unknown; error: unknown }> & {
  select(columns: string): QueryBuilder
  eq(column: string, value: unknown): QueryBuilder
  order(column: string, options?: { ascending?: boolean }): QueryBuilder
  limit(count: number): QueryBuilder
  maybeSingle(): Promise<{ data: unknown; error: unknown }>
}

type UntypedSupabaseClient = {
  from(table: string): QueryBuilder
  rpc(name: string, args: Record<string, unknown>): QueryResult
}

type SaveAnswerInput = Readonly<{
  workspaceId: string
  sessionId: string
  step: (typeof profileKeys)[number]
  content: string
  clientRequestId: string
}>

type ReviewCandidateInput = Readonly<{
  workspaceId: string
  candidateId: string
  decision: 'approved' | 'revised' | 'rejected'
  confirmedValue: string
  expectedVersion: number
}>

export type OnboardingGateway = Readonly<{
  readSession(workspaceId: string): QueryResult
  listAnswers(workspaceId: string, sessionId: string): QueryResult
  listCandidates(workspaceId: string, sessionId: string): QueryResult
  start(clientRequestId: string): QueryResult
  saveAnswer(input: SaveAnswerInput): QueryResult
  createCandidate(input: SaveAnswerInput, candidate: ProfileCandidateDraft): QueryResult
  listApprovedFacts(workspaceId: string): QueryResult
  reviewCandidate(input: ReviewCandidateInput): QueryResult
  restart(input: Readonly<{
    workspaceId: string
    sessionId: string
    clientRequestId: string
  }>): QueryResult
}>

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const sessionSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  thread_id: uuidSchema,
  status: z.enum(['in_progress', 'review_required', 'completed']),
  active_step: z.enum([...profileKeys, 'summary', 'completed']),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict()
const answerRowSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  session_id: uuidSchema,
  profile_key: z.enum(profileKeys),
  content: z.string().min(1).max(4_000),
  created_at: timestampSchema,
}).strict()
const candidateRowSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  session_id: uuidSchema,
  answer_id: uuidSchema,
  profile_key: z.enum(profileKeys),
  original_value: z.string().min(1).max(4_000),
  proposed_value: z.string().min(1).max(4_000),
  confirmed_value: z.string().min(1).max(4_000).nullable(),
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string().min(1).max(2_000),
  source: z.literal('onboarding_answer'),
  status: z.enum(['review_required', 'active', 'rejected', 'superseded']),
  version: z.number().int().nonnegative(),
  reviewed_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict()
const approvedFactRowSchema = z.object({
  workspace_id: uuidSchema,
  category: z.enum(profileKeys),
  content: z.string().min(1).max(4_000),
  status: z.literal('active'),
}).strict()

function failure<T>(): ActionResult<T> {
  return {
    error: {
      message: '가입 준비 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      requestId: 'onboarding-snapshot',
    },
  }
}

export async function createOnboardingGateway(): Promise<OnboardingGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient() as unknown as UntypedSupabaseClient

  const answerArgs = (input: SaveAnswerInput, candidate: ProfileCandidateDraft | null) => ({
    p_workspace_id: input.workspaceId,
    p_session_id: input.sessionId,
    p_step: input.step,
    p_content: input.content,
    p_client_request_id: input.clientRequestId,
    p_candidate: candidate ?? {},
  })

  return Object.freeze({
    readSession(workspaceId) {
      return supabase
        .from('onboarding_sessions')
        .select('id, workspace_id, thread_id, status, active_step, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    },
    listAnswers(workspaceId, sessionId) {
      return Promise.resolve(supabase
        .from('onboarding_answers')
        .select('id, workspace_id, session_id, profile_key, content, created_at')
        .eq('workspace_id', workspaceId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }))
    },
    listCandidates(workspaceId, sessionId) {
      return Promise.resolve(supabase
        .from('workspace_profile_candidates')
        .select('id, workspace_id, session_id, answer_id, profile_key, original_value, proposed_value, confirmed_value, confidence, evidence_quote, source, status, version, reviewed_at, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }))
    },
    start(clientRequestId) {
      return supabase.rpc('start_v08_onboarding', { p_client_request_id: clientRequestId })
    },
    saveAnswer(input) {
      return supabase.rpc('save_v08_onboarding_answer', answerArgs(input, null))
    },
    createCandidate(input, candidate) {
      return supabase.rpc('save_v08_onboarding_answer', answerArgs(input, candidate))
    },
    listApprovedFacts(workspaceId) {
      return Promise.resolve(supabase
        .from('knowledge_facts')
        .select('workspace_id, category, content, status')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('category', { ascending: true })
        .limit(profileKeys.length))
    },
    reviewCandidate(input) {
      return supabase.rpc('review_v08_profile_candidate', {
        p_workspace_id: input.workspaceId,
        p_candidate_id: input.candidateId,
        p_decision: input.decision,
        p_confirmed_value: input.confirmedValue,
        p_expected_version: input.expectedVersion,
      })
    },
    restart(input) {
      return supabase.rpc('restart_v08_onboarding', {
        p_workspace_id: input.workspaceId,
        p_session_id: input.sessionId,
        p_client_request_id: input.clientRequestId,
      })
    },
  })
}

export async function getOnboardingSnapshot(
  workspaceId: string,
  providedGateway?: OnboardingGateway,
): Promise<ActionResult<OnboardingSnapshot>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return failure()

  try {
    const gateway = providedGateway ?? await createOnboardingGateway()
    const sessionResult = await gateway.readSession(parsedWorkspaceId.data)
    if (sessionResult.error) return failure()
    if (sessionResult.data === null) {
      return { data: Object.freeze({
        sessionId: null,
        workspaceId: parsedWorkspaceId.data,
        threadId: null,
        status: 'not_started' as const,
        activeStep: 'welcome' as const,
        approvedProfileKeys: Object.freeze([]),
        approvedFacts: Object.freeze([]),
        answers: Object.freeze([]),
        candidates: Object.freeze([]),
      }) }
    }

    const session = sessionSchema.safeParse(sessionResult.data)
    if (!session.success || session.data.workspace_id !== parsedWorkspaceId.data) return failure()

    const [answersResult, candidatesResult, factsResult] = await Promise.all([
      gateway.listAnswers(parsedWorkspaceId.data, session.data.id),
      gateway.listCandidates(parsedWorkspaceId.data, session.data.id),
      gateway.listApprovedFacts(parsedWorkspaceId.data),
    ])
    const answers = z.array(answerRowSchema).safeParse(answersResult.data)
    const candidates = z.array(candidateRowSchema).safeParse(candidatesResult.data)
    const facts = z.array(approvedFactRowSchema).safeParse(factsResult.data)
    if (
      answersResult.error
      || candidatesResult.error
      || factsResult.error
      || !answers.success
      || !candidates.success
      || !facts.success
      || answers.data.some((row) => row.workspace_id !== parsedWorkspaceId.data || row.session_id !== session.data.id)
      || candidates.data.some((row) => row.workspace_id !== parsedWorkspaceId.data || row.session_id !== session.data.id)
      || facts.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)
      || candidates.data.some((row) => row.status === 'active' && row.confirmed_value === null)
    ) {
      return failure()
    }

    return { data: Object.freeze({
      sessionId: session.data.id,
      workspaceId: session.data.workspace_id,
      threadId: session.data.thread_id,
      status: session.data.status,
      activeStep: session.data.active_step,
      approvedProfileKeys: Object.freeze(facts.data.map((fact) => fact.category)),
      approvedFacts: Object.freeze(facts.data.map((fact) => Object.freeze({
        key: fact.category,
        value: fact.content,
      }))),
      answers: Object.freeze(answers.data.map((answer) => Object.freeze({
        id: answer.id,
        step: answer.profile_key,
        content: answer.content,
        createdAt: answer.created_at,
      }))),
      candidates: Object.freeze(candidates.data.map((candidate) => Object.freeze({
        id: candidate.id,
        answerId: candidate.answer_id,
        key: candidate.profile_key,
        originalValue: candidate.original_value,
        proposedValue: candidate.proposed_value,
        confirmedValue: candidate.confirmed_value,
        confidence: candidate.confidence,
        evidenceQuote: candidate.evidence_quote,
        source: candidate.source,
        status: candidate.status,
        version: candidate.version,
        reviewedAt: candidate.reviewed_at,
        createdAt: candidate.created_at,
        updatedAt: candidate.updated_at,
      }))),
    }) }
  } catch {
    return failure()
  }
}
