export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { SupabaseEngagementRepository } from '@/features/engagement/repository'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; commentId: string }> }
) {
  const { workspaceId, commentId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const repo = new SupabaseEngagementRepository(auth.admin)
    const comment = await repo.findCommentById(auth.workspaceId, commentId)
    if (!comment) {
      return NextResponse.json({ error: '댓글을 찾을 수 없습니다.' }, { status: 404, headers: NO_STORE })
    }

    await repo.updateCommentStatus(auth.workspaceId, commentId, 'DISMISSED')

    await repo.recordAudit({
      workspace_id: auth.workspaceId,
      comment_id: comment.id,
      channel: comment.channel,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'dismiss',
      policy_snapshot: null,
      provider_reply_id: null,
      readback_verified: false,
      details: {},
    })

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '댓글을 보관 처리하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
