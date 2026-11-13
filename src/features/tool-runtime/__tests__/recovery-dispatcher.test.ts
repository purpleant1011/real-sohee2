import { describe, it, expect, vi } from 'vitest';
import { recoveryDispatcher } from '../dispatchers/recovery-dispatcher';
import { ToolExecutionContext } from '../types';
import { RecoveryView } from '@/features/booking-recovery/contracts';

describe('Booking Recovery Tool Dispatcher (Task 9)', () => {
  const context: ToolExecutionContext = {
    workspaceId: 'a1111111-1111-4111-8111-111111111111',
    correlationId: 'corr_test_123',
    actorId: 'u1111111-1111-4111-8111-111111111111',
    creditBalance: 1000,
    isTestAccount: true,
  };

  const caseFixture: RecoveryView = {
    caseId: '11111111-1111-4111-8111-111111111111',
    missionId: '22222222-2222-4222-8222-222222222222',
    version: 1,
    stage: 'DRAFT_READY',
    statusLabel: '답변 초안 준비 완료',
    sourceThreadId: '33333333-3333-4333-8333-333333333333',
    sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-10-16T10:00:00.000Z',
    reply: {
      text: '답변 초안입니다.',
      fingerprint: 'a'.repeat(64),
    },
    offer: {
      slotId: '77777777-7777-4777-8777-777777777777',
      serviceId: '66666666-6666-4666-8666-666666666666',
      serviceName: '헤어 커트',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T15:00:00Z',
      timezone: 'Asia/Seoul',
      totalAmountKrw: 50000,
      depositKrw: 10000,
      validUntil: '2026-10-16T12:00:00Z',
      proposalRevision: 1,
    },
    acceptance: null,
    approval: {
      kind: 'send',
      fingerprint: 'a'.repeat(64),
    },
    proposal: {
      revision: 1,
      serviceId: '66666666-6666-4666-8666-666666666666',
      serviceName: '헤어 커트',
      totalAmountKrw: 50000,
      depositKrw: 10000,
      slotId: '77777777-7777-4777-8777-777777777777',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T15:00:00Z',
    },
    booking: null,
    nextAction: 'approve_send',
    revenue: {
      status: 'NOT_OBSERVED',
      amountKrw: null,
    },
  };

  const mockService = {
    listCaseViews: vi.fn().mockResolvedValue([caseFixture]),
    getCaseView: vi.fn().mockImplementation(async (_ws: string, id: string) => {
      if (id === caseFixture.caseId) return caseFixture;
      return null;
    }),
    openCase: vi.fn().mockResolvedValue({ ok: true, value: caseFixture }),
    prepareReply: vi.fn().mockResolvedValue({ ok: true, value: caseFixture }),
  };

  it('recovery.list 도구를 안전하게 실행한다', async () => {
    const result = await recoveryDispatcher.execute(
      { _toolName: 'recovery.list', limit: 5, _service: mockService, _supabaseClient: {} },
      context
    );

    expect(result.success).toBe(true);
    expect(result.toolId).toBe('recovery.list');
    expect(result.status).toBe('COMPLETED');
    expect(Array.isArray(result.data?.cases)).toBe(true);
    expect(result.data?.cases).toHaveLength(1);
  });

  it('recovery.request_send_approval은 직접 발송하지 않고 AWAITING_APPROVAL 제안만 반환한다', async () => {
    const result = await recoveryDispatcher.execute(
      {
        _toolName: 'recovery.request_send_approval',
        caseId: caseFixture.caseId,
        _service: mockService,
        _supabaseClient: {},
      },
      context
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(result.proposal?.proposalType).toBe('RECOVERY_SEND_APPROVAL');
    expect((result.proposal?.proposedValue as any)?.caseId).toBe(caseFixture.caseId);
    expect(result.data?.case).toEqual(caseFixture);
  });

  it('recovery.request_booking_approval은 직접 예약 확정하지 않고 AWAITING_APPROVAL 제안만 반환한다', async () => {
    const result = await recoveryDispatcher.execute(
      {
        _toolName: 'recovery.request_booking_approval',
        caseId: caseFixture.caseId,
        _service: mockService,
        _supabaseClient: {},
      },
      context
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(result.proposal?.proposalType).toBe('RECOVERY_BOOKING_APPROVAL');
    expect((result.proposal?.proposedValue as any)?.caseId).toBe(caseFixture.caseId);
    expect(result.data?.case).toEqual(caseFixture);
  });

  it('직접 실행 도구(approve_send, confirm_booking 등)는 지원하지 않는다', async () => {
    const result = await recoveryDispatcher.execute(
      {
        _toolName: 'recovery.approve_send',
        caseId: caseFixture.caseId,
        _service: mockService,
        _supabaseClient: {},
      },
      context
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toContain('지원하지 않는 회수 도구');
  });
});
