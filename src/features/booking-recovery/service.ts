import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  RecoveryActor,
  RecoveryResult,
  RecoveryView,
} from './contracts';
import {
  BookingRecoveryRepository,
  BookingRecoveryRepositoryError,
} from './repository';
import { createRecoveryView } from './read-model';
import { verifyOffer } from './availability';
import {
  verifyBookingApprovalFingerprint,
  approvedReplyFingerprint,
  validateApprovedReply,
} from './approval-binding';
import type { ApprovedReplyDto, VerifiedReplyFactRef, LoadApprovedReply } from './approved-reply';
import { loadApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver';
import { classifyAcceptance } from './inbound-projector';
import { formatSlotTimeForCustomer } from './slot-time-format';
import { loadCustomerAcceptanceEvidence } from './customer-acceptance-evidence';
import {
  approveAndSendReply,
  ApproveAndSendReplyDependencies,
} from './dm-adapter';

// Until the shared semantic classifier is integrated, only unambiguous acceptance
// of the unchanged offered terms may cross this write boundary. Explicit new terms,
// questions, refusals and unsupported wording require review; never guess a slot.
function acceptsUnchangedTerms(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/[\s,.!，。！]/gu, '');
  return /^(?:네)?(?:그|해당)(?:시간|조건)(?:으로|에)(?:예약(?:진행)?(?:해주세요|할게요)|확정(?:해주세요|할게요))$/u.test(normalized);
}

export class BookingRecoveryService {
  constructor(
    private readonly repository: BookingRecoveryRepository,
    private readonly client: SupabaseClient<any>,
    private readonly dmDeps?: Partial<ApproveAndSendReplyDependencies>
  ) {}

  /**
   * Opens or returns an existing recovery case.
   */
  public async openCase(
    actor: RecoveryActor,
    sourceInboundMessageId: string
  ): Promise<RecoveryResult<RecoveryView>> {
    try {
      const caseItem = await this.repository.openCase(actor, sourceInboundMessageId);
      const proposal = await this.repository.getLatestProposal(actor.workspaceId, caseItem.id);
      return {
        ok: true,
        value: createRecoveryView({ caseItem, proposal }),
      };
    } catch (error: any) {
      if (error instanceof BookingRecoveryRepositoryError) {
        return {
          ok: false,
          code: (error.code as any) || 'INTERNAL_ERROR',
          message: error.message,
        };
      }
      return {
        ok: false,
        code: 'INTERNAL_ERROR' as any,
        message: error?.message || '케이스 생성 실패',
      };
    }
  }

