import type { SupabaseClient } from '@supabase/supabase-js';
import { RecoveryActor, RecoveryResult } from './contracts';
import { BookingRecoveryRepository } from './repository';
import { approvedReplyFingerprint, validateApprovedReply } from './approval-binding';
import type { ApprovedReplyDto, LoadApprovedReply, VerifiedDmDeliveryEvidence } from './approved-reply';
import { isEngagementSendEnabled } from './production';
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate';
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification';
import {
  sendInstagramDirectMessage,
  getInstagramDirectMessageReadback,
  type MetaFetch,
} from '@/lib/providers/meta-api';
import {
  checkIsDmExpired,
  DM_EXPIRED_KOREAN_MESSAGE,
} from '@/features/engagement/dm/options-generator';
import { loadChannelCredential } from '@/features/channels/credential-repository';

export interface ApproveAndSendReplyDependencies {
  repository: BookingRecoveryRepository;
  client: SupabaseClient<any>;
  loadApprovedReply?: LoadApprovedReply;
  loadCurrentFingerprint?: (caseId: string) => Promise<string | null>;
  loadCurrentDraft?: (
    caseId: string
  ) => Promise<{ draftText: string; dmDraftId?: string | null } | null>;
  sendProviderDm?: (payload: {
    pageId: string;
    recipientId: string;
    accessToken: string;
    text: string;
    fetcher?: MetaFetch;
  }) => Promise<{ providerMessageId: string }>;
  readbackFetcher?: (payload: {
    messageId: string;
    accessToken: string;
    fetcher?: MetaFetch;
  }) => Promise<{
    isLive: boolean; reason?: string; messageId?: string; text?: string;
    senderId?: string; recipientId?: string; observedAt?: string;
  }>;
  getChannelCredential?: (
    workspaceId: string,
    channelConnectionId: string,
    channel: 'instagram'
  ) => Promise<{
    accessToken: string;
    externalAccountId?: string;
    grantedScopes?: readonly string[];
  }>;
  evaluateAdmission?: (params: {
    workspaceId: string;
    channel: 'instagram';
    actionKind: 'dm_reply';
    actorUserId?: string;
  }) => Promise<{ admitted: boolean; message: string }>;
  fetcher?: MetaFetch;
  adminClient?: any;
}

export interface ApproveAndSendReplyResult {
  stage: string;
  providerMessageId?: string;
}

