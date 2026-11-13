export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createEngagementService } from '@/features/engagement/compose'
import { computeApprovalFingerprint } from '@/features/engagement/draft'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; commentId: string }> }
) {
  const { workspaceId, commentId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const service = createEngagementService(auth.admin)
    const comment = await service.repo.findCommentById(auth.workspaceId, commentId)
    if (!comment) {
      return NextResponse.json({ error: '댓글을 찾을 수 없습니다.' }, { status: 404, headers: NO_STORE })
    }

    if (comment.status === 'SENT') {
      return NextResponse.json({ error: '이미 답글이 등록된 댓글입니다.' }, { status: 409, headers: NO_STORE })
    }

    let draft = await service.repo.findDraftByCommentId(auth.workspaceId, comment.id)
    if (!draft || !draft.draft_text.trim()) {
      return NextResponse.json({ error: '발송할 답글 초안이 없습니다.' }, { status: 422, headers: NO_STORE })
    }

    // Bind the final decision to the exact server draft the user reviewed.
    const body = await request.json().catch(() => null)
    if (body?.expectedSourceFingerprint !== undefined
      && (typeof body.expectedSourceFingerprint !== 'string'
        || body.expectedSourceFingerprint !== computeApprovalFingerprint(auth.workspaceId, comment.id, comment.comment_text))) {
      return NextResponse.json({ ok: false, error: '댓글 원문이 바뀌었어요. 최신 문의와 답안을 다시 확인해 주세요.' }, { status: 409, headers: NO_STORE })
    }
    const fingerprint = computeApprovalFingerprint(auth.workspaceId, comment.id, draft.draft_text)
    if (typeof body?.expectedFingerprint !== 'string' || body.expectedFingerprint !== fingerprint) {
      return NextResponse.json({ ok: false, error: '답안이 바뀌었거나 최종 확인 정보가 없어요. 최신 답안을 다시 확인해 주세요.' }, { status: 409, headers: NO_STORE })
    }
    if (!draft.approved_fingerprint || draft.approved_fingerprint !== fingerprint) {
      draft = await service.repo.approveDraft(
        auth.workspaceId,
        comment.id,
        fingerprint,
        auth.userId,
        false
      )
    }

    const sendResult = await service.send(
      comment,
      {
        type: auth.role === 'owner' ? 'owner' : 'manager',
        userId: auth.userId,
        isAuto: false,
      },
      { expectedFingerprint: fingerprint }
    )

    if (!sendResult.sent) {
      return NextResponse.json(
        {
          ok: false,
          status: sendResult.status,
          error: sendResult.reason || '답글을 전송하지 못했습니다.',
        },
        { status: 422, headers: NO_STORE }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        status: sendResult.status,
        providerReplyId: sendResult.providerReplyId,
      },
      { status: 200, headers: NO_STORE }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '답글 전송 중 오류가 발생했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
