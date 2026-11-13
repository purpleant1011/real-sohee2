import type { SupabaseClient } from '@supabase/supabase-js';
import { BookingRecoveryRepository, RecoveryOutboxItem } from './repository';
import { RecoveryActor } from './contracts';
import type { ApprovedReplyDto, VerifiedDmDeliveryEvidence } from './approved-reply';
import { validateApprovedReply } from './approval-binding';

export interface ReadbackResult {
  verified: boolean;
  providerMessageId?: string;
  text?: string;
  recipientRef?: string;
  senderId?: string;
  observedAt?: string;
  reason?: string;
}

export interface AttemptedSendEvidence {
  /** Original immutable snapshot, not a regenerated or newly approved reply. */
  reply: ApprovedReplyDto;
  providerMessageId: string | null;
  senderId: string;
  requestedAt: string;
  /** Server-resolved authorized actor; never fabricate a zero UUID for an RPC. */
  actor: RecoveryActor;
}

export interface ReconcileDependencies {
  repository: BookingRecoveryRepository;
  client: SupabaseClient<any>;
  loadAttemptedSend?: (item: RecoveryOutboxItem) => Promise<AttemptedSendEvidence | null>;
  readbackFetcher: (params: {
    workspaceId: string;
    caseId: string;
    sourceEventKey: string;
    attemptedSend: AttemptedSendEvidence;
  }) => Promise<ReadbackResult>;
}

export interface ReconcileResult {
  status: 'RESOLVED_VERIFIED' | 'RETRY_SCHEDULED' | 'MOVED_TO_HUMAN_REVIEW';
  attempt: number;
  reason?: string;
}

const MAX_RECONCILE_ATTEMPTS = 3;

/** READBACK ONLY. No transport for sending is available to this reconciler. */
export async function reconcileOutboxItem(
  item: RecoveryOutboxItem,
  deps: ReconcileDependencies
): Promise<ReconcileResult> {
  const { repository, client, readbackFetcher } = deps;
  const currentAttempt = item.attempt + 1;
  const caseItem = await repository.getCase(item.workspace_id, item.case_id);
  if (!caseItem || caseItem.id !== item.case_id || caseItem.workspace_id !== item.workspace_id ||
    item.kind !== 'SEND_DM' || !['UNKNOWN', 'CLAIMED'].includes(item.state) ||
    !['RESULT_UNKNOWN', 'NEEDS_RECONCILIATION', 'SEND_VERIFIED', 'AWAITING_CUSTOMER'].includes(caseItem.stage)) {
    throw new Error('RECONCILE_CONTEXT_MISMATCH');
  }

  let attempted: AttemptedSendEvidence | null = null;
  try {
    attempted = await deps.loadAttemptedSend?.(item) ?? null;
  } catch { /* Unknown remains unknown when its immutable evidence cannot be loaded. */ }
  const validAttempt = attempted && attempted.actor.workspaceId === item.workspace_id &&
    attempted.actor.userId && ['owner', 'manager'].includes(attempted.actor.role) &&
    attempted.reply.workspaceId === item.workspace_id && attempted.reply.caseId === item.case_id &&
    attempted.senderId && validateApprovedReply(attempted.reply, attempted.reply.fingerprint, new Date(attempted.requestedAt)) &&
    item.source_event_key === `recovery:${item.case_id}:send:${attempted.reply.sourceMessageId}:${attempted.reply.fingerprint}`;

  let readback: ReadbackResult | null = null;
  if (validAttempt) {
    try {
      readback = await readbackFetcher({
        workspaceId: item.workspace_id, caseId: item.case_id, sourceEventKey: item.source_event_key,
        attemptedSend: attempted!,
      });
    } catch { /* Provider lookup failure cannot authorize another send. */ }
  }
  const observedAt = Date.parse(readback?.observedAt || '');
  const verified = validAttempt && attempted && readback?.verified &&
    !!readback.providerMessageId?.trim() &&
    (!attempted.providerMessageId || readback.providerMessageId === attempted.providerMessageId) &&
    readback.text === attempted.reply.replyText && readback.recipientRef === attempted.reply.recipientRef &&
    readback.senderId === attempted.senderId && observedAt >= Date.parse(attempted.requestedAt) && observedAt <= Date.now();

  async function updateOutbox(state: 'FINISHED' | 'UNKNOWN', nextAttemptAt?: string) {
    const { error } = await client.from('booking_recovery_outbox').update({
      state, attempt: currentAttempt, updated_at: new Date().toISOString(),
      ...(nextAttemptAt ? { next_attempt_at: nextAttemptAt } : {}),
    }).eq('workspace_id', item.workspace_id).eq('id', item.id);
    if (error) throw new Error('RECONCILE_LEDGER_WRITE_FAILED');
  }

  if (verified && attempted && readback) {
    const evidence: VerifiedDmDeliveryEvidence = {
      schemaVersion: 1, channel: 'instagram', providerMessageId: readback.providerMessageId!,
      payloadFingerprint: attempted.reply.fingerprint, senderId: readback.senderId!,
      recipientRef: readback.recipientRef!, requestedAt: attempted.requestedAt, observedAt: readback.observedAt!,
    };
    let current = caseItem;
    const stages = current.stage === 'AWAITING_CUSTOMER' ? [] : current.stage === 'SEND_VERIFIED'
      ? ['AWAITING_CUSTOMER'] as const
      : current.stage === 'RESULT_UNKNOWN'
        ? ['NEEDS_RECONCILIATION', 'SEND_VERIFIED', 'AWAITING_CUSTOMER'] as const
        : ['SEND_VERIFIED', 'AWAITING_CUSTOMER'] as const;
    for (const stage of stages) {
      current = await repository.transitionCase(attempted.actor, {
        caseId: item.case_id, expectedVersion: current.version, nextStage: stage,
        stepKind: stage === 'SEND_VERIFIED' ? 'RECONCILE_VERIFIED' : `RECONCILE_${stage}`,
        fingerprint: attempted.reply.fingerprint,
        idempotencyKey: `reconcile:${item.id}:${stage}`, providerMessageId: readback.providerMessageId,
        evidenceRef: stage === 'SEND_VERIFIED' ? JSON.stringify(evidence) : undefined,
      });
    }
    await updateOutbox('FINISHED');
    return { status: 'RESOLVED_VERIFIED', attempt: currentAttempt, reason: '원본 답변과 독립 전송 증거 일치' };
  }

  if (currentAttempt >= MAX_RECONCILE_ATTEMPTS) {
    if (!validAttempt || !attempted) throw new Error('RECONCILE_MANUAL_EVIDENCE_REQUIRED');
    await repository.transitionCase(attempted.actor, {
      caseId: item.case_id, expectedVersion: caseItem.version, nextStage: 'HUMAN_REVIEW',
      stepKind: 'RECONCILE_EXHAUSTED', fingerprint: attempted.reply.fingerprint,
      idempotencyKey: `reconcile:${item.id}:exhausted`,
    });
    await updateOutbox('UNKNOWN');
    return { status: 'MOVED_TO_HUMAN_REVIEW', attempt: currentAttempt, reason: '재조회 예산 소진: 직접 확인 필요' };
  }

  const backoffMinutes = Math.pow(2, currentAttempt) * 2;
  await updateOutbox('UNKNOWN', new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString());
  return { status: 'RETRY_SCHEDULED', attempt: currentAttempt, reason: `${backoffMinutes}분 후 결과 재조회 예정` };
}