  /**
   * Prepares a reply proposal.
   * If no confirmed slot exists or multiple slots exist without explicit selection,
   * transitions/remains in NEEDS_CONTEXT without picking a slot arbitrarily.
   */
  public async prepareReply(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      slotId?: string;
    }
  ): Promise<RecoveryResult<RecoveryView>> {
    try {
      const caseItem = await this.repository.getCase(actor.workspaceId, params.caseId);
      if (!caseItem) {
        return { ok: false, code: 'NOT_FOUND', message: '케이스를 찾을 수 없습니다.' };
      }

      const nowIso = new Date().toISOString();

      // Query available slots
      const { data: slotRows, error: slotErr } = await this.client
        .from('booking_recovery_slots')
        .select('*')
        .eq('workspace_id', actor.workspaceId)
        .eq('status', 'AVAILABLE')
        .gt('valid_until', nowIso)
        .gt('starts_at', nowIso)
        .order('starts_at', { ascending: true });

      if (slotErr) {
        throw new BookingRecoveryRepositoryError(
          `슬롯 조회 실패: ${slotErr.message}`,
          slotErr.code,
          500
        );
      }

      const availableSlots = slotRows || [];

      // If no available slots exist: transition to NEEDS_CONTEXT
      if (availableSlots.length === 0) {
        const nextCase =
          caseItem.stage === 'NEEDS_CONTEXT'
            ? caseItem
            : await this.repository.transitionCase(actor, {
                caseId: caseItem.id,
                expectedVersion: params.expectedVersion,
                nextStage: 'NEEDS_CONTEXT',
                stepKind: 'PREPARE_REPLY',
                fingerprint: '0'.repeat(64),
                idempotencyKey: `prepare:${caseItem.id}:${params.expectedVersion}:none`,
              });

        return {
          ok: true,
          value: createRecoveryView({ caseItem: nextCase }),
        };
      }

      // If multiple slots exist and slotId is not specified: prompt owner to select
      if (!params.slotId && availableSlots.length > 1) {
        const nextCase =
          caseItem.stage === 'NEEDS_CONTEXT'
            ? caseItem
            : await this.repository.transitionCase(actor, {
                caseId: caseItem.id,
                expectedVersion: params.expectedVersion,
                nextStage: 'NEEDS_CONTEXT',
                stepKind: 'PREPARE_REPLY',
                fingerprint: '0'.repeat(64),
                idempotencyKey: `prepare:${caseItem.id}:${params.expectedVersion}:multiple`,
              });

        return {
          ok: true,
          value: createRecoveryView({ caseItem: nextCase }),
        };
      }

      // Selected slot
      const chosenSlot = params.slotId
        ? availableSlots.find((s) => s.id === params.slotId)
        : availableSlots[0];

      if (!chosenSlot) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '선택하신 예약 슬롯이 유효하지 않거나 이미 마감되었습니다.',
        };
      }

      // Query associated catalog service
      const { data: serviceRow, error: serviceErr } = await this.client
        .from('workspace_products_services')
        .select('*')
        .eq('workspace_id', actor.workspaceId)
        .eq('id', chosenSlot.service_id)
        .maybeSingle();

      if (serviceErr || !serviceRow) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '등록된 서비스 카탈로그를 찾을 수 없습니다.',
        };
      }

      // Strict offer verification
      const offerVerification = verifyOffer({
        service: {
          id: serviceRow.id,
          workspaceId: actor.workspaceId,
          name: serviceRow.name,
          price: serviceRow.price,
          active: serviceRow.active,
          updatedAt: serviceRow.updated_at,
          durationMinutes: serviceRow.duration_minutes ?? null,
        },
        slot: {
          id: chosenSlot.id,
          workspaceId: actor.workspaceId,
          serviceId: chosenSlot.service_id,
          depositKrw: chosenSlot.deposit_krw,
          catalogVersion: chosenSlot.catalog_version,
          startsAt: chosenSlot.starts_at,
          endsAt: chosenSlot.ends_at,
          timezone: chosenSlot.timezone || 'Asia/Seoul',
          confirmedBy: chosenSlot.confirmed_by,
          confirmedAt: chosenSlot.confirmed_at,
          validUntil: chosenSlot.valid_until,
          version: chosenSlot.version,
          status: chosenSlot.status,
        },
        depositKrw: chosenSlot.deposit_krw,
        now: nowIso,
      });

      if (!offerVerification.ok) {
        return {
          ok: false,
          code: offerVerification.code,
          message: offerVerification.message,
        };
      }

      const verified = offerVerification.value;
      const latestProposal = await this.repository.getLatestProposal(
        actor.workspaceId,
        caseItem.id
      );
      const nextRevision = (latestProposal?.revision || 0) + 1;

      // Deterministic reply text. 예약금이 0원이면 예약금 안내 문장을 만들지 않는다.
      const depositNotice =
        verified.depositKrw > 0
          ? ` 예약금은 ${verified.depositKrw.toLocaleString()}원입니다.`
          : '';
      // The slot is stored as UTC; the customer must read it in the shop's timezone (D-7).
      const customerSlotTime = formatSlotTimeForCustomer({
        startsAt: verified.startsAt,
        timezone: verified.timezone,
      });
      const replyText = `안녕하세요 고객님! 문의주신 ${verified.serviceName} 예약 가능한 시간은 ${customerSlotTime}입니다.${depositNotice} 이 시간으로 예약 진행해 드릴까요?`;

      // 1. Thread sequence calculation
      const { data: threadMessages } = await this.client
        .from('instagram_dm_messages')
        .select('id, sent_at')
        .eq('workspace_id', actor.workspaceId)
        .eq('thread_id', caseItem.source_thread_id)
        .order('sent_at', { ascending: true });

      const seqIndex = (threadMessages || []).findIndex(
        (m: any) => m.id === caseItem.source_inbound_message_id
      );
      const sourceMessageSequence = seqIndex >= 0 ? seqIndex + 1 : 1;

      // 2. Verified Facts resolution via W8 Knowledge
      let facts: VerifiedReplyFactRef[] = [];
      try {
        const factSnapshot = await loadApprovedFactSnapshot(
          this.client as any,
          actor.workspaceId,
          nowIso
        );
        facts = (factSnapshot.facts || []).map((f) => ({
          factId: f.id,
          workspaceId: f.workspace_id,
          version: f.status,
          sourceRef: f.source_candidate_id || f.id,
          verifiedAt: f.approved_at,
          validFrom: f.valid_from,
          validUntil: f.valid_until,
        }));
      } catch {
        // Fallback if knowledge_facts query fails
      }

      if (!facts.length) {
        facts = [
          {
            factId: `fact-svc-${verified.serviceId}`,
            workspaceId: actor.workspaceId,
            version: verified.catalogVersion,
            sourceRef: `service:${verified.serviceId}`,
            verifiedAt: chosenSlot.confirmed_at,
            validFrom: chosenSlot.confirmed_at,
            validUntil: null,
          },
        ];
      }

      // 3. Construct canonical v2 ApprovedReplyDto
      const proposalId = randomUUID();
      const rawSnapshot: ApprovedReplyDto = {
        schemaVersion: 2,
        proposalId,
        revision: nextRevision,
        workspaceId: actor.workspaceId,
        caseId: caseItem.id,
        recipientRef: caseItem.customer_ref,
        sourceMessageId: caseItem.source_inbound_message_id,
        sourceMessageSequence,
        replyText,
        facts,
        catalogVersion: verified.catalogVersion,
        offer: {
          serviceId: verified.serviceId,
          serviceName: verified.serviceName,
          totalAmountKrw: verified.priceKrw,
          depositKrw: verified.depositKrw,
          slotId: verified.slotId,
          slotVersion: verified.slotVersion,
          startsAt: verified.startsAt,
          endsAt: verified.endsAt,
          timezone: verified.timezone,
        },
        validUntil: chosenSlot.valid_until,
        fingerprint: '',
      };

      const v2Fingerprint = approvedReplyFingerprint(rawSnapshot);
      const finalSnapshot: ApprovedReplyDto = { ...rawSnapshot, fingerprint: v2Fingerprint };

      // Fetch existing DM draft id if present
      const { data: existingDraft } = await this.client
        .from('instagram_dm_drafts')
        .select('id')
        .eq('workspace_id', actor.workspaceId)
        .eq('thread_id', caseItem.source_thread_id)
        .maybeSingle();

      // Save durable proposal snapshot with v2 fingerprint and full JSONB snapshot
      const savedProposal = await this.repository.saveProposal(actor, {
        id: proposalId,
        caseId: caseItem.id,
        revision: nextRevision,
        sourceInboundMessageId: caseItem.source_inbound_message_id,
        sourceThreadId: caseItem.source_thread_id,
        serviceId: verified.serviceId,
        catalogVersion: verified.catalogVersion,
        serviceName: verified.serviceName,
        totalAmountKrw: verified.priceKrw,
        depositKrw: verified.depositKrw,
        slotId: verified.slotId,
        slotVersion: verified.slotVersion,
        startsAt: verified.startsAt,
        endsAt: verified.endsAt,
        timezone: verified.timezone,
        availabilityConfirmedAt: chosenSlot.confirmed_at,
        validUntil: chosenSlot.valid_until,
        dmDraftId: existingDraft?.id ?? null,
        replyText,
        payloadFingerprint: v2Fingerprint,
        approvedReplySnapshot: finalSnapshot as any,
      });

      // Transition case stage to DRAFT_READY with v2 fingerprint
      const updatedCase = await this.repository.transitionCase(actor, {
        caseId: caseItem.id,
        expectedVersion: params.expectedVersion,
        nextStage: 'DRAFT_READY',
        stepKind: 'PREPARE_REPLY',
        fingerprint: v2Fingerprint,
        idempotencyKey: `prepare:${caseItem.id}:${nextRevision}`,
      });

      return {
        ok: true,
        value: createRecoveryView({ caseItem: updatedCase, proposal: savedProposal }),
      };
    } catch (error: any) {
      if (error instanceof BookingRecoveryRepositoryError) {
        return {
          ok: false,
          code: (error.code as any) || 'INTERNAL_ERROR',
          message: error.message,
        };
      }
      return {
        ok: false,
        code: 'INTERNAL_ERROR' as any,
        message: error?.message || '답변 초안 생성 실패',
      };
    }
  }

  private createDefaultLoadApprovedReply(): LoadApprovedReply {
    return async (workspaceId: string, caseId: string): Promise<ApprovedReplyDto | null> => {
      const proposal = await this.repository.getLatestProposal(workspaceId, caseId);
      if (!proposal) return null;

      const snapshot = proposal.approved_reply_snapshot as ApprovedReplyDto | null | undefined;
      if (!snapshot || snapshot.schemaVersion !== 2) return null;

      const caseItem = await this.repository.getCase(workspaceId, caseId);
      if (!caseItem) return null;

      if (
        caseItem.workspace_id !== workspaceId ||
        caseItem.id !== caseId ||
        caseItem.source_inbound_message_id !== snapshot.sourceMessageId ||
        caseItem.customer_ref !== snapshot.recipientRef
      ) {
        return null;
      }

      const { data: threadMessages, error: msgError } = await this.client
        .from('instagram_dm_messages')
        .select('id, sender_type, sent_at')
        .eq('workspace_id', workspaceId)
        .eq('thread_id', caseItem.source_thread_id)
        .order('sent_at', { ascending: true });

      if (msgError || !threadMessages?.length) return null;

      const customerMsgs = threadMessages.filter((m: any) => m.sender_type === 'customer');
      const latestCustomerMsg = customerMsgs[customerMsgs.length - 1];
      if (!latestCustomerMsg || latestCustomerMsg.id !== caseItem.source_inbound_message_id) {
        return null;
      }

      // Fresh Fact validation via W8 resolver
      try {
        const currentFactSnapshot = await loadApprovedFactSnapshot(
          this.client as any,
          workspaceId,
          new Date().toISOString()
        );
        for (const factRef of snapshot.facts) {
          const currentFact = currentFactSnapshot.facts.find((f) => f.id === factRef.factId);
          if (!currentFact) return null;
          if (currentFact.valid_until && Date.parse(currentFact.valid_until) <= Date.now()) {
            return null;
          }
        }
      } catch {
        // If facts cannot be validated, proceed with snapshot validation
      }

      if (!validateApprovedReply(snapshot, snapshot.fingerprint)) {
        return null;
      }

      return snapshot;
    };
  }

  /**
   * Approves sending the reply proposal.
   */
  public async approveSend(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      fingerprint: string;
    }
  ): Promise<RecoveryResult<RecoveryView>> {
    try {
      const caseItem = await this.repository.getCase(actor.workspaceId, params.caseId);
      if (!caseItem) {
        return { ok: false, code: 'NOT_FOUND', message: '케이스를 찾을 수 없습니다.' };
      }
      if (caseItem.workspace_id !== actor.workspaceId || caseItem.id !== params.caseId) {
        return { ok: false, code: 'FORBIDDEN', message: '이 문의에 접근할 수 없습니다.' };
      }
      if (caseItem.version !== params.expectedVersion) {
        return { ok: false, code: 'VERSION_CONFLICT', message: '이미 처리 중이거나 변경된 문의입니다. 다시 확인해 주세요.' };
      }

      const proposal = await this.repository.getLatestProposal(actor.workspaceId, caseItem.id);
      if (!proposal) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '승인할 제안 초안이 존재하지 않습니다.',
        };
      }

      // 1. Resolve loader (fail-closed if neither injected nor constructable)
      const loadApprovedReply = this.dmDeps?.loadApprovedReply ?? this.createDefaultLoadApprovedReply();
      if (!loadApprovedReply) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '답변의 최신 정보 확인이 필요합니다. 다시 검토해 주세요.',
        };
      }

      // 2. Fresh resolution & v2 verification
      let approvedSnapshot: ApprovedReplyDto | null = null;
      try {
        approvedSnapshot = await loadApprovedReply(actor.workspaceId, caseItem.id);
      } catch {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '최신 정보를 조회할 수 없습니다. 다시 확인해 주세요.',
        };
      }

      if (!approvedSnapshot) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '답변의 최신 정보 확인이 필요합니다. 다시 검토해 주세요.',
        };
      }

      if (!validateApprovedReply(approvedSnapshot, params.fingerprint)) {
        return {
          ok: false,
          code: 'VERSION_CONFLICT',
          message: '승인 내용의 지문이 현재 제안 내용과 일치하지 않습니다.',
        };
      }

      // Match snapshot with proposal & case
      const matchesProposal = (reply: ApprovedReplyDto): boolean => {
        const offer = reply.offer;
        return (
          reply.workspaceId === actor.workspaceId &&
          proposal.workspace_id === actor.workspaceId &&
          proposal.case_id === caseItem.id &&
          reply.caseId === caseItem.id &&
          reply.proposalId === proposal.id &&
          reply.revision === proposal.revision &&
          reply.recipientRef === caseItem.customer_ref &&
          reply.sourceMessageId === caseItem.source_inbound_message_id &&
          reply.sourceMessageId === proposal.source_inbound_message_id &&
          reply.replyText === proposal.reply_text &&
          reply.catalogVersion === proposal.catalog_version &&
          reply.validUntil === proposal.valid_until &&
          reply.fingerprint === proposal.payload_fingerprint &&
          !!offer &&
          offer.serviceId === proposal.service_id &&
          offer.serviceName === proposal.service_name &&
          offer.totalAmountKrw === proposal.total_amount_krw &&
          offer.depositKrw === proposal.deposit_krw &&
          offer.slotId === proposal.slot_id &&
          offer.slotVersion === proposal.slot_version &&
          offer.startsAt === proposal.starts_at &&
          offer.endsAt === proposal.ends_at &&
          offer.timezone === proposal.timezone
        );
      };

      if (!matchesProposal(approvedSnapshot)) {
        return {
          ok: false,
          code: 'VERSION_CONFLICT',
          message: '승인 지문이 제안 내용과 일치하지 않습니다.',
        };
      }

      // W5 Contract 3: Atomic transition to AWAITING_SEND_APPROVAL & durable SEND approval in 1 DB transaction
      const approveResult = await this.repository.approveAndTransition(actor, {
        caseId: caseItem.id,
        expectedVersion: params.expectedVersion,
        fingerprint: params.fingerprint,
        idempotencyKey: `approve_send:${caseItem.id}:${params.expectedVersion}`,
      });
      const updatedCase = approveResult.case;
      const approvalId = approveResult.approvalId;

      // Default fingerprint and draft loaders to bound DM draft
      const loadCurrentFingerprint =
        this.dmDeps?.loadCurrentFingerprint ||
        (async (_caseId: string) => {
          if (!proposal.dm_draft_id) return null;
          const { data: d } = await this.client
            .from('instagram_dm_drafts')
            .select('approved_fingerprint, draft_text')
            .eq('workspace_id', actor.workspaceId)
            .eq('id', proposal.dm_draft_id)
            .maybeSingle();
          return d?.approved_fingerprint || null;
        });

      const loadCurrentDraft =
        this.dmDeps?.loadCurrentDraft ||
        (async (_caseId: string) => {
          if (!proposal.dm_draft_id) return null;
          const { data: d } = await this.client
            .from('instagram_dm_drafts')
            .select('id, draft_text')
            .eq('workspace_id', actor.workspaceId)
            .eq('id', proposal.dm_draft_id)
            .maybeSingle();
          return d ? { draftText: d.draft_text, dmDraftId: d.id } : null;
        });

      // Execute send chain through dm-adapter
      // W5-W4-wiring.md 4절 6~8번: loadApprovedReply 함수 자체를 전달 (cached DTO 반환 금지)
      const sendRes = await approveAndSendReply(
        actor,
        {
          caseId: caseItem.id,
          expectedVersion: approveResult.authorizedCaseVersion,
          fingerprint: params.fingerprint,
          approvalId,
        },
        {
          ...this.dmDeps,
          repository: this.repository,
          client: this.client,
          loadApprovedReply,
          loadCurrentFingerprint,
          loadCurrentDraft,
        }
      );

      // If send execution resulted in a deterministic error, propagate it
      if (!sendRes.ok) {
        return {
          ok: false,
          code: sendRes.code,
          message: sendRes.message,
        };
      }

      // Fetch fresh case view after send chain
      const latestCase = (await this.repository.getCase(actor.workspaceId, caseItem.id)) || updatedCase;

      return {
        ok: true,
        value: createRecoveryView({ caseItem: latestCase, proposal }),
      };
    } catch (error: any) {
      if (error instanceof BookingRecoveryRepositoryError) {
        return {
          ok: false,
          code: (error.code as any) || 'INTERNAL_ERROR',
          message: error.message,
        };
      }
      return {
        ok: false,
        code: 'INTERNAL_ERROR' as any,
        message: error?.message || '답변 발송 승인 실패',
      };
    }
  }

  /**
   * Confirms customer acceptance of the proposed slot and service.
   */
  public async confirmAcceptance(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      inboundMessageId: string;
      slotId: string;
    }
  ): Promise<RecoveryResult<RecoveryView>> {
    try {
      const caseItem = await this.repository.getCase(actor.workspaceId, params.caseId);
      if (!caseItem) {
        return { ok: false, code: 'NOT_FOUND', message: '케이스를 찾을 수 없습니다.' };
      }

      if (caseItem.stage !== 'AWAITING_CUSTOMER') {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '고객 답변 대기 상태가 아니거나 아직 제안이 발송되지 않았습니다.',
        };
      }

      const proposal = await this.repository.getLatestProposal(actor.workspaceId, caseItem.id);
      if (!proposal) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '연결된 제안 정보가 없습니다.',
        };
      }

      if (proposal.slot_id !== params.slotId) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '수락된 슬롯이 제안된 슬롯과 일치하지 않습니다.',
        };
      }

      const msg = await this.repository.getInboundMessage(
        actor.workspaceId,
        params.inboundMessageId
      );
      if (!msg) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: '수락 메시지를 찾을 수 없습니다.',
        };
      }

      if (msg.thread_id !== caseItem.source_thread_id) {
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: '수락 메시지의 대화 스레드가 케이스와 일치하지 않습니다.',
        };
      }

      if (msg.sender_type !== 'customer' || msg.sender_id !== caseItem.customer_ref) {
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: '수락 메시지의 발신자가 문의 고객과 일치하지 않습니다.',
        };
      }

      const delivery = await loadCustomerAcceptanceEvidence(this.client, {
        workspaceId: actor.workspaceId,
        caseId: caseItem.id,
        threadId: caseItem.source_thread_id,
        fingerprint: proposal.payload_fingerprint,
        customerRef: caseItem.customer_ref,
        message: { id: msg.id, senderId: msg.sender_id, senderType: msg.sender_type, sentAt: msg.sent_at },
      });
      if (!delivery.ok) return delivery;

      if (!acceptsUnchangedTerms(msg.text)) {
        return {
          ok: false, code: 'CONTEXT_REQUIRED',
          message: '제안한 조건 그대로 수락한 답변인지 확인이 필요합니다. 날짜·시간·서비스·인원을 바꾸려는 답변은 다시 확인해 주세요.',
        };
      }

      // Acceptance must follow independent delivery, not merely proposal creation.
      const acceptanceProposal = {
        customerRef: caseItem.customer_ref,
        sentAt: delivery.value.observedAt,
        serviceName: proposal.service_name,
        timezone: proposal.timezone,
        slots: [
          {
            id: proposal.slot_id,
            label: proposal.starts_at.slice(0, 16),
            startsAt: proposal.starts_at,
          },
        ],
      };

      const classification = classifyAcceptance({
        message: {
          id: msg.id,
          customerRef: msg.sender_id,
          senderType: msg.sender_type as any,
          text: msg.text,
          sentAt: msg.sent_at,
        },
        proposal: acceptanceProposal,
      });

      if (classification.kind !== 'accepted' || classification.slotId !== params.slotId) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message:
            classification.kind === 'needs_review'
              ? classification.reason
              : '고객의 예약 수락 의사가 명확하지 않거나 제안된 슬롯과 일치하지 않습니다.',
        };
      }

      // transition_booking_recovery binds evidence_ref and stage under the same CAS.
      const updatedCase = await this.repository.transitionCase(actor, {
        caseId: caseItem.id,
        expectedVersion: params.expectedVersion,
        nextStage: 'CUSTOMER_ACCEPTED',
        stepKind: 'CONFIRM_ACCEPTANCE',
        fingerprint: proposal.payload_fingerprint,
        idempotencyKey: `accept:${caseItem.id}:${params.expectedVersion}`,
        evidenceRef: params.inboundMessageId,
      });

      return {
        ok: true,
        value: createRecoveryView({
          caseItem: { ...updatedCase, accepted_inbound_message_id: params.inboundMessageId },
          proposal,
        }),
      };
    } catch (error: any) {
      if (error instanceof BookingRecoveryRepositoryError) {
        return {
          ok: false,
          code: (error.code as any) || 'INTERNAL_ERROR',
          message: error.message,
        };
      }
      return {
        ok: false,
        code: 'INTERNAL_ERROR' as any,
        message: error?.message || '고객 수락 확인 실패',
      };
    }
  }

  /**
   * Approves booking and commits reservation atomically.
   */
  public async approveBooking(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      fingerprint: string;
    }
  ): Promise<RecoveryResult<RecoveryView>> {
    try {
      const caseItem = await this.repository.getCase(actor.workspaceId, params.caseId);
      if (!caseItem) {
        return { ok: false, code: 'NOT_FOUND', message: '케이스를 찾을 수 없습니다.' };
      }

      if (!caseItem.accepted_inbound_message_id) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '검증된 고객 수락 메시지 근거가 존재하지 않아 예약을 확정할 수 없습니다.',
        };
      }

      const proposal = await this.repository.getLatestProposal(actor.workspaceId, caseItem.id);
      if (!proposal) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '연결된 제안 정보가 없습니다.',
        };
      }

      const expectedTuple = {
        workspaceId: actor.workspaceId,
        caseId: caseItem.id,
        slotId: proposal.slot_id,
        serviceId: proposal.service_id,
        totalAmountKrw: proposal.total_amount_krw,
        depositKrw: proposal.deposit_krw,
        customerRef: caseItem.customer_ref,
        acceptedMessageId: caseItem.accepted_inbound_message_id,
        proposalRevision: proposal.revision,
        catalogVersion: proposal.catalog_version,
        slotVersion: proposal.slot_version,
      };

      const isValidFingerprint = verifyBookingApprovalFingerprint(
        expectedTuple,
        params.fingerprint
      );

      if (!isValidFingerprint) {
        return {
          ok: false,
          code: 'VERSION_CONFLICT',
          message: '예약 승인 지문이 현재 제안 내용 및 수락 근거와 일치하지 않습니다.',
        };
      }

      const acceptance = await this.repository.getInboundMessage(actor.workspaceId, caseItem.accepted_inbound_message_id);
      if (!acceptance || acceptance.thread_id !== caseItem.source_thread_id || !acceptsUnchangedTerms(acceptance.text)) {
        return { ok: false, code: 'CONTEXT_REQUIRED', message: '고객 수락의 원본 대화를 다시 확인해 주세요.' };
      }

      // A fresh ledger attestation may renew a version without changing accepted terms.
      // Resolve the immutable offer actually present when the customer accepted it.
      const { data: acceptedProposal, error: acceptedProposalError } = await this.client
        .from('booking_recovery_proposals').select('*')
        .eq('workspace_id', actor.workspaceId).eq('case_id', caseItem.id)
        .lte('created_at', acceptance.sent_at).order('revision', { ascending: false }).limit(1).maybeSingle();
      if (acceptedProposalError) {
        return { ok: false, code: 'INTERNAL_ERROR', message: '고객이 수락한 제안을 조회하지 못했습니다.' };
      }
      const sameTime = (a: string, b: string) => Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
      if (!acceptedProposal ||
        acceptedProposal.service_id !== proposal.service_id || acceptedProposal.slot_id !== proposal.slot_id ||
        acceptedProposal.total_amount_krw !== proposal.total_amount_krw || acceptedProposal.deposit_krw !== proposal.deposit_krw ||
        acceptedProposal.timezone !== proposal.timezone ||
        !sameTime(acceptedProposal.starts_at, proposal.starts_at) || !sameTime(acceptedProposal.ends_at, proposal.ends_at)) {
        return { ok: false, code: 'CONTEXT_REQUIRED', message: '고객이 수락한 예약 조건이 변경되었습니다. 다시 동의를 받아 주세요.' };
      }
      const delivery = await loadCustomerAcceptanceEvidence(this.client, {
        workspaceId: actor.workspaceId, caseId: caseItem.id, threadId: caseItem.source_thread_id,
        fingerprint: acceptedProposal.payload_fingerprint, customerRef: caseItem.customer_ref,
        message: { id: acceptance.id, senderId: acceptance.sender_id, senderType: acceptance.sender_type, sentAt: acceptance.sent_at },
      });
      if (!delivery.ok) return delivery;

      // Save durable booking approval only after fresh independent acceptance proof.
      await this.repository.saveApproval(actor, {
        caseId: caseItem.id,
        stepKind: 'BOOK',
        payloadFingerprint: params.fingerprint,
        caseVersion: params.expectedVersion,
        sourceMessageId: caseItem.accepted_inbound_message_id,
        catalogVersion: proposal.catalog_version,
        slotVersion: proposal.slot_version,
        expiresAt: proposal.valid_until,
      });

      // Commit reservation atomically via server RPC
      const confirmResult = await this.repository.confirmBooking(actor, {
        caseId: caseItem.id,
        expectedVersion: params.expectedVersion,
        proposalRevision: proposal.revision,
        inboundAcceptanceMessageId: caseItem.accepted_inbound_message_id,
        fingerprint: params.fingerprint,
      });

      return {
        ok: true,
        value: createRecoveryView({
          caseItem: confirmResult.case,
          proposal,
          booking: {
            id: confirmResult.reservation_id,
            confirmedAt: new Date(confirmResult.confirmed_at).toISOString(),
          },
        }),
      };
    } catch (error: any) {
      if (error instanceof BookingRecoveryRepositoryError) {
        return {
          ok: false,
          code: (error.code as any) || 'INTERNAL_ERROR',
          message: error.message,
        };
      }
      return {
        ok: false,
        code: 'INTERNAL_ERROR' as any,
        message: error?.message || '예약 확정 실패',
      };
    }
  }

  /**
   * Owner reattests schedule after 15-minute slot TTL expires.
   * - If same service/price/time/deposit: customer acceptance is preserved, owner reattestation creates a new slot version & proposal revision with fresh validUntil and booking approval fingerprint.
   * - If terms changed: customer acceptance is invalidated (cleared) and customer must re-accept.
   */
  public async reattestSchedule(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      slotId?: string;
    }
  ): Promise<RecoveryResult<RecoveryView>> {
    try {
      const caseItem = await this.repository.getCase(actor.workspaceId, params.caseId);
      if (!caseItem) {
        return { ok: false, code: 'NOT_FOUND', message: '케이스를 찾을 수 없습니다.' };
      }

      if (caseItem.version !== params.expectedVersion) {
        return {
          ok: false,
          code: 'VERSION_CONFLICT',
          message: `버전 충돌: 최신 상태가 아닙니다. (요청: ${params.expectedVersion}, 현재: ${caseItem.version})`,
        };
      }

      const prevProposal = await this.repository.getLatestProposal(actor.workspaceId, caseItem.id);
      if (!prevProposal) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '기존 제안 정보가 없습니다.',
        };
      }

      // Target slot: explicitly requested slotId or previous proposal's slot
      const targetSlotId = params.slotId || prevProposal.slot_id;
      const { data: slotRow, error: slotErr } = await this.client
        .from('booking_recovery_slots')
        .select('*')
        .eq('workspace_id', actor.workspaceId)
        .eq('id', targetSlotId)
        .maybeSingle();

      if (slotErr || !slotRow) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: '재확인할 슬롯 정보를 찾을 수 없습니다.',
        };
      }

      if (slotRow.status !== 'AVAILABLE') {
        return {
          ok: false,
          code: 'SLOT_CONFLICT',
          message: '이미 확정되었거나 철회된 시간은 재확인으로 다시 열 수 없습니다.',
        };
      }

      const nowMs = Date.now();
      const startMs = new Date(slotRow.starts_at).getTime();
      if (startMs <= nowMs) {
        return {
          ok: false,
          code: 'SLOT_CONFLICT',
          message: '이미 시작 시각이 지난 슬롯은 재확인할 수 없습니다. 새로운 가용 시간을 등록해 주세요.',
        };
      }

      // Renew slot TTL: 15 minutes from now or until start
      const newValidUntil = new Date(Math.min(nowMs + 15 * 60 * 1000, startMs)).toISOString();
      const newConfirmedAt = new Date().toISOString();

      const { data: renewedRow, error: renewErr } = await this.client
        .from('booking_recovery_slots')
        .update({
          valid_until: newValidUntil,
          confirmed_at: newConfirmedAt,
          confirmed_by: actor.userId,
          status: 'AVAILABLE',
          version: slotRow.version + 1,
        })
        .eq('workspace_id', actor.workspaceId)
        .eq('id', slotRow.id)
        .eq('version', slotRow.version)
        .eq('status', 'AVAILABLE')
        .select('id')
        .maybeSingle();

      if (renewErr) {
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: `슬롯 재확인 실패: ${renewErr.message || 'DB 오류'}`,
        };
      }

      if (!renewedRow) {
        return {
          ok: false,
          code: 'SLOT_CONFLICT',
          message: '예약 시간이 변경되었습니다. 최신 장부를 다시 확인해 주세요.',
        };
      }

      const renewedSlot = {
        ...slotRow,
        valid_until: newValidUntil,
        confirmed_at: newConfirmedAt,
        confirmed_by: actor.userId,
        status: 'AVAILABLE',
        version: slotRow.version + 1,
      };

      // Verify active catalog service and price
      const { data: catalogService, error: catErr } = await this.client
        .from('workspace_products_services')
        .select('*')
        .eq('workspace_id', actor.workspaceId)
        .eq('id', renewedSlot.service_id)
        .maybeSingle();

      // The catalog table has no free-form metadata column; duration_minutes is the only source of truth.
      const durationMinutes = catalogService?.duration_minutes ?? null;

      if (
        catErr ||
        !catalogService ||
        !catalogService.active ||
        !Number.isSafeInteger(catalogService.price) ||
        catalogService.price < 0
      ) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '카탈로그 서비스가 비활성화되었거나 가격이 유효하지 않습니다.',
        };
      }

      if (
        durationMinutes === null ||
        durationMinutes === undefined ||
        !Number.isSafeInteger(durationMinutes) ||
        durationMinutes <= 0
      ) {
        return {
          ok: false,
          code: 'CONTEXT_REQUIRED',
          message: '서비스 소요시간이 설정되지 않았습니다. 카탈로그에서 소요시간을 먼저 설정해 주세요.',
        };
      }

      const slotDurationMinutes = Math.floor(
        (new Date(renewedSlot.ends_at).getTime() - new Date(renewedSlot.starts_at).getTime()) /
          (60 * 1000)
      );
      if (slotDurationMinutes < durationMinutes) {
        return {
          ok: false,
          code: 'SLOT_CONFLICT',
          message: `선택한 슬롯 시간(${slotDurationMinutes}분)이 서비스 소요시간(${durationMinutes}분)보다 짧습니다.`,
        };
      }

      const isSameTerms =
        renewedSlot.service_id === prevProposal.service_id &&
        new Date(renewedSlot.starts_at).getTime() === new Date(prevProposal.starts_at).getTime() &&
        new Date(renewedSlot.ends_at).getTime() === new Date(prevProposal.ends_at).getTime() &&
        renewedSlot.deposit_krw === prevProposal.deposit_krw &&
        catalogService.price === prevProposal.total_amount_krw;

      const nextRevision = prevProposal.revision + 1;

      // Construct v2 ApprovedReplyDto for reattestation
      const prevSnapshot = prevProposal.approved_reply_snapshot as ApprovedReplyDto | null | undefined;
      const reattestFacts = (prevSnapshot && prevSnapshot.facts?.length) ? prevSnapshot.facts : [
        {
          factId: `fact-svc-${catalogService.id}`,
          workspaceId: actor.workspaceId,
          version: catalogService.updated_at,
          sourceRef: `service:${catalogService.id}`,
          verifiedAt: renewedSlot.confirmed_at,
          validFrom: renewedSlot.confirmed_at,
          validUntil: null,
        },
      ];

      const reattestProposalId = randomUUID();
      const rawReattestSnapshot: ApprovedReplyDto = {
        schemaVersion: 2,
        proposalId: reattestProposalId,
        revision: nextRevision,
        workspaceId: actor.workspaceId,
        caseId: caseItem.id,
        recipientRef: caseItem.customer_ref,
        sourceMessageId: caseItem.source_inbound_message_id,
        sourceMessageSequence: prevSnapshot?.sourceMessageSequence ?? 1,
        replyText: prevProposal.reply_text,
        facts: reattestFacts,
        catalogVersion: catalogService.updated_at,
        offer: {
          serviceId: catalogService.id,
          serviceName: catalogService.name,
          totalAmountKrw: catalogService.price,
          depositKrw: renewedSlot.deposit_krw,
          slotId: renewedSlot.id,
          slotVersion: renewedSlot.version,
          startsAt: renewedSlot.starts_at,
          endsAt: renewedSlot.ends_at,
          timezone: renewedSlot.timezone || 'Asia/Seoul',
        },
        validUntil: renewedSlot.valid_until,
        fingerprint: '',
      };

      const newFingerprint = approvedReplyFingerprint(rawReattestSnapshot);
      const finalReattestSnapshot: ApprovedReplyDto = {
        ...rawReattestSnapshot,
        fingerprint: newFingerprint,
      };

      await this.repository.saveProposal(actor, {
        id: reattestProposalId,
        caseId: caseItem.id,
        revision: nextRevision,
        sourceInboundMessageId: prevProposal.source_inbound_message_id,
        sourceThreadId: prevProposal.source_thread_id,
        serviceId: catalogService.id,
        catalogVersion: catalogService.updated_at,
        serviceName: catalogService.name,
        totalAmountKrw: catalogService.price,
        depositKrw: renewedSlot.deposit_krw,
        slotId: renewedSlot.id,
        slotVersion: renewedSlot.version,
        startsAt: renewedSlot.starts_at,
        endsAt: renewedSlot.ends_at,
        timezone: renewedSlot.timezone || 'Asia/Seoul',
        availabilityConfirmedAt: renewedSlot.confirmed_at,
        validUntil: renewedSlot.valid_until,
        dmDraftId: prevProposal.dm_draft_id ?? null,
        replyText: prevProposal.reply_text,
        payloadFingerprint: newFingerprint,
        approvedReplySnapshot: finalReattestSnapshot as any,
      });

      let nextStage: any;
      let preservedAcceptanceId: string | null = null;

      if (isSameTerms && caseItem.accepted_inbound_message_id) {
        preservedAcceptanceId = caseItem.accepted_inbound_message_id;
        nextStage = 'AWAITING_BOOKING_APPROVAL';
      } else {
        preservedAcceptanceId = null;
        nextStage = 'DRAFT_READY';
        await this.client
          .from('booking_recovery_cases')
          .update({ accepted_inbound_message_id: null })
          .eq('workspace_id', actor.workspaceId)
          .eq('id', caseItem.id);
      }

      const updatedCase = await this.repository.transitionCase(actor, {
        caseId: caseItem.id,
        expectedVersion: params.expectedVersion,
        nextStage,
        stepKind: 'REATTEST_SCHEDULE',
        fingerprint: newFingerprint,
        idempotencyKey: `reattest:${caseItem.id}:${params.expectedVersion}`,
        evidenceRef: renewedSlot.id,
      });

      const latestProposal = await this.repository.getLatestProposal(actor.workspaceId, caseItem.id);

      // Look up customer acceptance message sent_at if preserved
      let acceptanceSentAt: string | null = null;
      if (preservedAcceptanceId) {
        const { data: msgRow } = await this.client
          .from('instagram_dm_messages')
          .select('sent_at')
          .eq('workspace_id', actor.workspaceId)
          .eq('id', preservedAcceptanceId)
          .maybeSingle();
        if (msgRow?.sent_at) {
          acceptanceSentAt = new Date(msgRow.sent_at).toISOString();
        }
      }

      return {
        ok: true,
        value: createRecoveryView({
          caseItem: { ...updatedCase, accepted_inbound_message_id: preservedAcceptanceId },
          proposal: latestProposal,
          acceptanceSentAt,
        }),
      };
    } catch (error: any) {
      if (error instanceof BookingRecoveryRepositoryError) {
        return {
          ok: false,
          code: (error.code as any) || 'INTERNAL_ERROR',
          message: error.message,
        };
      }
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: error?.message || '장부 재확인 실패',
      };
    }
  }

  /**
   * Retrieves a single case read view.
   */
  public async getCaseView(
    workspaceId: string,
    caseId: string
  ): Promise<RecoveryView | null> {
    const caseItem = await this.repository.getCase(workspaceId, caseId);
    if (!caseItem) return null;

    const proposal = await this.repository.getLatestProposal(workspaceId, caseId);

    // 1. Authoritative DB restoration of booking
    let booking: { id: string; confirmedAt: string; status?: 'CONFIRMED' | 'CANCELLED' } | null = null;
    const { data: resRow } = await this.client
      .from('reservations')
      .select('id, confirmed_at, status')
      .eq('workspace_id', workspaceId)
      .eq('metadata->>caseId', caseId)
      .order('confirmed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resRow) {
      booking = {
        id: resRow.id,
        confirmedAt: new Date(resRow.confirmed_at).toISOString(),
        status: resRow.status,
      };
    }

    // 2. Authoritative DB lookup of customer message sent_at
    let acceptanceSentAt: string | null = null;
    if (caseItem.accepted_inbound_message_id) {
      const { data: msgRow } = await this.client
        .from('instagram_dm_messages')
        .select('sent_at')
        .eq('workspace_id', workspaceId)
        .eq('id', caseItem.accepted_inbound_message_id)
        .maybeSingle();
      if (msgRow?.sent_at) {
        acceptanceSentAt = new Date(msgRow.sent_at).toISOString();
      }
    }

    return createRecoveryView({ caseItem, proposal, booking, acceptanceSentAt });
  }

  /**
   * Lists case read views for workspace.
   */
  public async listCaseViews(
    workspaceId: string,
    limit: number = 20
  ): Promise<RecoveryView[]> {
    const cases = await this.repository.listCases(workspaceId, limit);
    const views: RecoveryView[] = [];

    for (const c of cases) {
      const proposal = await this.repository.getLatestProposal(workspaceId, c.id);

      let booking: { id: string; confirmedAt: string; status?: 'CONFIRMED' | 'CANCELLED' } | null = null;
      const { data: resRow } = await this.client
        .from('reservations')
        .select('id, confirmed_at, status')
        .eq('workspace_id', workspaceId)
        .eq('metadata->>caseId', c.id)
        .order('confirmed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (resRow) {
        booking = {
          id: resRow.id,
          confirmedAt: new Date(resRow.confirmed_at).toISOString(),
          status: resRow.status,
        };
      }

      let acceptanceSentAt: string | null = null;
      if (c.accepted_inbound_message_id) {
        const { data: msgRow } = await this.client
          .from('instagram_dm_messages')
          .select('sent_at')
          .eq('workspace_id', workspaceId)
          .eq('id', c.accepted_inbound_message_id)
          .maybeSingle();
        if (msgRow?.sent_at) {
          acceptanceSentAt = new Date(msgRow.sent_at).toISOString();
        }
      }

      views.push(createRecoveryView({ caseItem: c, proposal, booking, acceptanceSentAt }));
    }

    return views;
  }
}
