import { describe, it, expect, vi } from 'vitest';
import {
  handleRecoveryConversation,
  isRecoveryIntent,
  RECOVERY_MODEL_TOOL_NAMES,
  getRecoveryModelTools,
} from '../conversation-adapter';
import { RecoveryActor, RecoveryView } from '../contracts';

describe('Booking Recovery Conversation Adapter (Task 9)', () => {
  const actor: RecoveryActor = {
    workspaceId: 'a1111111-1111-4111-8111-111111111111',
    userId: 'u1111111-1111-4111-8111-111111111111',
    role: 'owner',
  };

  const caseFixture: RecoveryView = {
    caseId: '11111111-1111-4111-8111-111111111111',
    missionId: '22222222-2222-4222-8222-222222222222',
    version: 3,
    stage: 'AWAITING_BOOKING_APPROVAL',
    statusLabel: '예약 확정 승인 대기',
    sourceThreadId: '33333333-3333-4333-8333-333333333333',
    sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-10-16T10:00:00.000Z',
    reply: {
      text: '고객님 14시 예약 가능합니다.',
      fingerprint: 'a'.repeat(64),
    },
    offer: {
      slotId: '77777777-7777-4777-8777-777777777777',
      serviceId: '66666666-6666-4666-8666-666666666666',
      serviceName: '맞춤 펌 시술',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T16:00:00Z',
      timezone: 'Asia/Seoul',
      totalAmountKrw: 120000,
      depositKrw: 30000,
      validUntil: '2026-10-16T12:00:00Z',
      proposalRevision: 1,
    },
    acceptance: {
      inboundMessageId: '88888888-8888-4888-8888-888888888888',
      receivedAt: '2026-10-16T11:00:00Z',
    },
    approval: {
      kind: 'booking',
      fingerprint: 'b'.repeat(64),
    },
    proposal: {
      revision: 1,
      serviceId: '66666666-6666-4666-8666-666666666666',
      serviceName: '맞춤 펌 시술',
      totalAmountKrw: 120000,
      depositKrw: 30000,
      slotId: '77777777-7777-4777-8777-777777777777',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T16:00:00Z',
    },
    booking: null,
    nextAction: 'approve_booking',
    revenue: {
      status: 'NOT_OBSERVED',
      amountKrw: null,
    },
  };

  it('자연어 명령은 승인 실행 권한이 아니다: "그 고객 예약 확정해줘" 시 직접 승인하지 않고 확인 카드 반환', async () => {
    const approve = vi.fn();
    const mockService = {
      getCaseView: vi.fn().mockResolvedValue(caseFixture),
      listCaseViews: vi.fn().mockResolvedValue([caseFixture]),
    };

    const result = await handleRecoveryConversation(
      {
        actor,
        message: '그 고객 예약 확정해줘',
        caseId: caseFixture.caseId,
      },
      {
        service: mockService as any,
        approve,
      }
    );

    // approve 명령은 절대 자연어로 자동 호출되지 않아야 함
    expect(approve).not.toHaveBeenCalled();
    expect(result.type).toBe('recovery.updated');
    if (result.type === 'recovery.updated') {
      expect(result.caseId).toBe(caseFixture.caseId);
      expect(result.missionId).toBe(caseFixture.missionId);
      expect(result.version).toBe(caseFixture.version);
      expect(result.view.nextAction).toBe('approve_booking');
      expect(result.view.approval?.kind).toBe('booking');
    }
  });

  it('동일 source 문의를 main/universal/full conversation에서 열면 같은 caseId와 missionId를 참조한다', async () => {
    const mockService = {
      getCaseView: vi.fn().mockResolvedValue(caseFixture),
    };

    const res1 = await handleRecoveryConversation(
      { actor, caseId: caseFixture.caseId },
      { service: mockService as any }
    );
    const res2 = await handleRecoveryConversation(
      { actor, caseId: caseFixture.caseId },
      { service: mockService as any }
    );

    expect(res1.type).toBe('recovery.updated');
    expect(res2.type).toBe('recovery.updated');
    if (res1.type === 'recovery.updated' && res2.type === 'recovery.updated') {
      expect(res1.caseId).toBe(res2.caseId);
      expect(res1.missionId).toBe(res2.missionId);
      expect(res1.view).toEqual(caseFixture);
    }
  });

  it('caseId가 없고 모호한 문의일 때 회수 가능한 케이스 목록을 제안 카드로 반환한다', async () => {
    const mockService = {
      listCaseViews: vi.fn().mockResolvedValue([caseFixture]),
    };

    const result = await handleRecoveryConversation(
      { actor, message: '문의 온 거 확인해줘' },
      { service: mockService as any }
    );

    expect(result.type).toBe('recovery.selection');
    if (result.type === 'recovery.selection') {
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].caseId).toBe(caseFixture.caseId);
    }
  });

  it('콘텐츠 생성 등 기존 대화 의도는 recovery로 가로채지 않는다 (예약 키워드 포함 콘텐츠 요청도 보존)', () => {
    // 순수 콘텐츠 / 이미지 요청
    expect(isRecoveryIntent('인스타그램 피드 원고 작성해줘')).toBe(false);
    expect(isRecoveryIntent('오늘 시술 사진 올려줘')).toBe(false);
    expect(isRecoveryIntent('네이버 블로그 포스팅')).toBe(false);

    // 중요: '예약' 키워드가 들어갔지만 마케팅 콘텐츠/이미지 작성 요청인 경우
    expect(isRecoveryIntent('예약 문의 유도하는 인스타 글 써줘')).toBe(false);
    expect(isRecoveryIntent('예약 안내 이미지 만들어줘')).toBe(false);
    expect(isRecoveryIntent('예약 마감 피드 작성')).toBe(false);

    // 실제 고객 문의/응답 회수 업무
    expect(isRecoveryIntent('미응답 예약문의 챙겨줘')).toBe(true);
    expect(isRecoveryIntent('미결제 예약 문의 확인해줘')).toBe(true);
    expect(isRecoveryIntent('이 문의 이어서 처리해줘')).toBe(true);
    expect(isRecoveryIntent('DM 문의 답변 보내줘')).toBe(true);
    expect(isRecoveryIntent('고객 예약 확정 진행')).toBe(true);
  });

  it('다중 소스가 모호하거나 데이터가 없는 경우를 안전하게 처리한다', async () => {
    // 1. 케이스 없음
    const mockEmptyService = {
      listCaseViews: vi.fn().mockResolvedValue([]),
    };
    const emptyRes = await handleRecoveryConversation(
      { actor, message: '미응답 문의 확인' },
      { service: mockEmptyService as any }
    );
    expect(emptyRes.type).toBe('recovery.empty');

    // 2. 다수 케이스 존재 시 모호한 자연어 요청은 목록 선택 반환
    const mockMultiService = {
      listCaseViews: vi.fn().mockResolvedValue([
        caseFixture,
        { ...caseFixture, caseId: '99999999-9999-4999-8999-999999999999' },
      ]),
    };
    const multiRes = await handleRecoveryConversation(
      { actor, message: '문의 온 거 확인해줘' },
      { service: mockMultiService as any }
    );
    expect(multiRes.type).toBe('recovery.selection');
    if (multiRes.type === 'recovery.selection') {
      expect(multiRes.cases).toHaveLength(2);
    }
  });

  it('존재하지 않는 caseId 요청 시 safe not-found 처리를 한다', async () => {
    const mockService = {
      getCaseView: vi.fn().mockResolvedValue(null),
    };
    const notFoundRes = await handleRecoveryConversation(
      { actor, caseId: '00000000-0000-4000-8000-000000000000' },
      { service: mockService as any }
    );
    expect(notFoundRes.type).toBe('recovery.error');
    if (notFoundRes.type === 'recovery.error') {
      expect(notFoundRes.code).toBe('NOT_FOUND');
    }
  });

  it('모델 도구 목록에는 6종의 안전 도구만 노출되며 직접 승인/발송/확정 도구는 제외된다', () => {
    const tools = getRecoveryModelTools();
    const toolNames = tools.map((t) => t.function.name);

    expect(toolNames).toEqual(expect.arrayContaining([...RECOVERY_MODEL_TOOL_NAMES]));
    expect(toolNames).not.toContain('recovery.approve_send');
    expect(toolNames).not.toContain('recovery.approve_booking');
    expect(toolNames).not.toContain('recovery.send');
    expect(toolNames).not.toContain('recovery.confirm');
    expect(toolNames).not.toContain('reservation.confirm_recovery');
  });
});
