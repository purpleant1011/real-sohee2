export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createInstagramDmService } from '@/features/engagement/dm/compose'
import {
  computeDmApprovalFingerprint,
  sanitizeDmReplyText,
} from '@/features/engagement/dm/options-generator'

const NO_STORE = { 'Cache-Control': 'no-store' }

const editDraftSchema = z.object({
  draftText: z
    .string()
    .trim()
    .min(1, '답장 내용을 입력해 주세요.')
    .max(1000, '답장 내용은 1,000자 이하로 작성해 주세요.'),
})

const selectDraftSchema = z.object({
  optionId: z.string().trim().optional(),
  draftText: z.string().trim().max(1000).optional(),
})

export async function POST(
  request: Request,
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

    const body = await request.json().catch(() => ({}))
    const parsed = selectDraftSchema.safeParse(body)
    const optionId = parsed.success ? parsed.data.optionId : undefined
    const customText = parsed.success ? parsed.data.draftText : undefined

    const existingDraft = await service.repo.findDraftByThreadId(auth.workspaceId, thread.id)

    if (optionId && existingDraft) {
      // User selected a direction chip
      const matchedOption = existingDraft.options.find((opt) => opt.id === optionId)
      if (!matchedOption) {
        return NextResponse.json(
          { error: '선택한 안내 방향을 찾을 수 없습니다.' },
          { status: 404, headers: NO_STORE }
        )
      }

      const updatedDraft = await service.repo.saveDraft(
        auth.workspaceId,
        thread.id,
        existingDraft.options,
        matchedOption.id,
        matchedOption.draftText,
        null
      )

      const draftFingerprint = computeDmApprovalFingerprint(
        auth.workspaceId,
        thread.id,
        matchedOption.draftText
      )
      const draftLength = matchedOption.draftText.length

      await service.repo.recordAudit({
        workspace_id: auth.workspaceId,
        thread_id: thread.id,
        actor: auth.role === 'owner' ? 'owner' : 'manager',
        actor_user_id: auth.userId,
        action: 'select_option',
        provider_message_id: null,
        readback_verified: false,
        details: { optionId: matchedOption.id, draftFingerprint, draftLength },
      })

      return NextResponse.json({ ok: true, draft: updatedDraft }, { status: 200, headers: NO_STORE })
    }

    if (customText) {
      const sanitized = sanitizeDmReplyText(customText)
      const options = existingDraft ? existingDraft.options : []
      const updatedDraft = await service.repo.saveDraft(
        auth.workspaceId,
        thread.id,
        options,
        null,
        sanitized,
        null
      )
      return NextResponse.json({ ok: true, draft: updatedDraft }, { status: 200, headers: NO_STORE })
    }

    // Regenerate options
    const newOptions = await service.generateDraftOptions(auth.workspaceId, thread)
    const defaultOption = newOptions[0]
    const regeneratedDraft = await service.repo.saveDraft(
      auth.workspaceId,
      thread.id,
      newOptions,
      defaultOption.id,
      defaultOption.draftText,
      null
    )

    const draftFingerprint = computeDmApprovalFingerprint(
      auth.workspaceId,
      thread.id,
      defaultOption.draftText
    )
    const draftLength = defaultOption.draftText.length

    await service.repo.recordAudit({
      workspace_id: auth.workspaceId,
      thread_id: thread.id,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'generate_draft',
      provider_message_id: null,
      readback_verified: false,
      details: { draftFingerprint, draftLength, optionsCount: newOptions.length },
    })

    return NextResponse.json({ ok: true, draft: regeneratedDraft }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '답장 초안을 생성하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params
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

    const service = createInstagramDmService(auth.admin)
    const thread = await service.repo.findThreadById(auth.workspaceId, threadId)
    if (!thread) {
      return NextResponse.json(
        { error: '대화를 찾을 수 없습니다.' },
        { status: 404, headers: NO_STORE }
      )
    }

    const sanitized = sanitizeDmReplyText(parsed.data.draftText)
    const updatedDraft = await service.repo.updateDraft(
      auth.workspaceId,
      thread.id,
      sanitized,
      null
    )

    const draftFingerprint = computeDmApprovalFingerprint(
      auth.workspaceId,
      thread.id,
      updatedDraft.draft_text
    )
    const draftLength = updatedDraft.draft_text.length

    await service.repo.recordAudit({
      workspace_id: auth.workspaceId,
      thread_id: thread.id,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'edit_draft',
      provider_message_id: null,
      readback_verified: false,
      details: { draftFingerprint, draftLength },
    })

    return NextResponse.json({ ok: true, draft: updatedDraft }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '답장 문안을 수정하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