export async function approveAndSendReply(
  actor: RecoveryActor,
  params: {
    caseId: string;
    expectedVersion: number;
    fingerprint: string;
    approvalId?: string;
  },
  deps: ApproveAndSendReplyDependencies
): Promise<RecoveryResult<ApproveAndSendReplyResult>> {
  const {
    repository,
    client,
    loadCurrentFingerprint,
    loadCurrentDraft,
    sendProviderDm,
    readbackFetcher,
    getChannelCredential,
    fetcher,
    adminClient,
  } = deps;

  // 1. Fetch case
  const caseItem = await repository.getCase(actor.workspaceId, params.caseId);
  if (!caseItem) {
    return { ok: false, code: 'NOT_FOUND', message: '케이스를 찾을 수 없습니다.' };
  }

  if (caseItem.workspace_id !== actor.workspaceId || caseItem.id !== params.caseId) {
    return { ok: false, code: 'FORBIDDEN', message: '이 문의에 접근할 수 없습니다.' };
  }
  if (caseItem.stage !== 'AWAITING_SEND_APPROVAL' || caseItem.version !== params.expectedVersion) {
    return { ok: false, code: 'VERSION_CONFLICT', message: '이미 처리 중이거나 변경된 문의입니다. 다시 확인해 주세요.' };
  }

  // 1.1 Verify durable approval row in DB
  const approvalQuery = client
    .from('booking_recovery_approvals')
    .select('*')
    .eq('workspace_id', actor.workspaceId)
    .eq('case_id', caseItem.id)
    .eq('step_kind', 'SEND')
    .eq('payload_fingerprint', params.fingerprint);

  const { data: approvalRow, error: approvalErr } = params.approvalId
    ? await approvalQuery.eq('id', params.approvalId).maybeSingle()
    : await approvalQuery.order('approved_at', { ascending: false }).limit(1).maybeSingle();

  if (approvalErr || !approvalRow) {
    return { ok: false, code: 'FORBIDDEN', message: '유효한 발송 승인 내역을 찾을 수 없습니다.' };
  }

  if (
    approvalRow.step_kind !== 'SEND' ||
    approvalRow.payload_fingerprint !== params.fingerprint ||
    (approvalRow.authorized_case_version != null && approvalRow.authorized_case_version !== params.expectedVersion) ||
    Date.parse(approvalRow.expires_at) <= Date.now() ||
    approvalRow.consumed_at !== null
  ) {
    return { ok: false, code: 'VERSION_CONFLICT', message: '승인 정보가 만료되었거나 현재 상태와 일치하지 않습니다.' };
  }

  // 2. Fetch latest proposal snapshot
  const proposal = await repository.getLatestProposal(actor.workspaceId, caseItem.id);
  if (!proposal) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '발송할 제안 초안이 존재하지 않습니다.',
    };
  }

  // 3. Stale check 1: Proposal source message vs Case source message
  if (proposal.source_inbound_message_id !== caseItem.source_inbound_message_id) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: '제안의 원본 문의와 케이스의 문의가 일치하지 않습니다.',
    };
  }

  // 4. Stale check 2: Check whether newer customer messages arrived in this thread
  const { data: threadMessages, error: messageError } = await client
    .from('instagram_dm_messages')
    .select('id, sender_type, sent_at')
    .eq('workspace_id', actor.workspaceId)
    .eq('thread_id', caseItem.source_thread_id)
    .order('sent_at', { ascending: true });

  if (messageError || !threadMessages?.some((message) =>
    message.id === caseItem.source_inbound_message_id && message.sender_type === 'customer')) {
    return { ok: false, code: 'CONTEXT_REQUIRED', message: '최신 고객 문의를 확인할 수 없습니다. 다시 확인해 주세요.' };
  }

  if (threadMessages && threadMessages.length > 0) {
    const customerMsgs = threadMessages.filter((m) => m.sender_type === 'customer');
    const latestCustomerMsg = customerMsgs[customerMsgs.length - 1];
    if (latestCustomerMsg && latestCustomerMsg.id !== caseItem.source_inbound_message_id) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: '새로운 고객 메시지가 수신되어 승인이 만료되었습니다. 대화를 다시 확인해 주세요.',
      };
    }
  }

  // 5. Stale draft modification check
  if (loadCurrentFingerprint) {
    const currentFp = await loadCurrentFingerprint(caseItem.id);
    if (currentFp && currentFp !== params.fingerprint) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: '승인과 다른 최신 문안이 존재합니다. 다시 확인해 주세요.',
      };
    }
  }

  if (loadCurrentDraft) {
    const currentDraft = await loadCurrentDraft(caseItem.id);
    if (currentDraft && currentDraft.draftText !== proposal.reply_text) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: '승인된 제안 문안과 현재 초안이 일치하지 않습니다. 다시 확인해 주세요.',
      };
    }
  }

  // 6. A fresh server-resolved v2 snapshot is mandatory; legacy hashes cannot send.
  if (!deps.loadApprovedReply) {
    return { ok: false, code: 'CONTEXT_REQUIRED', message: '답변의 최신 정보 확인이 필요합니다. 다시 검토해 주세요.' };
  }
  let approved: ApprovedReplyDto | null;
  try {
    approved = await deps.loadApprovedReply(actor.workspaceId, caseItem.id);
  } catch {
    return { ok: false, code: 'CONTEXT_REQUIRED', message: '최신 정보를 조회할 수 없습니다. 다시 확인해 주세요.' };
  }
  const matchesProposal = (reply: ApprovedReplyDto): boolean => {
    const offer = reply.offer;
    return reply.workspaceId === actor.workspaceId && proposal.workspace_id === actor.workspaceId &&
      proposal.case_id === caseItem.id && reply.caseId === caseItem.id &&
      reply.proposalId === proposal.id && reply.revision === proposal.revision &&
      reply.recipientRef === caseItem.customer_ref && reply.sourceMessageId === caseItem.source_inbound_message_id &&
      reply.sourceMessageId === proposal.source_inbound_message_id &&
      reply.replyText === proposal.reply_text && reply.catalogVersion === proposal.catalog_version &&
      reply.validUntil === proposal.valid_until && reply.fingerprint === proposal.payload_fingerprint &&
      !!offer && offer.serviceId === proposal.service_id && offer.serviceName === proposal.service_name &&
      offer.totalAmountKrw === proposal.total_amount_krw && offer.depositKrw === proposal.deposit_krw &&
      offer.slotId === proposal.slot_id && offer.slotVersion === proposal.slot_version &&
      offer.startsAt === proposal.starts_at && offer.endsAt === proposal.ends_at && offer.timezone === proposal.timezone;
  };
  if (!approved || !validateApprovedReply(approved, params.fingerprint) || !matchesProposal(approved)) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: '승인 지문이 제안 내용과 일치하지 않습니다.',
    };
  }

  // 7. Gate & Policy Preflight Checks (CANNOT be bypassed by custom mock transports)
  // 7.1 Real sends flag & Workspace allowlist
  if (!isEngagementSendEnabled(actor.workspaceId)) {
    return {
      ok: false,
      code: 'POLICY_BLOCKED',
      message: '외부 메시지 실발송 기능이 현재 비활성화되어 있습니다.',
    };
  }

  // 7.2 Kill switch check
  const killCheck = await checkKillSwitchPreflight(adminClient ?? client, {
    workspaceId: actor.workspaceId,
    channel: 'INSTAGRAM',
    provider: 'META',
  });
  if (killCheck.blocked) {
    return {
      ok: false,
      code: 'POLICY_BLOCKED',
      message: killCheck.reason || '긴급 킬스위치가 활성화되어 있어 메시지를 전송할 수 없습니다.',
    };
  }

  // 7.3 Execution Admission Gate
  const admissionEvaluator =
    deps.evaluateAdmission ||
    ((p) => ExecutionAdmissionGate.evaluate({ ...p, isAutonomousExecution: false }));

  const admission = await admissionEvaluator({
    workspaceId: actor.workspaceId,
    channel: 'instagram',
    actionKind: 'dm_reply',
    actorUserId: actor.userId,
  });
  if (!admission.admitted) {
    return {
      ok: false,
      code: 'POLICY_BLOCKED',
      message: admission.message,
    };
  }

  // 7.4 Thread & 24h Policy Window check
  const { data: threadRow, error: threadErr } = await client
    .from('instagram_dm_threads')
    .select('id, workspace_id, channel_connection_id, expires_at, status')
    .eq('workspace_id', actor.workspaceId)
    .eq('id', caseItem.source_thread_id)
    .single();

  if (threadErr || !threadRow) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '채널 대화 정보를 찾을 수 없습니다.',
    };
  }

  if (checkIsDmExpired(threadRow.expires_at)) {
    return {
      ok: false,
      code: 'POLICY_BLOCKED',
      message: DM_EXPIRED_KOREAN_MESSAGE,
    };
  }

  // 7.5 Channel Credential & Scope check
  let cred: {
    accessToken: string;
    externalAccountId?: string;
    grantedScopes?: readonly string[];
  };
  try {
    cred = getChannelCredential
      ? await getChannelCredential(actor.workspaceId, threadRow.channel_connection_id, 'instagram')
      : await loadChannelCredential(actor.workspaceId, threadRow.channel_connection_id, 'instagram');
  } catch {
    return {
      ok: false,
      code: 'POLICY_BLOCKED',
      message: '채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.',
    };
  }

  const normalizedScopes = normalizeChannelScopes('instagram', cred.grantedScopes || []);
  if (!normalizedScopes.includes('instagram_manage_messages')) {
    return {
      ok: false,
      code: 'POLICY_BLOCKED',
      message: '채널 연동에 필요한 메시지 관리 권한이 부여되지 않았습니다.',
    };
  }

  // 8. Work operation key: recovery:{caseId}:send:{sourceInboundMessageId}:{approvalFingerprint}
  const operationKey = `recovery:${caseItem.id}:send:${proposal.source_inbound_message_id}:${params.fingerprint}`;

  // 9. Claim execution step lease
  let stepClaimResult;
  try {
    stepClaimResult = await repository.claimStep(actor, {
      caseId: caseItem.id,
      kind: 'SEND_DM',
      idempotencyKey: operationKey,
      inputFingerprint: params.fingerprint,
      leaseSeconds: 60,
    });
  } catch (err: any) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: err?.message || '실행 권한 획득 실패 (동시 실행 차단)',
    };
  }

  if (!stepClaimResult.claimed) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: '이미 다른 작업자가 발송을 진행 중이거나 완료했습니다.',
    };
  }

  // 10. Strict Validation of Claimed Step (Fail closed before ANY provider call, NO placeholder id fallback)
  const step = stepClaimResult.step;
  if (
    !step ||
    !step.id ||
    step.workspace_id !== actor.workspaceId ||
    step.case_id !== caseItem.id ||
    step.idempotency_key !== operationKey ||
    step.input_fingerprint !== params.fingerprint ||
    step.claim_token !== stepClaimResult.claim_token ||
    step.attempt !== stepClaimResult.attempt
  ) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: '실행 단계 데이터의 무결성 검증에 실패했습니다.',
    };
  }

  const stepId = step.id;

  // 11. Durable Provider-Started Marker (SEND_REQUESTED)
  let currentCase = caseItem;
  try {
    currentCase = await repository.transitionCase(actor, {
      caseId: caseItem.id,
      expectedVersion: params.expectedVersion,
      nextStage: 'SEND_REQUESTED',
      stepKind: 'SEND_DM_REQUESTED',
      fingerprint: params.fingerprint,
      idempotencyKey: `${operationKey}:started`,
    });
  } catch (err: any) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: '발송 시작 상태 기록 실패',
    };
  }

  // Re-resolve after the durable marker: admission/credential/lease awaits must not authorize stale facts.
  try {
    const latest = await deps.loadApprovedReply(actor.workspaceId, caseItem.id);
    if (!latest || !validateApprovedReply(latest, params.fingerprint) || !matchesProposal(latest) ||
      approvedReplyFingerprint(latest) !== params.fingerprint) throw new Error('STALE_APPROVAL');
    approved = structuredClone(latest);
  } catch {
    try {
      await repository.transitionCase(actor, {
        caseId: caseItem.id, expectedVersion: currentCase.version, nextStage: 'HUMAN_REVIEW',
        stepKind: 'STALE_BEFORE_SEND', fingerprint: params.fingerprint,
        idempotencyKey: `${operationKey}:stale`,
      });
    } catch { /* Keep SEND_REQUESTED sealed if persistence is unavailable. */ }
    return { ok: false, code: 'VERSION_CONFLICT', message: '답변 정보가 변경되어 전송하지 않았습니다. 다시 검토해 주세요.' };
  }

  // 12. Provider Send (Uses ACTUAL credentials from loaded connection, NEVER hardcoded fake literals)
  const sendStartedAt = Date.now();
  let providerMessageId: string | null = null;
  const sendFn = sendProviderDm || sendInstagramDirectMessage;

  try {
    const sendRes = await sendFn({
      pageId: cred.externalAccountId || '',
      recipientId: approved.recipientRef,
      accessToken: cred.accessToken,
      text: approved.replyText,
      fetcher,
    });
    providerMessageId = sendRes.providerMessageId;
  } catch {
    // Demote to RESULT_UNKNOWN, NO auto-retry
    try {
      await repository.finishStep(actor, {
        caseId: caseItem.id,
        stepId,
        claimToken: stepClaimResult.claim_token,
        attempt: stepClaimResult.attempt,
        inputFingerprint: params.fingerprint,
        status: 'FAILED',
        evidenceRef: 'PROVIDER_SEND_RESULT_UNKNOWN',
      });

      await repository.transitionCase(actor, {
        caseId: caseItem.id,
        expectedVersion: currentCase.version,
        nextStage: 'RESULT_UNKNOWN',
        stepKind: 'SEND_DM_FAILED',
        fingerprint: params.fingerprint,
        idempotencyKey: `${operationKey}:unknown`,
      });

      // Enqueue to outbox for read-only reconciliation
      await client.from('booking_recovery_outbox').upsert(
        {
          workspace_id: actor.workspaceId,
          case_id: caseItem.id,
          source_event_key: operationKey,
          kind: 'SEND_DM',
          state: 'UNKNOWN',
          attempt: 1,
          next_attempt_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        },
        { onConflict: 'workspace_id,source_event_key,kind' }
      );
    } catch {}

    return {
      ok: false,
      code: 'RESULT_UNKNOWN',
      message: '메시지 발송 결과를 즉시 확인할 수 없습니다. 전송 결과를 확인해 주세요.',
    };
  }

  // If provider did not return a valid messageId: move to HUMAN_REVIEW, never pretend success
  if (!providerMessageId) {
    try {
      await repository.finishStep(actor, {
        caseId: caseItem.id,
        stepId,
        claimToken: stepClaimResult.claim_token,
        attempt: stepClaimResult.attempt,
        inputFingerprint: params.fingerprint,
        status: 'FAILED',
        evidenceRef: 'Missing providerMessageId from provider',
      });

      await repository.transitionCase(actor, {
        caseId: caseItem.id,
        expectedVersion: currentCase.version,
        nextStage: 'HUMAN_REVIEW',
        stepKind: 'SEND_DM_MISSING_ID',
        fingerprint: params.fingerprint,
        idempotencyKey: `${operationKey}:missing_id`,
      });
    } catch {}

    return {
      ok: false,
      code: 'HUMAN_REVIEW',
      message: '발송 식별자를 확인할 수 없어 사장님 확인이 필요합니다.',
    };
  }

  // 13. Independent Readback Verification (Hard Invariant)
  let isLive = false;
  let verifiedEvidenceRef: string | undefined;
  try {
    const readback: {
      isLive: boolean; messageId?: string; text?: string; senderId?: string;
      recipientId?: string; observedAt?: string;
    } = await (readbackFetcher || getInstagramDirectMessageReadback)({
      messageId: providerMessageId, accessToken: cred.accessToken, fetcher,
    });
    const observedAt = Date.parse(readback.observedAt || '');
    isLive = readback.isLive && readback.messageId === providerMessageId &&
      readback.text === approved.replyText && readback.recipientId === approved.recipientRef &&
      !!cred.externalAccountId && readback.senderId === cred.externalAccountId &&
      observedAt >= sendStartedAt && observedAt <= Date.now();
    if (isLive) {
      const evidence: VerifiedDmDeliveryEvidence = {
        schemaVersion: 1, channel: 'instagram', providerMessageId,
        payloadFingerprint: params.fingerprint, senderId: readback.senderId!,
        recipientRef: approved.recipientRef, requestedAt: new Date(sendStartedAt).toISOString(),
        observedAt: readback.observedAt!,
      };
      verifiedEvidenceRef = JSON.stringify(evidence);
    }
  } catch (rbErr) {
    isLive = false;
  }

  if (!isLive) {
    // Readback failed or uncertain: demote to RESULT_UNKNOWN, NO auto-retry
    try {
      await repository.finishStep(actor, {
        caseId: caseItem.id,
        stepId,
        claimToken: stepClaimResult.claim_token,
        attempt: stepClaimResult.attempt,
        inputFingerprint: params.fingerprint,
        status: 'FAILED',
        providerMessageId,
        evidenceRef: 'Independent readback verification failed',
      });

      await repository.transitionCase(actor, {
        caseId: caseItem.id,
        expectedVersion: currentCase.version,
        nextStage: 'RESULT_UNKNOWN',
        stepKind: 'READBACK_UNVERIFIED',
        fingerprint: params.fingerprint,
        idempotencyKey: `${operationKey}:readback_unverified`,
        providerMessageId,
      });

      await client.from('booking_recovery_outbox').upsert(
        {
          workspace_id: actor.workspaceId,
          case_id: caseItem.id,
          source_event_key: operationKey,
          kind: 'SEND_DM',
          state: 'UNKNOWN',
          attempt: 1,
          next_attempt_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        },
        { onConflict: 'workspace_id,source_event_key,kind' }
      );
    } catch {}

    return {
      ok: false,
      code: 'RESULT_UNKNOWN',
      message: '메시지 전송 결과를 확인 중입니다. 다시 보내지 말고 전송 결과를 확인해 주세요.',
    };
  }

  // 14. Readback Verified Success: Finish Step CAS & Durable Transitions
  // Transition sequence: SEND_REQUESTED -> PROVIDER_ACCEPTED -> SEND_VERIFIED -> AWAITING_CUSTOMER
  try {
    await repository.finishStep(actor, {
      caseId: caseItem.id,
      stepId,
      claimToken: stepClaimResult.claim_token,
      attempt: stepClaimResult.attempt,
      inputFingerprint: params.fingerprint,
      status: 'COMPLETED',
      providerMessageId,
    });

    const acceptedCase = await repository.transitionCase(actor, {
      caseId: caseItem.id,
      expectedVersion: currentCase.version,
      nextStage: 'PROVIDER_ACCEPTED',
      stepKind: 'SEND_DM_ACCEPTED',
      fingerprint: params.fingerprint,
      idempotencyKey: `${operationKey}:accepted`,
      providerMessageId,
    });

    const verifiedCase = await repository.transitionCase(actor, {
      caseId: caseItem.id,
      expectedVersion: acceptedCase.version,
      nextStage: 'SEND_VERIFIED',
      stepKind: 'SEND_DM_VERIFIED',
      fingerprint: params.fingerprint,
      idempotencyKey: `${operationKey}:verified`,
      providerMessageId,
      evidenceRef: verifiedEvidenceRef,
    });

    const awaitingCase = await repository.transitionCase(actor, {
      caseId: caseItem.id,
      expectedVersion: verifiedCase.version,
      nextStage: 'AWAITING_CUSTOMER',
      stepKind: 'AWAIT_CUSTOMER_REPLY',
      fingerprint: params.fingerprint,
      idempotencyKey: `${operationKey}:awaiting`,
      providerMessageId,
    });

    // Mark outbox finished if existed
    await client
      .from('booking_recovery_outbox')
      .update({ state: 'FINISHED', updated_at: new Date().toISOString() })
      .eq('workspace_id', actor.workspaceId)
      .eq('case_id', caseItem.id)
      .eq('source_event_key', operationKey);

    return {
      ok: true,
      value: {
        stage: awaitingCase.stage,
        providerMessageId,
      },
    };
  } catch (finishErr: any) {
    return {
      ok: false,
      code: 'RESULT_UNKNOWN',
      message: '발송 후 상태 영속화 중 오류가 발생했습니다. 전송 결과를 확인해 주세요.',
    };
  }
}
