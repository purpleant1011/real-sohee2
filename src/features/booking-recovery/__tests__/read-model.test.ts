import { describe, it, expect } from 'vitest';
import { createRecoveryView, recoveryStatusLabel } from '../read-model';
import { RecoveryCase } from '../repository';
import { RecoveryProposal } from '../contracts';

describe('Booking Recovery Read Model', () => {
  const caseFixture: RecoveryCase = {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: 'a1111111-1111-4111-8111-111111111111',
    mission_id: '22222222-2222-4222-8222-222222222222',
    source_thread_id: '33333333-3333-4333-8333-333333333333',
    source_inbound_message_id: '44444444-4444-4444-8444-444444444444',
    customer_ref: 'cust_100',
    stage: 'DISCOVERED',
    version: 1,
    created_at: '2026-10-16T10:00:00Z',
    updated_at: '2026-10-16T10:00:00Z',
  };

  it('기본 상태 라벨을 올바른 한국어로 반환한다', () => {
    expect(recoveryStatusLabel('DISCOVERED')).toBe('신규 문의 접수');
    expect(recoveryStatusLabel('NEEDS_CONTEXT')).toBe('예약 가능 시간 확인 필요');
    expect(recoveryStatusLabel('PROVIDER_ACCEPTED')).toBe('채널 접수 · 결과 확인 중');
    expect(recoveryStatusLabel('SEND_VERIFIED')).toBe('전송 완료');
    expect(recoveryStatusLabel('BOOKING_CONFIRMED')).toBe('예약 확정 완료');
    expect(recoveryStatusLabel('RESULT_UNKNOWN')).toBe('전송 결과 확인 필요');
  });

  it('외부 접수만 된 답변을 전송 확인으로 표시하지 않는다', () => {
    const view = recoveryStatusLabel('PROVIDER_ACCEPTED');
    expect(view).toBe('채널 접수 · 결과 확인 중');
  });

  it('예약 확정 단계라도 미관측 매출(revenue)은 항상 NOT_OBSERVED 및 null이다', () => {
    const view = createRecoveryView({
      caseItem: { ...caseFixture, stage: 'BOOKING_CONFIRMED', version: 5 },
      booking: { id: 'bk_12345678', confirmedAt: '2026-10-16T12:00:00Z' },
    });

    expect(view.revenue).toEqual({
      status: 'NOT_OBSERVED',
      amountKrw: null,
    });
    expect(view.booking?.id).toBe('bk_12345678');
    expect(view.stage).toBe('BOOKING_CONFIRMED');
    expect(view.nextAction).toBeNull();
  });

  it('proposal 스냅샷이 있는 경우 view에 안전하게 투영한다', () => {
    const proposalFixture: RecoveryProposal = {
      id: '55555555-5555-4555-8555-555555555555',
      workspace_id: caseFixture.workspace_id,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: '66666666-6666-4666-8666-666666666666',
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌 시술',
      total_amount_krw: 120000,
      deposit_krw: 30000,
      slot_id: '77777777-7777-4777-8777-777777777777',
      slot_version: 1,
      starts_at: '2026-10-17T14:00:00Z',
      ends_at: '2026-10-17T16:00:00Z',
      timezone: 'Asia/Seoul',
      availability_confirmed_at: '2026-10-16T10:00:00Z',
      valid_until: '2026-10-16T10:15:00Z',
      reply_text: '고객님, 내일 14시에 예약 가능합니다.',
      payload_fingerprint: 'a'.repeat(64),
      created_at: '2026-10-16T10:00:00Z',
    };

    const view = createRecoveryView({
      caseItem: { ...caseFixture, stage: 'DRAFT_READY' },
      proposal: proposalFixture,
    });

    expect(view.reply?.text).toBe(proposalFixture.reply_text);
    expect(view.reply?.fingerprint).toBe(proposalFixture.payload_fingerprint);
    expect(view.proposal?.serviceName).toBe('맞춤 펌 시술');
    expect(view.proposal?.totalAmountKrw).toBe(120000);
    expect(view.proposal?.depositKrw).toBe(30000);
    expect(view.offer?.serviceName).toBe('맞춤 펌 시술');
    expect(view.offer?.totalAmountKrw).toBe(120000);
    expect(view.offer?.proposalRevision).toBe(1);
    expect(view.approval?.kind).toBe('send');
    expect(view.approval?.fingerprint).toBe(proposalFixture.payload_fingerprint);
    expect(view.nextAction).toBe('approve_send');
  });

  it('AWAITING_BOOKING_APPROVAL 및 수락 메시지가 있는 경우 approval.kind === "booking" 지문과 acceptance를 투영한다', () => {
    const proposalFixture: RecoveryProposal = {
      id: '55555555-5555-4555-8555-555555555555',
      workspace_id: caseFixture.workspace_id,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: '66666666-6666-4666-8666-666666666666',
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌 시술',
      total_amount_krw: 120000,
      deposit_krw: 30000,
      slot_id: '77777777-7777-4777-8777-777777777777',
      slot_version: 1,
      starts_at: '2026-10-17T14:00:00Z',
      ends_at: '2026-10-17T16:00:00Z',
      timezone: 'Asia/Seoul',
      availability_confirmed_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      reply_text: '고객님, 내일 14시에 예약 가능합니다.',
      payload_fingerprint: 'a'.repeat(64),
      created_at: new Date().toISOString(),
    };

    const acceptMsgId = '88888888-8888-4888-8888-888888888888';

    const view = createRecoveryView({
      caseItem: {
        ...caseFixture,
        stage: 'AWAITING_BOOKING_APPROVAL',
        accepted_inbound_message_id: acceptMsgId,
      },
      proposal: proposalFixture,
    });

    expect(view.acceptance?.inboundMessageId).toBe(acceptMsgId);
    expect(view.approval?.kind).toBe('booking');
    expect(view.approval?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(view.nextAction).toBe('approve_booking');
  });

  it('15분 유효기간(valid_until)이 만료된 경우 nextAction은 reattest_schedule이다', () => {
    const expiredProposal = {
      id: '55555555-5555-4555-8555-555555555555',
      workspace_id: caseFixture.workspace_id,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: '66666666-6666-4666-8666-666666666666',
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌 시술',
      total_amount_krw: 120000,
      deposit_krw: 30000,
      slot_id: '77777777-7777-4777-8777-777777777777',
      slot_version: 1,
      starts_at: '2026-10-20T14:00:00Z',
      ends_at: '2026-10-20T16:00:00Z',
      timezone: 'Asia/Seoul',
      availability_confirmed_at: '2026-10-16T10:00:00Z',
      valid_until: new Date(Date.now() - 60 * 1000).toISOString(), // expired 1 min ago
      reply_text: '고객님, 예약 가능합니다.',
      payload_fingerprint: 'a'.repeat(64),
      created_at: '2026-10-16T10:00:00Z',
    };

    const acceptMsgId = '88888888-8888-4888-8888-888888888888';

    const view = createRecoveryView({
      caseItem: {
        ...caseFixture,
        stage: 'CUSTOMER_ACCEPTED',
        accepted_inbound_message_id: acceptMsgId,
      },
      proposal: expiredProposal,
    });

    expect(view.nextAction).toBe('reattest_schedule');
    expect(view.approval).toBeNull();
  });
});
