import { matchAcceptedSlot } from './acceptance-temporal-binding';

export interface InboundMessageContext {
  id: string;
  customerRef: string;
  senderType: 'customer' | 'business';
  text: string;
  sentAt: string;
}

export interface ProposalContext {
  customerRef: string;
  sentAt: string;
  serviceName: string;
  /** Legacy recovery proposals use the domain's Asia/Seoul default. */
  timezone?: string;
  slots: Array<{
    id: string;
    label: string;
    startsAt: string;
  }>;
}

export type AcceptanceClassification =
  | { kind: 'accepted'; slotId: string; reason: string }
  | { kind: 'needs_review'; reason: string }
  | { kind: 'ignored'; reason: string };

const AMBIGUOUS_OR_NEGATIVE_REGEX =
  /(?:[?？]|안\s*할|못|불가능|취소|거절|다른\s*시간|변경|그런데|하지만|가능한가|얼마|인가요|일까요)/u;

/**
 * Classifies customer inbound messages against an active proposal snapshot.
 *
 * Rules:
 * 1. Only customer messages (senderType === 'customer') can be acceptance evidence.
 * 2. Customer ref must strictly match.
 * 3. Message sentAt must be after proposal sentAt.
 * 4. Ambiguous affirmations ('네') across multiple slots require review (cannot guess).
 * 5. Every explicit date/time must match startsAt in the proposal timezone, even for one slot.
 * 6. Unknown temporal phrasing requires review; display labels and machine timezone are not authority.
 */
