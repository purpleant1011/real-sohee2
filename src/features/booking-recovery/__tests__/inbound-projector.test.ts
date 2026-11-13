import { describe, it, expect, vi } from 'vitest';
import { classifyAcceptance } from '../inbound-projector';

describe('Booking Recovery Inbound Projector', () => {
  const proposalSingleSlot = {
    customerRef: 'cust_1',
    sentAt: '2026-10-16T01:00:00Z',
    serviceName: '맞춤 펌',
    slots: [{ id: 's1', label: '목요일 16시', startsAt: '2026-10-22T16:00:00+09:00' }],
  };

  const proposalMultiSlot = {
    customerRef: 'cust_1',
    sentAt: '2026-10-16T01:00:00Z',
    serviceName: '맞춤 펌',
    slots: [
      { id: 's1', label: '목요일 16시', startsAt: '2026-10-22T16:00:00+09:00' },
      { id: 's2', label: '금요일 14시', startsAt: '2026-10-23T14:00:00+09:00' },
    ],
  };

  it.each(['예약 안 할게요', '그 시간은 불가능해요', '예약 취소할게요', '네, 그런데 가격이 얼마죠?', '예약 가능한가요?', '좋아요, 다른 시간으로 할게요', '네'])('명시 수락이 아닌 문장 자동 확정 금지: %s', (text) => {
    expect(classifyAcceptance({ message: { id: 'm2', customerRef: 'cust_1', senderType: 'customer',
      text, sentAt: '2026-10-16T02:00:00Z' }, proposal: proposalSingleSlot }).kind).not.toBe('accepted');
  });

  it('둘 중 어느 시간인지 모르는 "네"는 수락 근거가 아니다 (needs_review)', () => {
    const result = classifyAcceptance({
      message: {
        id: 'm2',
        customerRef: 'cust_1',
        senderType: 'customer',
        text: '네',
        sentAt: '2026-10-16T02:00:00Z',
      },
      proposal: proposalMultiSlot,
    });
    expect(result).toMatchObject({ kind: 'needs_review' });
  });

  it('제안 발송 이전의 과거 메시지는 수락으로 처리하지 않는다 (ignored)', () => {
    const result = classifyAcceptance({
      message: {
        id: 'm1',
        customerRef: 'cust_1',
        senderType: 'customer',
        text: '목요일 16시로 할게요',
        sentAt: '2026-10-16T00:50:00Z',
      },
      proposal: proposalSingleSlot,
    });
    expect(result).toMatchObject({ kind: 'ignored' });
  });

  it('다른 고객(customerRef 불일치)의 메시지는 수락으로 처리하지 않는다 (ignored)', () => {
    const result = classifyAcceptance({
      message: {
        id: 'm2',
        customerRef: 'cust_other',
        senderType: 'customer',
        text: '목요일 16시로 할게요',
        sentAt: '2026-10-16T02:00:00Z',
      },
      proposal: proposalSingleSlot,
    });
    expect(result).toMatchObject({ kind: 'ignored' });
  });

  it('비즈니스(사장님/시스템)가 보낸 에코 발화는 수락 근거가 아니다 (ignored)', () => {
    const result = classifyAcceptance({
      message: {
        id: 'm2',
        customerRef: 'cust_1',
        senderType: 'business',
        text: '목요일 16시로 예약해 드립니다',
        sentAt: '2026-10-16T02:00:00Z',
      },
      proposal: proposalSingleSlot,
    });
    expect(result).toMatchObject({ kind: 'ignored' });
  });

  it('단일 제안 슬롯에 대한 명시적 긍정 수락은 accepted로 분류된다', () => {
    const result = classifyAcceptance({
      message: {
        id: 'm2',
        customerRef: 'cust_1',
        senderType: 'customer',
        text: '네 그 시간으로 예약해 주세요!',
        sentAt: '2026-10-16T02:00:00Z',
      },
      proposal: proposalSingleSlot,
    });
    expect(result).toMatchObject({ kind: 'accepted', slotId: 's1' });
  });

  it('복수 슬롯 중 특정 시간 라벨을 명시하여 수락한 경우 해당 slotId로 accepted 처리된다', () => {
    const result = classifyAcceptance({
      message: {
        id: 'm2',
        customerRef: 'cust_1',
        senderType: 'customer',
        text: '금요일 14시로 진행할게요',
        sentAt: '2026-10-16T02:00:00Z',
      },
      proposal: proposalMultiSlot,
    });
    expect(result).toMatchObject({ kind: 'accepted', slotId: 's2' });
  });

  it('projectInboundMessageToRecovery: 수신 메시지가 활성 케이스 제안과 일치하면 케이스 상태를 CUSTOMER_ACCEPTED로 전이하고 outbox를 등록한다', async () => {
    const { projectInboundMessageToRecovery } = await import('../inbound-projector');

    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });

    const rpcSpy = vi.fn().mockResolvedValue({ data: { id: 'case_1', stage: 'CUSTOMER_ACCEPTED' }, error: null });
    const mockSupabase = {
      rpc: rpcSpy,
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'booking_recovery_cases') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'case_1',
                workspace_id: 'ws_1',
                source_thread_id: 'th_1',
                customer_ref: 'cust_1',
                stage: 'AWAITING_CUSTOMER',
                version: 2,
              },
              error: null,
            }),
            update: updateSpy,
          };
        }
        if (table === 'booking_recovery_proposals') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                workspace_id: 'ws_1',
                case_id: 'case_1',
                payload_fingerprint: 'a'.repeat(64),
                revision: 1,
                slot_id: 's1',
                service_name: '맞춤 펌',
                starts_at: '2026-10-22T16:00:00+09:00',
                created_at: '2026-10-16T01:00:00Z',
              },
              error: null,
            }),
          };
        }
        if (table === 'booking_recovery_steps') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: {
              workspace_id: 'ws_1', case_id: 'case_1', actor_id: 'owner_1',
              provider_message_id: 'provider_1', input_fingerprint: 'a'.repeat(64),
              occurred_at: '2026-10-16T01:10:00Z',
              evidence_ref: JSON.stringify({ schemaVersion: 1, channel: 'instagram',
                providerMessageId: 'provider_1', payloadFingerprint: 'a'.repeat(64), senderId: 'business_1',
                recipientRef: 'cust_1', requestedAt: '2026-10-16T01:09:00Z', observedAt: '2026-10-16T01:10:00Z' }),
            }, error: null }) };
        }
        if (table === 'booking_recovery_outbox') {
          return {
            upsert: upsertSpy,
          };
        }
        return {};
      }),
    } as any;

    await projectInboundMessageToRecovery(mockSupabase, {
      workspaceId: 'ws_1',
      threadId: 'th_1',
      message: {
        id: 'msg_accept_1',
        sender_type: 'customer',
        sender_id: 'cust_1',
        text: '네 그 시간으로 예약해 주세요!',
        sent_at: '2026-10-16T02:00:00Z',
      },
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rpcSpy).toHaveBeenCalledWith('transition_booking_recovery',
      expect.objectContaining({
        p_workspace_id: 'ws_1', p_expected_version: 2, p_actor_id: 'owner_1',
        p_evidence_ref: 'msg_accept_1', p_next_stage: 'CUSTOMER_ACCEPTED',
        p_fingerprint: 'a'.repeat(64),
      })
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: 'case_1',
        source_event_key: 'acceptance:msg_accept_1',
        state: 'PENDING',
      }),
      expect.anything()
    );
  });
});
