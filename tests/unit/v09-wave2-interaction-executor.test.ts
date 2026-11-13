import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionExecutor } from '@/lib/agent-os/executors/interaction-executor';

// Mock Supabase Server Client
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: mockSelect,
    })),
  })),
}));

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({ blocked: false })),
}));

describe('ANI-938: Interaction Executor - Synthetic Ref & False Zero Elimination', () => {
  const workspaceId = 'ws_interaction_test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });
  });

  describe('1. DB Failure vs Verified Empty (False Zero Elimination)', () => {
    it('should return QUERY_FAILED and success=false on DB error (NO false zero)', async () => {
      // Mock DB query error
      mockLimit.mockResolvedValue({
        data: null,
        error: new Error('Postgres connection pool exhausted'),
      });

      const res = await InteractionExecutor.queryCustomerInteractions(workspaceId);

      expect(res.success).toBe(false);
      expect(res.status).toBe('QUERY_FAILED');
      expect(res.errorCode).toBe('DB_QUERY_ERROR');
      expect(res.totalDepositCollected).toContain('조회 실패');
      expect(res.customerList).toEqual([]);
    });

    it('should return EMPTY_VERIFIED and success=true when DB legitimately has 0 rows', async () => {
      mockLimit.mockResolvedValue({
        data: [],
        error: null,
      });

      const res = await InteractionExecutor.queryCustomerInteractions(workspaceId);

      expect(res.success).toBe(true);
      expect(res.status).toBe('EMPTY_VERIFIED');
      // 상담이 없다는 사실만 확인됐다. 예약 확정·수납은 이 표에 근거가 없으므로 0원으로 단정하지 않는다.
      expect(res.totalConfirmedBookings).toBeNull();
      expect(res.bookingState).toBe('NOT_OBSERVED');
      expect(res.totalDepositCollected).not.toContain('₩0');
      expect(res.depositState).toBe('NOT_OBSERVED');
      expect(res.customerList).toEqual([]);
    });
  });

  describe('2. 예약 확정·예약금 근거 없이 수납/확정을 주장하지 않는다', () => {
    it('상담 표에 없는 예약금·예약 상태를 0원·입금 대기로 채우지 않는다', async () => {
      // customer_conversations 실제 컬럼만 담는다(예약 상태·예약금·시술·슬롯 컬럼 없음).
      const mockRows = [
        {
          id: 'conv_1',
          display_label: '김고객',
          channel: 'instagram',
          summary: '예약 문의 후 14:00 상담 진행',
          requires_human_review: false,
        },
        {
          id: 'conv_2',
          display_label: '이고객',
          channel: 'naver_blog',
          summary: '입금 관련 문의',
          requires_human_review: true,
        },
      ];

      mockLimit.mockResolvedValue({
        data: mockRows,
        error: null,
      });

      const res = await InteractionExecutor.queryCustomerInteractions(workspaceId);

      expect(res.success).toBe(true);
      // 상담 표에는 예약 확정 상태가 없다. 2건을 확정 예약으로 세지 않는다.
      expect(res.totalConfirmedBookings).toBeNull();
      expect(res.bookingState).toBe('NOT_OBSERVED');
      expect(res.totalDepositCollected).not.toContain('₩');
      expect(res.depositState).toBe('NOT_OBSERVED');
      expect(res.channelsSummary).toContain('예약 장부');

      // 확인된 컬럼만 옮긴다: 채널 코드는 한글 라벨로, 없는 시술명은 만들지 않는다.
      expect(res.customerList[0].customerName).toBe('김고객');
      expect(res.customerList[0].channel).toBe('인스타그램');
      expect(res.customerList[0].treatment).toBeUndefined();
      expect(res.customerList[0].slot).toBeUndefined();
      expect(res.customerList[0].depositStatus).toBe('예약금 상태 미확인');
      expect(res.customerList[0].depositAmount).toBeNull();
      expect(res.customerList[1].channel).toBe('네이버 블로그');
      expect(res.customerList[1].unread).toBe(true);
    });
  });

  describe('3. Synthetic Provider Reference & Unsupported Channel Elimination', () => {
    it('should fail-close with UNSUPPORTED_REPLY_CHANNEL for NAVER_BLOG reply without synthetic ref', async () => {
      const res = await InteractionExecutor.replyToComment({
        workspaceId,
        channel: 'NAVER_BLOG',
        targetId: 'naver_comment_123',
        replyText: '감사합니다!',
        intentMode: 'EXECUTE',
      });

      expect(res.success).toBe(false);
      expect(res.externalMessageSent).toBe(false);
      expect(res.errorCode).toBe('UNSUPPORTED_REPLY_CHANNEL');
      expect(res.providerReference).toBeUndefined();
      expect(res.statusMessage).toContain('CONNECT_REQUIRED');
    });

    it('should fail-close with UNSUPPORTED_DM_CHANNEL for DAANGN DM without synthetic ref', async () => {
      const res = await InteractionExecutor.sendDirectMessage({
        workspaceId,
        channel: 'DAANGN',
        targetId: 'daangn_chat_456',
        replyText: '문의 주셔서 감사합니다.',
        intentMode: 'EXECUTE',
      });

      expect(res.success).toBe(false);
      expect(res.externalMessageSent).toBe(false);
      expect(res.errorCode).toBe('UNSUPPORTED_DM_CHANNEL');
      expect(res.providerReference).toBeUndefined();
      expect(res.statusMessage).toContain('CONNECT_REQUIRED');
    });

    it('should generate draft safely without sending external message in DRAFT mode', async () => {
      const res = await InteractionExecutor.replyToComment({
        workspaceId,
        channel: 'INSTAGRAM',
        targetId: 'ig_comment_789',
        replyText: '초안입니다.',
        intentMode: 'DRAFT',
      });

      expect(res.success).toBe(true);
      expect(res.intentMode).toBe('DRAFT');
      expect(res.requiresApproval).toBe(true);
      expect(res.externalMessageSent).toBe(false);
      expect(res.draftText).toBe('초안입니다.');
    });
  });
});