export function classifyAcceptance(params: {
  message: InboundMessageContext;
  proposal: ProposalContext;
}): AcceptanceClassification {
  const { message, proposal } = params;

  // 1. Sender type check
  if (message.senderType !== 'customer') {
    return { kind: 'ignored', reason: '비즈니스 발화 또는 에코 메시지는 수락 증거가 아닙니다.' };
  }

  // 2. Customer ref check
  if (message.customerRef !== proposal.customerRef) {
    return { kind: 'ignored', reason: '제안 대상 고객과 발신자가 일치하지 않습니다.' };
  }

  // 3. Chronological check (strictly after proposal sentAt)
  const msgTime = new Date(message.sentAt).getTime();
  const proposalTime = new Date(proposal.sentAt).getTime();
  if (isNaN(msgTime) || isNaN(proposalTime) || msgTime <= proposalTime) {
    return { kind: 'ignored', reason: '제안 발송 시각 이전의 과거 메시지입니다.' };
  }

  const text = message.text.trim();
  if (!text) {
    return { kind: 'ignored', reason: '메시지 본문이 비어 있습니다.' };
  }

  if (AMBIGUOUS_OR_NEGATIVE_REGEX.test(text)) {
    return { kind: 'needs_review', reason: '질문·거절·조건 변경은 예약 수락으로 처리하지 않습니다.' };
  }
  const slotId = matchAcceptedSlot(text, proposal.slots,
    proposal.timezone === undefined ? 'Asia/Seoul' : proposal.timezone);
  if (slotId) {
    return {
      kind: 'accepted', slotId,
      reason: '고객의 명시 수락과 제안 날짜·시각·매장 시간대 일치 확인',
    };
  }

  // If multiple slots match or no specific slot matched (e.g. just '네'): require owner review
  return {
    kind: 'needs_review',
    reason: '고객이 선택한 날짜·시간이 제안과 일치하는지 사장님 확인이 필요합니다.',
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Projects ingested customer DM message to active recovery cases and durable outbox.
 * Guarantees idempotency and out-of-order convergence.
 */
export async function projectInboundMessageToRecovery(
  client: SupabaseClient<any>,
  params: {
    workspaceId: string;
    threadId: string;
    message: {
      id: string;
      sender_type: string;
      sender_id: string;
      text: string;
      sent_at: string;
    };
  }
): Promise<void> {
  if (params.message.sender_type !== 'customer') return;

  const { data: activeCase, error: caseError } = await client
    .from('booking_recovery_cases')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('source_thread_id', params.threadId)
    .in('stage', ['AWAITING_CUSTOMER'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (caseError) throw new Error('RECOVERY_CASE_LOOKUP_FAILED');
  if (!activeCase || activeCase.workspace_id !== params.workspaceId ||
    activeCase.source_thread_id !== params.threadId || activeCase.customer_ref !== params.message.sender_id ||
    activeCase.stage !== 'AWAITING_CUSTOMER') return;

  // Load latest proposal
  const { data: proposal, error: proposalError } = await client
    .from('booking_recovery_proposals')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('case_id', activeCase.id)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (proposalError) throw new Error('RECOVERY_PROPOSAL_LOOKUP_FAILED');
  if (!proposal || proposal.workspace_id !== params.workspaceId || proposal.case_id !== activeCase.id) return;

  // Acceptance must follow a verified send of this exact proposal, not draft creation/provider acceptance.
  const { data: sendEvidence, error: evidenceError } = await client.from('booking_recovery_steps')
    .select('workspace_id, case_id, actor_id, provider_message_id, input_fingerprint, occurred_at, evidence_ref')
    .eq('workspace_id', params.workspaceId).eq('case_id', activeCase.id)
    .eq('status', 'COMPLETED').eq('input_fingerprint', proposal.payload_fingerprint)
    .in('kind', ['SEND_DM_VERIFIED', 'RECONCILE_VERIFIED'])
    .order('occurred_at', { ascending: false }).limit(1).maybeSingle();
  if (evidenceError) throw new Error('RECOVERY_SEND_EVIDENCE_LOOKUP_FAILED');
  if (!sendEvidence || sendEvidence.workspace_id !== params.workspaceId || sendEvidence.case_id !== activeCase.id ||
    sendEvidence.input_fingerprint !== proposal.payload_fingerprint || !sendEvidence.provider_message_id ||
    !sendEvidence.actor_id || !Number.isFinite(Date.parse(sendEvidence.occurred_at))) return;
  try {
    const receipt = JSON.parse(sendEvidence.evidence_ref);
    if (receipt.schemaVersion !== 1 || receipt.channel !== 'instagram' || !receipt.senderId ||
      receipt.providerMessageId !== sendEvidence.provider_message_id ||
      receipt.payloadFingerprint !== proposal.payload_fingerprint || receipt.recipientRef !== activeCase.customer_ref ||
      !(Date.parse(receipt.observedAt) >= Date.parse(receipt.requestedAt)) ||
      !(Date.parse(receipt.observedAt) <= Date.parse(sendEvidence.occurred_at))) return;
  } catch { return; }

  const classification = classifyAcceptance({
    message: {
      id: params.message.id,
      customerRef: params.message.sender_id,
      senderType: 'customer',
      text: params.message.text,
      sentAt: params.message.sent_at,
    },
    proposal: {
      customerRef: activeCase.customer_ref,
      sentAt: sendEvidence.occurred_at,
      serviceName: proposal.service_name,
      timezone: proposal.timezone,
      slots: [
        {
          id: proposal.slot_id,
          label: proposal.starts_at.slice(0, 16),
          startsAt: proposal.starts_at,
        },
      ],
    },
  });

  if (classification.kind === 'ignored') return;
  const { error: transitionError } = await client.rpc('transition_booking_recovery', {
    p_workspace_id: params.workspaceId, p_case_id: activeCase.id,
    p_expected_version: activeCase.version,
    p_next_stage: classification.kind === 'accepted' ? 'CUSTOMER_ACCEPTED' : 'HUMAN_REVIEW',
    p_actor_id: sendEvidence.actor_id, p_step_kind: 'INBOUND_CUSTOMER_ACCEPTANCE',
    p_fingerprint: proposal.payload_fingerprint, p_idempotency_key: `acceptance:${params.message.id}`,
    p_provider_msg_id: sendEvidence.provider_message_id,
    p_evidence_ref: classification.kind === 'accepted' ? params.message.id : null,
  });
  if (transitionError) {
    if (transitionError.code === '40001' || transitionError.code === '23505') return;
    throw new Error('RECOVERY_ACCEPTANCE_TRANSITION_FAILED');
  }

  if (classification.kind === 'accepted') {
    // The CAS/audit transition is authoritative. Outbox persistence is independently checked, not called atomic.
    const { error: outboxError } = await client
      .from('booking_recovery_outbox')
      .upsert(
        {
          workspace_id: params.workspaceId,
          case_id: activeCase.id,
          source_event_key: `acceptance:${params.message.id}`,
          kind: 'CUSTOMER_ACCEPTED',
          state: 'PENDING',
          attempt: 0,
          next_attempt_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,source_event_key,kind' }
      );
    if (outboxError) throw new Error('RECOVERY_ACCEPTANCE_OUTBOX_WRITE_FAILED');
  }
}
