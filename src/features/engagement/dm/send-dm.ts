import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate'
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import {
  sendInstagramDirectMessage,
  getInstagramDirectMessageReadback,
  type MetaFetch,
} from '@/lib/providers/meta-api'
import { isEngagementWorkspaceAllowed } from '../engagement-allowlist'
import {
  checkIsDmExpired,
  computeDmApprovalFingerprint,
  DM_EXPIRED_KOREAN_MESSAGE,
} from './options-generator'
import type { InstagramDmRepository } from './repository'
import type {
  InstagramDmSendResult,
  InstagramDmThread,
  DmProviderOutcome,
  DmLocalOutcome,
} from './types'

export interface SendInstagramDmDependencies {
  repo: InstagramDmRepository
  getChannelCredential: (
    workspaceId: string,
    channelConnectionId: string,
    channel: 'instagram'
  ) => Promise<{
    accessToken: string
    externalAccountId?: string
    grantedScopes?: readonly string[]
  }>
  fetcher?: MetaFetch
  adminClient?: any
}

export interface SendDmActor {
  type: 'owner' | 'manager' | 'system'
  userId?: string
}

export interface SendInstagramDmOptions {
  expectedSourceMessageId?: string
  expectedFingerprint?: string
}

/**
 * Durably parks the thread in NEEDS_CHECK so it cannot be re-sent from the UI.
 * Returns false when the write itself failed — callers must not report a quarantine that
 * only exists in the HTTP response.
 */
async function persistQuarantine(
  repo: InstagramDmRepository,
  workspaceId: string,
  threadId: string
): Promise<boolean> {
  try {
    await repo.updateThreadStatus(workspaceId, threadId, 'NEEDS_CHECK')
    return true
  } catch (err) {
    console.error('[sendInstagramDm] Failed to persist NEEDS_CHECK quarantine:', err)
    return false
  }
}

