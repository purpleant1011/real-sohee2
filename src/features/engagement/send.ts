import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate'
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import {
  createInstagramProvider,
  createThreadsProvider,
  getInstagramCommentReplyReadback,
  getThreadsReplyReadback,
  type MetaFetch,
} from '@/lib/providers/meta-api'
import { isEngagementWorkspaceAllowed } from './engagement-allowlist'
import { computeApprovalFingerprint } from './draft'
import { isSelfComment } from './ingest'
import type { EngagementRepository } from './repository'
import type { SendReplyResult, SocialComment } from './types'

export interface SendCommentReplyDependencies {
  repo: EngagementRepository
  getChannelCredential: (workspaceId: string, channelConnectionId: string, channel: 'instagram' | 'threads') => Promise<{
    accessToken: string
    externalAccountId?: string
    grantedScopes?: readonly string[]
    accountHandle?: string
    accountUsername?: string
  }>
  fetcher?: MetaFetch
  adminClient?: any
}

export interface SendActor {
  type: 'system' | 'owner' | 'manager'
  userId?: string
  isAuto?: boolean
}

export async function sendCommentReply(
  comment: SocialComment,
  actor: SendActor,
  deps: SendCommentReplyDependencies,
  options: { expectedFingerprint?: string } = {}
): Promise<SendReplyResult> {
  const { repo, getChannelCredential, fetcher, adminClient } = deps
  const workspaceId = comment.workspace_id

  // Invariant 1: Real sends ONLY if ENGAGEMENT_SEND_ENABLED === '1' and workspace is allowed (read at call time)
  if (process.env.ENGAGEMENT_SEND_ENABLED !== '1') {
    return {
      sent: false,
      status: comment.status,
      reason: '외부 답글 실발송 기능이 현재 비활성화되어 있습니다.',
    }
  }
  if (!isEngagementWorkspaceAllowed(workspaceId)) {
    return {
      sent: false,
      status: comment.status,
      reason: '이 워크스페이스에서는 아직 소통함 발송을 열지 않았어요.',
    }
  }

  // Invariant 3: Never double-reply
  if (comment.status === 'SENT') {
    return {
      sent: false,
      status: 'SENT',
      reason: '이미 답글이 등록된 댓글입니다.',
    }
  }

  // 1. Verify draft exists
  const draft = await repo.findDraftByCommentId(workspaceId, comment.id)
  if (!draft || !draft.draft_text.trim()) {
    return {
      sent: false,
      status: comment.status,
      reason: '발송할 답글 문안이 없습니다.',
    }
  }

  // Invariant 2: Approval binding
  // Send only from a draft whose approved_fingerprint matches the current body; any edit after approval invalidates approval.
  const expectedFingerprint = computeApprovalFingerprint(workspaceId, comment.id, draft.draft_text)
  if (options.expectedFingerprint && options.expectedFingerprint !== expectedFingerprint) {
    return { sent: false, status: comment.status, reason: '최종 확인한 답안과 현재 답안이 달라 전송하지 않았어요.' }
  }
  if (!draft.approved_fingerprint || draft.approved_fingerprint !== expectedFingerprint) {
    return {
      sent: false,
      status: comment.status,
      reason: '승인된 문안과 현재 문안이 일치하지 않습니다. 다시 승인해 주세요.',
    }
  }

  // 2. Channel Learning Post-Draft Gate (ANI-2204)
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
          status: comment.status,
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
            status: comment.status,
            reason: '매장 공식 채널 정보가 변경/철회되어 답글을 전송할 수 없습니다. 답글을 다시 생성해 주세요.',
          }
        }
      }
    } catch (gateErr) {
      console.error('[sendCommentReply] Channel learning gate validation failed:', gateErr)
      return {
        sent: false,
        status: comment.status,
        reason: '채널 지식 검증 중 오류가 발생하여 안전을 위해 발송을 일시 차단했습니다.',
      }
    }
  }

  // 3. Kill switch check
  const killCheck = await checkKillSwitchPreflight(adminClient ?? (repo as any).client, {
    workspaceId,
    channel: comment.channel.toUpperCase(),
    provider: 'META',
  })
  if (killCheck.blocked) {
    return {
      sent: false,
      status: comment.status,
      reason: killCheck.reason || '긴급 킬스위치가 활성화되어 있어 답글을 전송할 수 없습니다.',
    }
  }

  // 3. Load credential & verify required scopes
  let cred: {
    accessToken: string
    externalAccountId?: string
    grantedScopes?: readonly string[]
    accountHandle?: string
    accountUsername?: string
  }
  try {
    cred = await getChannelCredential(workspaceId, comment.channel_connection_id, comment.channel)
  } catch {
    return {
      sent: false,
      status: comment.status,
      reason: '채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.',
    }
  }

  const normalizedScopes = normalizeChannelScopes(comment.channel, cred.grantedScopes || [])
  const requiredScope = comment.channel === 'instagram'
    ? 'instagram_manage_comments'
    : 'threads_manage_replies'

  if (!normalizedScopes.includes(requiredScope)) {
    return {
      sent: false,
      status: comment.status,
      reason: '채널 연동에 필요한 댓글 관리 권한이 부여되지 않았습니다.',
    }
  }

  // 3b. Self-comment guard: never send a reply to a comment authored by the business account itself
  let connectionAccountLabel: string | undefined
  let connectionAccountUsername: string | undefined
  if (adminClient && comment.channel_connection_id) {
    try {
      const { data: conn, error: connErr } = await adminClient
        .from('channel_connections')
        .select('account_label, profile_metadata')
        .eq('workspace_id', workspaceId)
        .eq('id', comment.channel_connection_id)
        .maybeSingle()
      if (connErr || !conn) {
        return {
          sent: false,
          status: comment.status,
          reason: '채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.',
        }
      }
      if (conn.account_label) {
        connectionAccountLabel = conn.account_label
      }
      const profileUsername = typeof conn.profile_metadata === 'object' && conn.profile_metadata !== null
        ? (conn.profile_metadata as Record<string, unknown>).username
        : undefined
      if (typeof profileUsername === 'string' && profileUsername.trim()) {
        connectionAccountUsername = profileUsername.trim()
      }
    } catch {
      return {
        sent: false,
        status: comment.status,
        reason: '채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.',
      }
    }
  }

  const selfAccountId = cred.externalAccountId
  const selfAccountHandle = connectionAccountLabel || cred.accountHandle
  const selfAccountUsername = connectionAccountUsername || cred.accountUsername

  const cleanAuthorId = comment.author_id?.trim() || ''
  const cleanAuthorHandle = comment.author_handle?.trim() || ''
  const cleanSelfAccountId = selfAccountId?.trim() || ''
  const cleanSelfAccountHandle = selfAccountHandle?.trim() || ''
  const cleanSelfAccountUsername = selfAccountUsername?.trim() || ''

  const hasIdPair = Boolean(cleanAuthorId && cleanSelfAccountId)
  const hasHandlePair = Boolean(cleanAuthorHandle && (cleanSelfAccountHandle || cleanSelfAccountUsername))

  if (!hasIdPair && !hasHandlePair) {
    return {
      sent: false,
      status: comment.status,
      reason: '댓글 작성자 및 계정 식별 정보를 확인할 수 없어 안전을 위해 발송을 중단했습니다.',
    }
  }

  if (isSelfComment(
    { authorId: comment.author_id, authorHandle: comment.author_handle },
    {
      accountId: selfAccountId,
      accountHandle: selfAccountHandle,
      accountUsername: selfAccountUsername,
    }
  )) {
    return {
      sent: false,
      status: comment.status,
      reason: '본인 계정이 작성한 댓글에는 답글을 전송할 수 없습니다.',
    }
  }

  // 4. Execution Admission Gate evaluation
  const admission = await ExecutionAdmissionGate.evaluate({
    workspaceId,
    channel: comment.channel,
    actionKind: 'comment_reply',
    actorUserId: actor.userId,
    isAutonomousExecution: actor.isAuto ?? false,
  })

  if (!admission.admitted) {
    return {
      sent: false,
      status: comment.status,
      reason: admission.message,
    }
  }

  // 5. Canonical Action Ledger & Idempotency (reply:<workspace>:<channel>:<provider_comment_id>)
  const idempotencyKey = `reply:${workspaceId}:${comment.channel}:${comment.provider_comment_id}`
  let actionReq: any = null
  let attempt: any = null

  try {
    actionReq = await CanonicalActionLedgerService.createActionRequest({
      workspaceId,
      channel: comment.channel,
      actionKind: 'comment_reply',
      targetExternalId: comment.provider_comment_id,
      targetLabel: `@${comment.author_handle}`,
      exactPayload: { text: draft.draft_text },
      approvalFingerprint: draft.approved_fingerprint,
      idempotencyKey,
      createdBy: actor.userId || '00000000-0000-0000-0000-000000000000',
      adminClient,
    })

    if (actionReq.isExisting && actionReq.status === 'succeeded') {
      await repo.updateCommentStatus(workspaceId, comment.id, 'SENT')
      return {
        sent: true,
        status: 'SENT',
        providerReplyId: actionReq.providerReference,
        reason: '이미 답글이 등록되었습니다 (멱등성 확인).',
      }
    }

    // Any earlier request for this comment (in flight, failed or unknown) blocks a second send: a human must check.
    if (actionReq.isExisting) {
      await repo.updateCommentStatus(workspaceId, comment.id, 'NEEDS_CHECK', '답글이 올라갔는지 확인해 주세요')
      return {
        sent: false,
        status: 'NEEDS_CHECK',
        reason: '답글이 올라갔는지 확인해 주세요',
      }
    }

    attempt = await CanonicalActionLedgerService.startAttempt({
      workspaceId,
      actionRequestId: actionReq.requestId,
      attemptNumber: 1,
      createdBy: actor.userId || '00000000-0000-0000-0000-000000000000',
      adminClient,
    })

    await repo.updateCommentStatus(workspaceId, comment.id, 'SENDING')
  } catch (err) {
    console.error('[sendCommentReply] Failed to initialize action ledger:', err)
    return {
      sent: false,
      status: comment.status,
      reason: '답글 발송 준비 중 오류가 발생했습니다.',
    }
  }

  // 6. Provider Send
  let providerReplyId: string | null = null
  try {
    if (comment.channel === 'instagram') {
      const igProvider = createInstagramProvider(fetcher)
      const res = await igProvider.sendCommentReply({
        accountId: cred.externalAccountId || '',
        targetId: comment.provider_comment_id,
        accessToken: cred.accessToken,
        text: draft.draft_text,
      })
      providerReplyId = res.providerReplyId
    } else {
      const threadsProvider = createThreadsProvider(fetcher)
      const res = await threadsProvider.sendReply({
        accountId: cred.externalAccountId || '',
        targetId: comment.provider_comment_id,
        accessToken: cred.accessToken,
        text: draft.draft_text,
      })
      providerReplyId = res.providerReplyId
    }
  } catch (providerErr: any) {
    console.error('[sendCommentReply] Provider call failed or uncertain:', providerErr)
    const diag = providerErr?.diagnostic ? ` [${providerErr.diagnostic}]` : providerErr?.message ? ` (${providerErr.message.slice(0, 100)})` : ''
    // Invariant 3: Unknown/uncertain provider outcome is NEVER auto-retried — state NEEDS_CHECK
    await repo.updateCommentStatus(workspaceId, comment.id, 'NEEDS_CHECK', `답글이 올라갔는지 확인해 주세요${diag}`)
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
      reason: '답글이 올라갔는지 확인해 주세요',
    }
  }

  if (!providerReplyId) {
    await repo.updateCommentStatus(workspaceId, comment.id, 'NEEDS_CHECK', '답글이 올라갔는지 확인해 주세요')
    return {
      sent: false,
      status: 'NEEDS_CHECK',
      reason: '답글이 올라갔는지 확인해 주세요',
    }
  }

  // 7. Independent Readback Verification (Invariant 3)
  // Verify success by independent readback GET before marking SENT
  let isLive = false
  try {
    if (comment.channel === 'instagram') {
      const readback = await getInstagramCommentReplyReadback({
        replyId: providerReplyId,
        accessToken: cred.accessToken,
        fetcher,
      })
      isLive = readback.isLive
    } else {
      const readback = await getThreadsReplyReadback({
        replyId: providerReplyId,
        accessToken: cred.accessToken,
        fetcher,
      })
      isLive = readback.isLive
    }
  } catch (readbackErr) {
    console.error('[sendCommentReply] Readback error:', readbackErr)
    isLive = false
  }

  if (!isLive) {
    // Invariant 3: Readback failed/uncertain -> state NEEDS_CHECK, NEVER auto-retried
    await repo.updateCommentStatus(workspaceId, comment.id, 'NEEDS_CHECK', '답글이 올라갔는지 확인해 주세요')
    if (actionReq?.requestId) {
      try {
        await CanonicalActionLedgerService.markUnknownResult({
          workspaceId,
          actionRequestId: actionReq.requestId,
          attemptId: attempt?.attemptId,
          reason: 'Readback GET verification failed',
        })
      } catch {}
    }
    return {
      sent: false,
      status: 'NEEDS_CHECK',
      reason: '답글이 올라갔는지 확인해 주세요',
    }
  }

  // 8. Success: record verified receipt, update status to SENT, log audit
  try {
    const verifiedUrl = comment.channel === 'instagram'
      ? `https://instagram.com`
      : `https://threads.net`

    await repo.updateCommentStatus(workspaceId, comment.id, 'SENT', null)

    await CanonicalActionLedgerService.recordReceiptAndVerify({
      workspaceId,
      actionRequestId: actionReq.requestId,
      attemptId: attempt.attemptId,
      providerReference: providerReplyId,
      resultUrl: verifiedUrl,
      observedPayload: {
        providerReplyId,
        readbackVerified: true,
        channel: comment.channel,
      },
      recordedBy: actor.userId,
      adminClient,
    })

    const policy = await repo.findPolicy(workspaceId, comment.channel)
    const draftFingerprint = draft.approved_fingerprint ?? computeApprovalFingerprint(workspaceId, comment.id, draft.draft_text)
    const draftLength = draft.draft_text.length
    await repo.recordAudit({
      workspace_id: workspaceId,
      comment_id: comment.id,
      channel: comment.channel,
      actor: actor.type,
      actor_user_id: actor.userId ?? null,
      action: actor.isAuto ? 'auto_reply' : 'manual_send',
      policy_snapshot: policy ? { ...policy } : null,
      provider_reply_id: providerReplyId,
      readback_verified: true,
      details: {
        draftFingerprint,
        draftLength,
      },
    })
  } catch (finalizeErr) {
    console.error('[sendCommentReply] Finalization warning:', finalizeErr)
  }

  return {
    sent: true,
    providerReplyId,
    status: 'SENT',
  }
}
