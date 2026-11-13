export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createInstagramDmService } from '@/features/engagement/dm/compose'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const service = createInstagramDmService(auth.admin)
    const thread = await service.repo.findThreadById(auth.workspaceId, threadId)
    if (!thread) {
      return NextResponse.json(
        { error: '대화를 찾을 수 없습니다.' },
        { status: 404, headers: NO_STORE }
      )
    }

    await service.repo.updateThreadStatus(auth.workspaceId, thread.id, 'DISMISSED')

    await service.repo.recordAudit({
      workspace_id: auth.workspaceId,
      thread_id: thread.id,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'dismiss',
      provider_message_id: null,
      readback_verified: false,
      details: {},
    })

    return NextResponse.json({ ok: true, status: 'DISMISSED' }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '대화를 숨기지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