export async function sendInstagramDm(
  thread: InstagramDmThread,
  actor: SendDmActor,
  deps: SendInstagramDmDependencies,
  options?: SendInstagramDmOptions
): Promise<InstagramDmSendResult> {
  const { repo, getChannelCredential, fetcher, adminClient } = deps
  const workspaceId = thread.workspace_id

  // Guardrail 1: Real sends ONLY if ENGAGEMENT_SEND_ENABLED === '1' and workspace is allowed (read at call time)
  if (process.env.ENGAGEMENT_SEND_ENABLED !== '1') {
    return {
      sent: false,
      status: thread.status,
      reason: '외부 메시지 실발송 기능이 현재 비활성화되어 있습니다.',
    }
  }
  if (!isEngagementWorkspaceAllowed(workspaceId)) {
    return {
      sent: false,
      status: thread.status,
      reason: '이 워크스페이스에서는 아직 소통함 발송을 열지 않았어요.',
    }
  }

  // Guardrail 2: Hard Invariant 2 (24-Hour Policy Window)
  if (checkIsDmExpired(thread.expires_at)) {
    if (thread.status !== 'EXPIRED') {
      await repo.updateThreadStatus(workspaceId, thread.id, 'EXPIRED').catch(() => {})
    }
    return {
      sent: false,
      status: 'EXPIRED',
      reason: DM_EXPIRED_KOREAN_MESSAGE,
    }
  }

  // Guardrail 3: Never double-reply per customer message sequence
  if (thread.status === 'SENT') {
    return {
      sent: false,
      status: 'SENT',
      reason: '이미 답장을 보낸 대화입니다.',
    }
  }

  // Guardrail 3b: 대사 확인이 필요한 대화는 새 외부 쓰기를 시작하지 않는다.
  // NEEDS_CHECK는 이전 시도의 도달 여부가 불확실하다는 뜻이므로, 다시 POST하면 중복 발송이 된다.
  if (thread.status !== 'NEEDS_REPLY') {
    return {
      sent: false,
      status: thread.status,
      providerOutcome: 'NOT_ATTEMPTED',
      localOutcome: 'NOT_STARTED',
      reason: thread.status === 'NEEDS_CHECK'
        ? '대사 확인이 필요한 대화입니다. 중복 발송을 방지하기 위해 새로운 전송을 차단합니다.'
        : `답장을 보낼 수 없는 대화 상태(${thread.status})입니다.`,
    }
  }

  // Guardrail 4: Verify draft exists
  const draft = await repo.findDraftByThreadId(workspaceId, thread.id)
  if (!draft || !draft.draft_text.trim()) {
    return {
      sent: false,
      status: thread.status,
      reason: '발송할 답장 문안이 없습니다.',
    }
  }

  // Guardrail 5: Approval binding (Hard Invariant 3 & 4) & Source Message Freshness
  if (options?.expectedSourceMessageId) {
    const messages = await repo.listMessages(workspaceId, thread.id)
    const customerMessages = messages.filter((m) => m.sender_type === 'customer')
    const latestCustomerMsg = customerMessages[customerMessages.length - 1]
    if (!latestCustomerMsg || latestCustomerMsg.id !== options.expectedSourceMessageId) {
      return {
        sent: false,
        status: thread.status,
        reason: '새로운 고객 메시지가 수신되어 승인이 만료되었습니다. 대화를 다시 확인해 주세요.',
      }
    }
  }

  // sha256(workspaceId:threadId:finalDraftText)
  const expectedFingerprint = computeDmApprovalFingerprint(workspaceId, thread.id, draft.draft_text)
  if (!draft.approved_fingerprint || draft.approved_fingerprint !== expectedFingerprint) {
    return {
      sent: false,
      status: thread.status,
      reason: '승인된 문안과 현재 문안이 일치하지 않습니다. 다시 승인해 주세요.',
    }
  }

  if (options?.expectedFingerprint && options.expectedFingerprint !== draft.approved_fingerprint) {
    return {
      sent: false,
      status: thread.status,
      reason: '승인된 문안과 현재 문안이 일치하지 않습니다. 다시 승인해 주세요.',
    }
  }

  // Guardrail 5.1: Channel Learning Post-Draft Gate (ANI-2191)
  if (process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1' && adminClient) {
    try {
      const { data: sources, error: srcErr } = await adminClient
        .from('knowledge_sources')
        .select('id, lifecycle_revision')
        .eq('workspace_id', workspaceId)
        .eq('is_learning_source', true)
        .is('deleted_at', null)

      if (srcErr) {
        return {
          sent: false,
          status: thread.status,
          reason: '채널 지식 검증 중 오류가 발생하여 안전을 위해 발송을 일시 차단했습니다.',
        }
      }

      if (Array.isArray(sources) && sources.length > 0) {
        const { createSupabaseConsumerGate, validateLearningResult } = await import('@/features/channel-learning/consumer-gate')
        const gate = createSupabaseConsumerGate(adminClient, 'content')
        const dependencies = sources.map((s: any) => ({
          workspaceId,
          sourceId: s.id,
          revision: Number(s.lifecycle_revision ?? 1),
        }))

        const { data: epochData } = await adminClient
          .from('workspace_knowledge_epochs')
          .select('epoch')
          .eq('workspace_id', workspaceId)
          .maybeSingle()

        const currentEpoch = Number(epochData?.epoch ?? 1)
        const isValid = await validateLearningResult(
          {
            workspaceId,
            epoch: currentEpoch,
            dependencies,
            purpose: 'content',
          },
          gate
        )

        if (!isValid) {
          return {
            sent: false,
            status: thread.status,
            reason: '매장 공식 채널 정보가 변경/철회되어 답장을 전송할 수 없습니다. 답장을 다시 생성해 주세요.',
          }
        }
      }
    } catch (gateErr) {
      console.error('[sendInstagramDm] Channel learning gate validation failed:', gateErr)
      return {
        sent: false,
        status: thread.status,
        reason: '채널 지식 검증 중 오류가 발생하여 안전을 위해 발송을 일시 차단했습니다.',
      }
    }
  }

  // Guardrail 6: Kill switch check
  const killCheck = await checkKillSwitchPreflight(adminClient ?? (repo as any).client, {
    workspaceId,
    channel: 'INSTAGRAM',
    provider: 'META',
  })
  if (killCheck.blocked) {
    return {
      sent: false,
      status: thread.status,
      reason: killCheck.reason || '긴급 킬스위치가 활성화되어 있어 메시지를 전송할 수 없습니다.',
    }
  }

  // Guardrail 7: Load credential & verify required scopes
  let cred: { accessToken: string; externalAccountId?: string; grantedScopes?: readonly string[] }
  try {
    cred = await getChannelCredential(workspaceId, thread.channel_connection_id, 'instagram')
  } catch {
    return {
      sent: false,
      status: thread.status,
      reason: '채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.',
    }
  }

  const normalizedScopes = normalizeChannelScopes('instagram', cred.grantedScopes || [])
  if (!normalizedScopes.includes('instagram_manage_messages')) {
    return {
      sent: false,
      status: thread.status,
      reason: '채널 연동에 필요한 메시지 관리 권한이 부여되지 않았습니다.',
    }
  }

  // Guardrail 8: Execution Admission Gate evaluation
  const admission = await ExecutionAdmissionGate.evaluate({
    workspaceId,
    channel: 'instagram',
    actionKind: 'dm_reply',
    actorUserId: actor.userId,
    isAutonomousExecution: false,
  })

  if (!admission.admitted) {
    return {
      sent: false,
      status: thread.status,
      reason: admission.message,
    }
  }

  // Guardrail 9: Canonical Action Ledger & Idempotency
  const idempotencyKey = options?.expectedSourceMessageId
    ? `dm:${workspaceId}:instagram:${thread.provider_thread_id}:${options.expectedSourceMessageId}`
    : `dm:${workspaceId}:instagram:${thread.provider_thread_id}`
  let actionReq: any = null
  let attempt: any = null

  try {
    actionReq = await CanonicalActionLedgerService.createActionRequest({
      workspaceId,
      channel: 'instagram',
      actionKind: 'dm_reply',
      targetExternalId: thread.customer_id,
      targetLabel: `@${thread.customer_handle}`,
      exactPayload: { text: draft.draft_text },
      approvalFingerprint: draft.approved_fingerprint,
      idempotencyKey,
      createdBy: actor.userId || '00000000-0000-0000-0000-000000000000',
      adminClient,
    })

    if (actionReq.isExisting && actionReq.status === 'succeeded') {
      const quarantined = await persistQuarantine(repo, workspaceId, thread.id)
      const localOutcome: DmLocalOutcome = quarantined ? 'RECONCILIATION_REQUIRED' : 'PERSISTENCE_FAILED'
      const persistenceNote = quarantined
        ? ''
        : ' 대화 상태를 확인 필요로 저장하지 못했습니다. Instagram 앱에서 직접 확인하고 재발송하지 마세요.'

      if (!actionReq.providerReference) {
        return {
          sent: false,
          status: 'NEEDS_CHECK',
          providerOutcome: 'DELIVERY_UNKNOWN',
          localOutcome,
          actionRequestId: actionReq.requestId,
          reason: `기존 요청이 완료 상태이나 전송 증거(참조번호)가 없습니다. 대사 확인이 필요합니다.${persistenceNote}`,
        }
      }

      // 이전 요청의 참조번호만으로는 이번 호출의 전송을 확인할 수 없다.
      // 중복 POST를 막되, 독립 readback 없이 SENT로 단정하지 않는다.
      return {
        sent: false,
        status: 'NEEDS_CHECK',
        providerMessageId: actionReq.providerReference,
        providerOutcome: 'ACCEPTED_BUT_UNVERIFIED',
        localOutcome,
        actionRequestId: actionReq.requestId,
        reason: `이전 전송 요청이 접수되어 있으나 전송 확인(읽기 검증)이 완료되지 않았습니다. 다시 보내지 말고 대사 확인이 필요합니다.${persistenceNote}`,
      }
    }

    if (actionReq.isExisting) {
      const quarantined = await persistQuarantine(repo, workspaceId, thread.id)
      return {
        sent: false,
        status: 'NEEDS_CHECK',
        providerOutcome: 'DELIVERY_UNKNOWN',
        localOutcome: quarantined ? 'RECONCILIATION_REQUIRED' : 'PERSISTENCE_FAILED',
        actionRequestId: actionReq.requestId,
        reason: '답장이 보내졌는지 확인해 주세요',
      }
    }

    attempt = await CanonicalActionLedgerService.startAttempt({
      workspaceId,
      actionRequestId: actionReq.requestId,
      attemptNumber: 1,
      createdBy: actor.userId || '00000000-0000-0000-0000-000000000000',
      adminClient,
    })
  } catch (err) {
    console.error('[sendInstagramDm] Failed to initialize action ledger:', err)
    return {
      sent: false,
      status: thread.status,
      reason: '메시지 발송 준비 중 오류가 발생했습니다.',
    }
  }

  // Guardrail 10: Provider Send
  let providerMessageId: string | null = null
  try {
    const res = await sendInstagramDirectMessage({
      pageId: cred.externalAccountId || '',
      recipientId: thread.customer_id,
      accessToken: cred.accessToken,
      text: draft.draft_text,
      fetcher,
    })
    providerMessageId = res.providerMessageId
  } catch (providerErr: any) {
    console.error('[sendInstagramDm] Provider call failed or uncertain:', providerErr)
    // Unknown/error provider outcome moves state to NEEDS_CHECK with NO auto-retry
    const quarantined = await persistQuarantine(repo, workspaceId, thread.id)
    if (actionReq?.requestId) {
      try {
        await CanonicalActionLedgerService.markUnknownResult({
          workspaceId,
          actionRequestId: actionReq.requestId,
          attemptId: attempt?.attemptId,
          reason: String(providerErr?.message || providerErr),
          adminClient,
        })
      } catch {}
    }
    return {
      sent: false,
      status: 'NEEDS_CHECK',
      providerOutcome: 'DELIVERY_UNKNOWN',
      localOutcome: quarantined ? 'RECONCILIATION_REQUIRED' : 'PERSISTENCE_FAILED',
      actionRequestId: actionReq?.requestId,
      attemptId: attempt?.attemptId,
      reason: quarantined
        ? '답장이 보내졌는지 확인해 주세요'
        : '답장 전송 여부를 확인하지 못했고, 대화 상태도 저장하지 못했습니다. Instagram 앱에서 직접 확인하고 재발송하지 마세요.',
    }
  }

  if (!providerMessageId) {
    const quarantined = await persistQuarantine(repo, workspaceId, thread.id)
    return {
      sent: false,
      status: 'NEEDS_CHECK',
      providerOutcome: 'DELIVERY_UNKNOWN',
      localOutcome: quarantined ? 'RECONCILIATION_REQUIRED' : 'PERSISTENCE_FAILED',
      actionRequestId: actionReq?.requestId,
      attemptId: attempt?.attemptId,
      reason: '답장이 보내졌는지 확인해 주세요',
    }
  }

  // Guardrail 11: Independent Readback Verification (Hard Invariant 5)
  let isLive = false
  try {
    const readback = await getInstagramDirectMessageReadback({
      messageId: providerMessageId,
      accessToken: cred.accessToken,
      fetcher,
    })
    isLive = readback.isLive
  } catch (readbackErr) {
    console.error('[sendInstagramDm] Readback error:', readbackErr)
    isLive = false
  }

  if (!isLive) {
    // Readback failed/uncertain -> state NEEDS_CHECK, NEVER auto-retried
    const quarantined = await persistQuarantine(repo, workspaceId, thread.id)
    if (actionReq?.requestId) {
      try {
        await CanonicalActionLedgerService.markUnknownResult({
          workspaceId,
          actionRequestId: actionReq.requestId,
          attemptId: attempt?.attemptId,
          reason: 'Readback GET verification failed',
          adminClient,
        })
      } catch {}
    }
    return {
      sent: false,
      status: 'NEEDS_CHECK',
      providerMessageId,
      providerOutcome: 'ACCEPTED_BUT_UNVERIFIED',
      localOutcome: quarantined ? 'RECONCILIATION_REQUIRED' : 'PERSISTENCE_FAILED',
      actionRequestId: actionReq?.requestId,
      attemptId: attempt?.attemptId,
      reason: quarantined
        ? '답장이 보내졌는지 확인해 주세요'
        : '답장이 보내졌는지 확인하지 못했고, 대화 상태도 저장하지 못했습니다. Instagram 앱에서 직접 확인하고 재발송하지 마세요.',
    }
  }

  // Guardrail 12: 외부 전송(readback 검증됨)과 로컬 기록을 분리해서 정산한다.
  const providerOutcome: DmProviderOutcome = 'READBACK_VERIFIED'
  let localOutcome: DmLocalOutcome = 'RECORDED'
  let finalizeFailureReason: string | undefined

  // Step 1: Bind receipt to action ledger first (binds providerReference to attempt & request)
  try {
    await CanonicalActionLedgerService.recordReceiptAndVerify({
      workspaceId,
      actionRequestId: actionReq.requestId,
      attemptId: attempt.attemptId,
      providerReference: providerMessageId,
      resultUrl: 'https://instagram.com/direct',
      observedPayload: {
        providerMessageId,
        readbackVerified: true,
        channel: 'instagram',
      },
      recordedBy: actor.userId,
      adminClient,
    })
  } catch (ledgerErr: any) {
    console.error('[sendInstagramDm] Failed to record receipt in action ledger:', ledgerErr)
    localOutcome = 'RECONCILIATION_REQUIRED'
    finalizeFailureReason = '전송 증거(원장) 저장 실패'
  }

  // Step 2: Record audit log.
  // recordAudit reports failure through its return value (other routes must not 500 after
  // their primary mutation committed), so both the flag and a thrown error are handled here.
  try {
    const auditResult = await repo.recordAudit({
      workspace_id: workspaceId,
      thread_id: thread.id,
      actor: actor.type,
      actor_user_id: actor.userId ?? null,
      action: 'manual_send',
      provider_message_id: providerMessageId,
      readback_verified: true,
      details: {
        draftFingerprint: draft.approved_fingerprint ?? null,
        draftLength: draft.draft_text.length,
      },
    })
    if (auditResult?.recorded === false) {
      console.error('[sendInstagramDm] Audit log was not recorded')
      localOutcome = 'RECONCILIATION_REQUIRED'
      finalizeFailureReason = finalizeFailureReason || '감사 로그 저장 실패'
    }
  } catch (auditErr: any) {
    console.error('[sendInstagramDm] Failed to record audit log:', auditErr)
    localOutcome = 'RECONCILIATION_REQUIRED'
    finalizeFailureReason = finalizeFailureReason || '감사 로그 저장 실패'
  }

  // Step 3: Insert message row (idempotent)
  try {
    await repo.insertMessageIfAbsent({
      workspace_id: workspaceId,
      thread_id: thread.id,
      provider_message_id: providerMessageId,
      sender_type: 'business',
      sender_id: cred.externalAccountId || 'business',
      text: draft.draft_text,
      sent_at: new Date().toISOString(),
    })
  } catch (msgErr: any) {
    console.error('[sendInstagramDm] Failed to insert message row:', msgErr)
    localOutcome = 'RECONCILIATION_REQUIRED'
    finalizeFailureReason = finalizeFailureReason || '메시지 내역 저장 실패'
  }

  // Step 4: Synchronize DB thread status with true local outcome.
  // Any persistence failure must leave the thread in NEEDS_CHECK, never SENT.
  if (localOutcome === 'RECORDED') {
    try {
      await repo.updateThreadStatus(workspaceId, thread.id, 'SENT')
    } catch (statusErr: any) {
      console.error('[sendInstagramDm] Failed to update thread status to SENT:', statusErr)
      localOutcome = 'RECONCILIATION_REQUIRED'
      finalizeFailureReason = '대화 상태 SENT 갱신 실패'
      await repo.updateThreadStatus(workspaceId, thread.id, 'NEEDS_CHECK').catch(() => {})
    }
  } else {
    await repo.updateThreadStatus(workspaceId, thread.id, 'NEEDS_CHECK').catch(() => {})
  }

  if (localOutcome === 'RECONCILIATION_REQUIRED') {
    return {
      sent: true, // 외부 전송은 readback으로 확인됐다. 숨기지 않되, 로컬 정산 실패를 명시한다.
      status: 'NEEDS_CHECK',
      providerMessageId,
      providerOutcome,
      localOutcome,
      actionRequestId: actionReq.requestId,
      attemptId: attempt.attemptId,
      reason: `인스타그램에 답장이 정상 전송되었으나, 로컬 저장소 정산에 실패했습니다 (${finalizeFailureReason}). 대사 확인이 필요합니다.`,
    }
  }

  return {
    sent: true,
    status: 'SENT',
    providerMessageId,
    providerOutcome,
    localOutcome,
    actionRequestId: actionReq.requestId,
    attemptId: attempt.attemptId,
  }
}
