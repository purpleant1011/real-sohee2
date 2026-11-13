export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createEngagementService } from '@/features/engagement/compose'
import { computeApprovalFingerprint } from '@/features/engagement/draft'

const NO_STORE = { 'Cache-Control': 'no-store' }

const editDraftSchema = z.object({
  draftText: z.string().trim().min(1, '답글 내용을 입력해 주세요.').max(2200, '답글 내용은 2,200자 이하로 작성해 주세요.'),
})

export async function POST(
  _request: Request,
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

    const draftResult = await service.draft({
      workspaceId: auth.workspaceId,
      commentId: comment.id,
      commentText: comment.comment_text,
      channel: comment.channel,
      authorHandle: comment.author_handle,
    })

    const draft = await service.repo.saveDraft(
      auth.workspaceId,
      comment.id,
      draftResult.draftText,
      draftResult.fingerprint
    )

    const draftFingerprint = draft.approved_fingerprint ?? computeApprovalFingerprint(auth.workspaceId, comment.id, draft.draft_text)
    const draftLength = draft.draft_text.length

    await service.repo.recordAudit({
      workspace_id: auth.workspaceId,
      comment_id: comment.id,
      channel: comment.channel,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'regenerate_draft',
      policy_snapshot: null,
      provider_reply_id: null,
      readback_verified: false,
      details: { draftFingerprint, draftLength },
    })

    return NextResponse.json({ ok: true, draft }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '답글 초안을 다시 생성하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; commentId: string }> }
) {
  const { workspaceId, commentId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const body = await request.json().catch(() => null)
    const parsed = editDraftSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '올바른 문안을 입력해 주세요.' },
        { status: 422, headers: NO_STORE }
      )
    }

    const service = createEngagementService(auth.admin)
    const comment = await service.repo.findCommentById(auth.workspaceId, commentId)
    if (!comment) {
      return NextResponse.json({ error: '댓글을 찾을 수 없습니다.' }, { status: 404, headers: NO_STORE })
    }

    const updatedDraft = await service.repo.updateDraft(
      auth.workspaceId,
      comment.id,
      parsed.data.draftText
    )

    const draftFingerprint = computeApprovalFingerprint(auth.workspaceId, comment.id, updatedDraft.draft_text)
    const draftLength = updatedDraft.draft_text.length

    await service.repo.recordAudit({
      workspace_id: auth.workspaceId,
      comment_id: comment.id,
      channel: comment.channel,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'edit_draft',
      policy_snapshot: null,
      provider_reply_id: null,
      readback_verified: false,
      details: { draftFingerprint, draftLength },
    })

    return NextResponse.json({ ok: true, draft: { ...updatedDraft, fingerprint: draftFingerprint } }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '답글 문안을 수정하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
