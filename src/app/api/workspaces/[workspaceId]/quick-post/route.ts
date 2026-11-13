export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createQuickDraft, QuickPostError, reviseQuickDraft } from '@/features/quick-start/quick-post-service'
import { listQuickPostsPage, parseQuickPostList } from '@/features/quick-start/quick-post-query'
import { loadReadiness } from '@/features/readiness/load'
import { evaluateGate } from '@/features/readiness'
import { SoheeNotReadyError } from '@/features/sohee-ready/types'

async function requireQuickDraftReady(workspaceId: string, supabaseClient: any) {
  const verdict = evaluateGate(await loadReadiness(workspaceId, { supabaseClient }), 'CREATE')
  if (!verdict.allowed) throw new QuickPostError(verdict.message ?? '준비를 완료해 주세요.', 'PREPARATION_REQUIRED', 403)
}
import { quickPostCost } from '@/features/quick-start/quick-post-credits'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { randomUUID } from 'node:crypto'

type Ctx = { params: Promise<{ workspaceId: string }> }

function fail(err: unknown) {
  if (err instanceof QuickPostError) {
    return NextResponse.json({ error: err.message, code: err.code, ...(err.details ?? {}) }, { status: err.status })
  }
  if (err instanceof SoheeNotReadyError) {
    return NextResponse.json(
      {
        error: err.snapshot.blockers[0]?.message ?? '준비가 아직 끝나지 않았어요.',
        code: 'SOHEE_NOT_READY',
        blockers: err.snapshot.blockers.map((b) => ({ code: b.code, message: b.message, href: b.remediationHref })),
        membershipTier: err.membershipTier,
        membershipNotice: err.membershipNotice,
        notice: err.notice,
      },
      { status: 403 },
    )
  }
  const e = err as any
  if (e?.name === 'FirstPostComposerProviderError' || e?.name === 'CreativeGenerationError') {
    console.error('[quick-post] provider error', e)
    return NextResponse.json(
      { error: '소희가 글과 사진을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', code: e.code ?? 'PROVIDER_ERROR' },
      { status: 502 },
    )
  }
  console.error('[quick-post]', err)
  return NextResponse.json({ error: '요청을 처리하지 못했어요.', code: 'INTERNAL_ERROR' }, { status: 500 })
}

export async function GET(req: Request, { params }: Ctx) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const options = parseQuickPostList(new URL(req.url).searchParams)
    const [paged, creditState] = await Promise.all([
      listQuickPostsPage(auth.admin, auth.workspaceId, options),
      auth.admin.from('workspace_credit_states').select('total_available_credits').eq('workspace_id', auth.workspaceId).maybeSingle(),
    ])
    const value = creditState.data?.total_available_credits
    const available = value == null || creditState.error ? NaN : Number(value)
    return NextResponse.json({
      items: paged.items,
      nextCursor: paged.nextCursor,
      prevCursor: paged.prevCursor,
      hasNextPage: paged.hasNextPage,
      hasAnySupportedContent: paged.hasAnySupportedContent,
      credits: { available: Number.isFinite(available) ? Math.max(0, available) : null, draftCost: quickPostCost('both'), photoDraftCost: quickPostCost('text') },
    }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (err) {
    return fail(err)
  }
}

const createSchema = z.object({
  topic: z.string().trim().max(300).default(''), requestId: z.string().uuid().optional(),
  sourceAssetIds: z.array(z.string().uuid()).max(1).optional(),
  maxDraftCredits: z.number().int().min(0).max(1_000_000).optional(),
})

export async function POST(req: Request, { params }: Ctx) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const body = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!body.success) return NextResponse.json({ error: '주제를 확인해 주세요.', code: 'INVALID_INPUT' }, { status: 422 })
  try {
    await requireQuickDraftReady(auth.workspaceId, auth.supabase)
    const cost = quickPostCost(body.data.sourceAssetIds?.length ? 'text' : 'both')
    if (body.data.maxDraftCredits !== undefined && cost > body.data.maxDraftCredits) {
      return NextResponse.json({ error: '원고 제작 비용이 바뀌었어요. 새 비용을 확인한 뒤 다시 요청해 주세요.', code: 'DRAFT_COST_CHANGED', requiredCredits: cost }, { status: 409, headers: { 'cache-control': 'private, no-store' } })
    }
    const requestId = body.data.requestId ?? randomUUID()
    await recordFunnelEvent({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, event: 'draft_requested', properties: { requestId }, dedupeKey: `draft_requested:${requestId}` })
    const item = await createQuickDraft({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, topic: body.data.topic, missionId: requestId, ...(body.data.sourceAssetIds ? { sourceAssetIds: body.data.sourceAssetIds } : {}) })
    await recordFunnelEvent({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, event: 'draft_ready', properties: { missionId: item.missionId, requestId }, dedupeKey: `draft_ready:${item.missionId}` })
    return NextResponse.json({ item }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (err) {
    return fail(err)
  }
}

const copiesSchema = z.object({
  instagram: z.object({
    caption: z.string().trim().min(1, '인스타그램 글을 입력해 주세요.').max(2200),
    hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  }),
  threads: z.object({ content: z.string().trim().min(1, '스레드 글을 입력해 주세요.').max(500) }),
})

const reviseSchema = z
  .object({
    missionId: z.string().uuid(),
    feedback: z.string().trim().max(300).default(''),
    scope: z.enum(['text', 'image', 'both']).default('both'),
    copies: copiesSchema.optional(),
    requestId: z.string().uuid().optional(),
    expectedRevision: z.number().int().min(1).optional(),
  })
  .refine((v) => v.copies || v.feedback.length > 0, { message: '수정하고 싶은 내용을 알려 주세요.', path: ['feedback'] })

export async function PATCH(req: Request, { params }: Ctx) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const body = reviseSchema.safeParse(await req.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? '입력값을 확인해 주세요.', code: 'INVALID_INPUT' }, { status: 422 })
  }
  try {
    await requireQuickDraftReady(auth.workspaceId, auth.supabase)
    const item = await reviseQuickDraft({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, missionId: body.data.missionId, feedback: body.data.feedback, scope: body.data.scope, manualCopies: body.data.copies as any, requestId: body.data.requestId, expectedRevision: body.data.expectedRevision })
    return NextResponse.json({ item })
  } catch (err) {
    return fail(err)
  }
}
