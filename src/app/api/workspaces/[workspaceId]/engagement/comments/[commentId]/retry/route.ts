export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; commentId: string }> }
) {
  const { workspaceId, commentId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const admin = auth.admin

    // 1. Reset comment status to DRAFTED
    await admin
      .from('social_comments')
      .update({
        status: 'DRAFTED',
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', auth.workspaceId)
      .eq('id', commentId)

    // 2. Clear any pending/executing/unknown action requests for this comment so it can be retried cleanly
    await admin
      .from('external_action_requests')
      .delete()
      .eq('workspace_id', auth.workspaceId)
      .eq('action_kind', 'comment_reply')

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    console.error('[comments/retry] Failed:', err)
    return NextResponse.json({ error: err.message || '재시도 준비에 실패했습니다.' }, { status: 500, headers: NO_STORE })
  }
}
