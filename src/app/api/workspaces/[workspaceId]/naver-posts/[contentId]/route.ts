import { NextResponse } from 'next/server'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { type WorkspaceRole } from '@/features/auth/workspace-context'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string; contentId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request, { params }: Context) {
  try {
    const { workspaceId, contentId } = await params
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) {
      return auth
    }

    const preview = await getApprovalPreview(workspaceId, contentId)
    if (preview.error) {
      return NextResponse.json({ error: preview.error.message }, { status: 400, headers: noStore })
    }

    const supabase = await createServerSupabaseClient()
    const { data: scheduleResult } = await supabase
      .from('schedules')
      .select('id, version_id, publish_at, status')
      .eq('workspace_id', workspaceId)
      .eq('content_id', contentId)
      .eq('version_id', preview.data.versionId)
      .order('created_at', { ascending: false })
      .limit(1)

    const latestSchedule = scheduleResult?.[0]
    let receipt: any = null
    if (latestSchedule) {
      receipt = {
        next: latestSchedule.status,
        scheduleId: latestSchedule.id,
        attemptId: null,
        providerPostId: null,
        destinationUrl: null,
        publishAt: latestSchedule.publish_at,
      }
    }

    return NextResponse.json({
      data: {
        role: (auth.role as WorkspaceRole) ?? 'manager',
        preview: preview.data,
        receipt,
      },
    }, { headers: noStore })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '게시물을 불러오지 못했습니다.' }, { status: 500, headers: noStore })
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) {
      return auth
    }

    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 발행 디스패치 즉시 차단
    return naverAutomationBlocked('publish')
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '게시 요청을 처리하지 못했습니다.' }, { status: 500, headers: noStore })
  }
}
