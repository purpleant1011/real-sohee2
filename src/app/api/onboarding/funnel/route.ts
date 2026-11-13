export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { computeTimeToFirstPost, recordFunnelEvent, summarizeFunnel, type FunnelEvent } from '@/features/quick-start/funnel-events'

// Outcome events are never accepted from the browser; the publishing server owns them.
export const clientFunnelEventSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  event: z.enum(['preview_viewed', 'revise_requested']),
  missionId: z.string().uuid(),
  revision: z.number().int().min(1).max(100_000).optional(),
}).strict()

export async function POST(req: Request) {
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id'))
  if (isResponse(auth)) return auth

  const parsed = clientFunnelEventSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '퍼널 이벤트 입력값을 확인해 주세요.', code: 'INVALID_INPUT' }, { status: 422 })
  }
  if (parsed.data.workspaceId && parsed.data.workspaceId !== auth.workspaceId) {
    return NextResponse.json({ error: '다른 매장의 이벤트를 기록할 수 없어요.', code: 'WORKSPACE_MISMATCH' }, { status: 403 })
  }

  try {
    // A client may observe a preview, but cannot fabricate one for another workspace's mission.
    const { data: mission, error } = await auth.admin.from('marketing_missions')
      .select('id, status, metadata')
      .eq('id', parsed.data.missionId)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle()
    if (error) throw error
    if (!mission || mission.metadata?.lane !== 'QUICK_POST') {
      return NextResponse.json({ error: '첫 게시물 초안을 찾을 수 없어요.', code: 'MISSION_NOT_FOUND' }, { status: 404 })
    }
    if (!['AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'PUBLISHED_VERIFIED'].includes(mission.status)) {
      return NextResponse.json({ error: '이벤트를 기록할 수 없는 게시물이에요.', code: 'INVALID_MISSION_STATE' }, { status: 409 })
    }
    const actualRevision = mission.metadata?.quick?.revision ?? 1
    if (parsed.data.revision !== undefined && parsed.data.revision !== actualRevision) {
      return NextResponse.json({ error: '게시물 버전이 일치하지 않아요.', code: 'REVISION_MISMATCH' }, { status: 409 })
    }

    const { event, missionId } = parsed.data
    const revision = actualRevision
    await recordFunnelEvent({
      admin: auth.admin,
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      event,
      properties: { missionId, revision },
      dedupeKey: `${event}:${auth.userId}:${missionId}:${revision}`,
    })
    return NextResponse.json({ accepted: true })
  } catch {
    console.warn('[onboarding/funnel] mission lookup failed')
    return NextResponse.json({ error: '이벤트 대상을 확인하지 못했어요.', code: 'LOOKUP_FAILED' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id') || new URL(req.url).searchParams.get('workspaceId'))
  if (isResponse(auth)) return auth
  try {
    const events: FunnelEvent[] = []
    const pageSize = 1000
    const maxEvents = 10_000
    for (let from = 0; from <= maxEvents; from += pageSize) {
      const { data, error } = await auth.admin.from('funnel_events')
        .select('event, occurred_at, user_id')
        .eq('workspace_id', auth.workspaceId)
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw error
      if (from === maxEvents) {
        if (data?.length) return NextResponse.json({ error: '퍼널 조회 범위를 초과했어요.', code: 'FUNNEL_TOO_LARGE' }, { status: 413 })
        break
      }
      if (!Array.isArray(data)) throw new Error('FUNNEL_PAGE_READ_FAILED')
      events.push(...data)
      if (data.length < pageSize) break
    }
    return NextResponse.json({
      workspaceId: auth.workspaceId,
      summary: summarizeFunnel(events),
      timeToFirstPostMs: computeTimeToFirstPost(events.filter((event) => event.user_id === auth.userId)),
    })
  } catch {
    console.warn('[onboarding/funnel] read failed')
    return NextResponse.json({ error: '퍼널을 불러오지 못했어요.', code: 'FUNNEL_READ_FAILED' }, { status: 503 })
  }
}
