export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { resolvePublicationEvidence } from '@/features/mobile-decision/server/publication-evidence'

const mobileListRow = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  title: z.string(),
  channel: z.string(),
  status: z.string(),
  created_at: z.string(),
  current_version_id: z.string().nullable().optional(),
})
const readHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard (E2E-F F-2): refuse a non-member before listing workspace content.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    if (request.nextUrl.searchParams.get('view') === 'mobile-list') {
      // 목록은 버전 생성 전 초안도 포함한다. 본문·미디어·승인 상세 실패에 종속시키지 않는다.
      // 인증된 사용자 클라이언트(RLS)와 매장 필터를 모두 유지한다.
      const cursorValue = request.nextUrl.searchParams.get('cursor')
      let cursor: { createdAt: string; id: string } | null = null
      if (cursorValue) {
        try {
          cursor = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict().parse(JSON.parse(cursorValue))
        } catch {
          return NextResponse.json({ success: false, error: { code: 'INVALID_CURSOR', message: '목록을 처음부터 다시 확인해 주세요.' } }, { status: 400, headers: readHeaders })
        }
      }
      let query = auth.supabase.from('content_items')
        .select('id, workspace_id, title, channel, status, created_at, current_version_id')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
      const { data, error } = await query.limit(201)
      const rows = z.array(mobileListRow).safeParse(data)
      if (error || !rows.success || rows.data.some(row => row.workspace_id !== workspaceId)) {
        throw new Error('작업 목록을 조회하지 못했습니다.')
      }
      const hasMore = rows.data.length > 200
      const page = rows.data.slice(0, 200)
      const last = page.at(-1)

      const verifiedMap = await resolvePublicationEvidence(
        auth.supabase,
        workspaceId,
        page.map(r => ({ id: r.id, channel: r.channel, status: r.status, currentVersionId: r.current_version_id })),
      )

      return NextResponse.json({
        success: true,
        // 콘텐츠 목록의 조회 완전성이며 승인·외부 게시 확인과는 별개다.
        complete: !hasMore,
        hasMore,
        nextCursor: hasMore && last ? JSON.stringify({ createdAt: last.created_at, id: last.id }) : null,
        contents: page.map(row => ({
          contentId: row.id, workspaceId: row.workspace_id, title: row.title,
          channel: row.channel, status: row.status, createdAt: row.created_at,
          publicationVerified: verifiedMap.has(row.id),
        })),
      }, { headers: readHeaders })
    }
    const contents = await CanonicalContentLifecycleService.listWorkspaceContents(workspaceId)
    return NextResponse.json({
      success: true,
      contents,
    }, { headers: readHeaders })
  } catch (err: unknown) {
    console.error('[Content API] GET error:', err)
    return NextResponse.json({
      success: false,
      error: {
        code: 'FETCH_CONTENT_FAILED',
        message: (err as Error).message || '콘텐츠 목록을 불러오지 못했습니다.',
      },
    }, { status: 500, headers: readHeaders })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard (E2E-F F-2/F-3): refuse a non-member before the readiness gate,
  // otherwise SOHEE_NOT_READY would leak another workspace's unfinished items.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  // [P0-3] Production Execution Admission Guard
  const { requireSoheeReady, SoheeNotReadyError } = await import('@/features/sohee-ready/admission-guard')
  try {
    await requireSoheeReady(workspaceId, { action: 'CONTENT_CREATE' })
  } catch (guardErr: any) {
    if (guardErr instanceof SoheeNotReadyError || guardErr?.code === 'SOHEE_NOT_READY') {
      return NextResponse.json({
        success: false,
        error: {
          code: 'SOHEE_NOT_READY',
          message: guardErr.message,
          blockers: guardErr.snapshot?.blockers || [],
          membershipTier: guardErr.membershipTier,
          membershipNotice: guardErr.membershipNotice,
          notice: guardErr.notice,
        },
      }, { status: 403 })
    }
    throw guardErr
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { channel, title, caption, hashtags, mediaUrls, createdBy } = body

    if (!caption || typeof caption !== 'string') {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_CAPTION', message: '본문 내용(caption)이 필요합니다.' },
      }, { status: 400 })
    }

    const created = await CanonicalContentLifecycleService.createContent({
      workspaceId,
      channel: channel || 'instagram',
      title: title || caption.slice(0, 30),
      caption,
      hashtags: hashtags || [],
      mediaUrls: mediaUrls || [],
      createdBy,
    })

    return NextResponse.json({
      success: true,
      content: created,
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[Content API] POST error:', err)
    return NextResponse.json({
      success: false,
      error: {
        code: 'CREATE_CONTENT_FAILED',
        message: (err as Error).message || '콘텐츠 생성에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
