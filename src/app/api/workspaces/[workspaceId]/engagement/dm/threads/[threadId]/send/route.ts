export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createInstagramDmService } from '@/features/engagement/dm/compose'
import {
  checkIsDmExpired,
  computeDmApprovalFingerprint,
  DM_EXPIRED_KOREAN_MESSAGE,
} from '@/features/engagement/dm/options-generator'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const body = await request.json().catch(() => null)
    const expectedFingerprint = body?.expectedFingerprint || body?.fingerprint
    const expectedSourceMessageId = body?.expectedSourceMessageId || body?.sourceMessageId

    const service = createInstagramDmService(auth.admin)
    const thread = await service.repo.findThreadById(auth.workspaceId, threadId)
    if (!thread) {
      return NextResponse.json(
        { error: '대화를 찾을 수 없습니다.' },
        { status: 404, headers: NO_STORE }
      )
    }

    // Query latest customer message in this thread to detect stale context
    const { data: latestCustomerMsg } = await (auth.admin as any)
      .from('instagram_dm_messages')
      .select('id, sent_at')
      .eq('workspace_id', auth.workspaceId)
      .eq('thread_id', thread.id)
      .eq('sender_type', 'customer')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Stale source detection: prevent approval if a new customer message arrived after owner reviewed
    if (latestCustomerMsg) {
      if (!expectedSourceMessageId) {
        return NextResponse.json(
          {
            ok: false,
            status: thread.status,
            error: '확인된 고객 메시지 기준 정보가 없습니다. 새로고침 후 다시 시도해 주세요.',
          },
          { status: 409, headers: NO_STORE }
        )
      }

      if (expectedSourceMessageId !== latestCustomerMsg.id) {
        return NextResponse.json(
          {
            ok: false,
            status: thread.status,
            error: '고객의 새로운 메시지가 도착했습니다. 최신 대화를 확인 후 다시 승인해 주세요.',
          },
          { status: 409, headers: NO_STORE }
        )
      }
    }

    // 24-hour policy window check
    if (checkIsDmExpired(thread.expires_at)) {
      await service.repo.updateThreadStatus(auth.workspaceId, thread.id, 'EXPIRED').catch(() => {})
      return NextResponse.json(
        {
          ok: false,
          status: 'EXPIRED',
          error: DM_EXPIRED_KOREAN_MESSAGE,
        },
        { status: 422, headers: NO_STORE }
      )
    }

    if (thread.status === 'SENT') {
      return NextResponse.json(
        {
          ok: false,
          status: 'SENT',
          error: '이미 답장을 보낸 대화입니다.',
        },
        { status: 409, headers: NO_STORE }
      )
    }

    let draft = await service.repo.findDraftByThreadId(auth.workspaceId, thread.id)
    if (!draft || !draft.draft_text.trim()) {
      return NextResponse.json(
        { error: '발송할 답장 초안이 없습니다.' },
        { status: 422, headers: NO_STORE }
      )
    }

    const currentFingerprint = computeDmApprovalFingerprint(auth.workspaceId, thread.id, draft.draft_text)

    // Check version fingerprint mismatch - never silently auto-approve mismatched content
    if (expectedFingerprint && expectedFingerprint !== currentFingerprint) {
      return NextResponse.json(
        {
          ok: false,
          status: thread.status,
          error: '승인된 문안과 현재 초안이 일치하지 않습니다. 다시 확인해 주세요.',
        },
        { status: 409, headers: NO_STORE }
      )
    }

    if (!draft.approved_fingerprint || draft.approved_fingerprint !== currentFingerprint) {
      if (expectedFingerprint === currentFingerprint) {
        draft = await service.repo.approveDraft(
          auth.workspaceId,
          thread.id,
          currentFingerprint,
          auth.userId
        )
      } else {
        return NextResponse.json(
          {
            ok: false,
            status: thread.status,
            error: '승인되지 않은 답장 문안입니다. 승인 후 다시 발송해 주세요.',
          },
          { status: 422, headers: NO_STORE }
        )
      }
    }

    const sendResult = await service.send(
      thread,
      {
        type: auth.role === 'owner' ? 'owner' : 'manager',
        userId: auth.userId,
      },
      { expectedFingerprint: currentFingerprint, expectedSourceMessageId }
    )

    // 외부 전송과 로컬 정산이 어긋난 경우: 성공(200)으로 응답하지 않는다.
    // 재발송을 유도하지 않도록 NEEDS_CHECK 상태와 대사 필요 여부를 함께 내려준다.
    // PERSISTENCE_FAILED는 격리 상태 자체를 저장하지 못한 경우이므로 별도로 알린다.
    if (sendResult.localOutcome === 'RECONCILIATION_REQUIRED' || sendResult.localOutcome === 'PERSISTENCE_FAILED') {
      return NextResponse.json(
        {
          ok: false,
          status: 'NEEDS_CHECK',
          reconciliationRequired: true,
          persistenceFailed: sendResult.localOutcome === 'PERSISTENCE_FAILED',
          deliveryVerified: sendResult.providerOutcome === 'READBACK_VERIFIED',
          providerMessageId: sendResult.providerMessageId,
          error: sendResult.reason || '전송 결과 확인이 필요합니다. 다시 보내지 마세요.',
        },
        { status: 422, headers: NO_STORE }
      )
    }

    if (!sendResult.sent) {
      return NextResponse.json(
        {
          ok: false,
          status: sendResult.status,
          error: sendResult.reason || '메시지를 전송하지 못했습니다.',
        },
        { status: 422, headers: NO_STORE }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        status: sendResult.status,
        providerMessageId: sendResult.providerMessageId,
      },
      { status: 200, headers: NO_STORE }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '메시지를 전송하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
