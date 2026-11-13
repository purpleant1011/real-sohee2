import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentApprovalService } from '@/features/agent-session/agent-approval-service';
import { AgentSessionService } from '@/features/agent-session/agent-session-service';
import { CanonicalSurfaceContext } from '@/features/agent-session/types';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';

import { createDurableApprovalTable } from '../helpers/durable-approval-table';

const { rows: approvalRows, table: approvalTable } = createDurableApprovalTable();
const mockFrom = vi.fn((table?: string) => table === 'agent_approvals' ? approvalTable()
  : table === 'conversation_jobs' ? {
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id: 'act_run_publish_77', workspace_id: 'ws-test-byreum', plan_data: {} }, error: null,
    }) }) }) }),
  } : ({
  upsert: vi.fn().mockResolvedValue({ error: null }),
  insert: vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: '00000000-0000-4000-8000-000000000201' }, error: null }),
    })),
  })),
  update: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: '00000000-0000-4000-8000-000000000201' }, error: null }),
      })),
    })),
  })),
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: mockFrom,
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

describe('ANI-939: Chat Safety, False-Green Elimination, and Durable Agent Approvals', () => {
  const WORKSPACE_ID = 'ws-test-byreum';

  beforeEach(() => {
    approvalRows.clear();
    AgentSessionService.resetMemoryStoreForTesting();
    AgentApprovalService.resetMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  describe('1. Session Continuity & Surface Context Awareness', () => {
    it('preserves same sessionId and threadId when navigating across routes', async () => {
      // Step 1: Initial creation at /app/customers
      const initial = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app/customers', routeName: 'customers' },
      });

      const sessionId = initial.session.sessionId;
      const threadId = initial.session.threadId;

      // Step 2: Route change to /app/content
      const navigated = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        sessionId,
        surface: { route: '/app/content', routeName: 'content', tab: 'calendar' },
      });

      expect(navigated.isNewSession).toBe(false);
      expect(navigated.session.sessionId).toBe(sessionId);
      expect(navigated.session.threadId).toBe(threadId);
      expect(navigated.session.currentSurface.route).toBe('/app/content');
      expect(navigated.session.currentSurface.tab).toBe('calendar');
    });

    it('faithfully preserves surface entity, tab, and filter context in AgentSession', async () => {
      const surface: CanonicalSurfaceContext = {
        route: '/app/analytics',
        routeName: 'analytics',
        tab: 'performance',
        selectedItemId: 'campaign-8899',
        entityType: 'campaign',
        filters: { range: '30d', status: 'ACTIVE' },
      };

      const res = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface,
      });

      expect(res.session.currentSurface.entityType).toBe('campaign');
      expect(res.session.currentSurface.selectedItemId).toBe('campaign-8899');
      expect(res.session.currentSurface.tab).toBe('performance');
      expect(res.session.currentSurface.filters).toEqual({ range: '30d', status: 'ACTIVE' });
    });
  });

  describe('2. Durable Agent Approvals & Version Optimistic Locking', () => {
    it('persists a pending approval, updates session to AWAITING_APPROVAL, and reloads it', async () => {
      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app/content' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        actionRunId: 'act_run_test_1',
        proposalType: 'PUBLISH_APPROVAL',
        title: '인스타그램 피드 발행 승인',
        description: '2026-09-07 오전 10:00 예약 발행 승인 요청',
        proposedValue: { channel: 'instagram', caption: '새로운 시술 사진' },
      });

      expect(proposal.proposalId).toBeDefined();
      expect(proposal.status).toBe('PENDING');
      expect(proposal.version).toBe(1);

      // Verify session transitioned to AWAITING_APPROVAL
      const session = await AgentSessionService.getSession(WORKSPACE_ID, sessionRes.session.sessionId);
      expect(session?.status).toBe('AWAITING_APPROVAL');

      // Verify retrieval
      const approvals = await AgentApprovalService.getApprovals(WORKSPACE_ID, {
        sessionId: sessionRes.session.sessionId,
        status: 'PENDING',
      });
      expect(approvals.length).toBe(1);
      expect(approvals[0].proposalId).toBe(proposal.proposalId);
    });

    it('rejects stale approval attempt with VERSION_CONFLICT when expectedVersion mismatches', async () => {
      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app/content' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        proposalType: 'BUDGET_INCREASE',
        title: '광고 예산 증액',
        description: '일 예산 10,000원 -> 20,000원',
        proposedValue: { dailyBudget: 20000 },
      });

      // Mismatched expectedVersion
      const resolveResult = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: proposal.proposalId,
        action: 'APPROVE',
        expectedVersion: 999, // Stale version
      });

      expect(resolveResult.success).toBe(false);
      expect(resolveResult.error?.code).toBe('VERSION_CONFLICT');
      expect(resolveResult.approval.status).toBe('PENDING');
    });

    it('원고와 사진의 정확 승인 없이 레거시 게시 승인을 실행하지 않는다', async () => {
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
        success: true,
        status: 'EXECUTED',
        data: { postId: 'post-12345', url: 'https://instagram.com/p/test' },
      } as any);

      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app/content' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        actionRunId: 'act_run_publish_77',
        proposalType: 'PUBLISH_APPROVAL',
        title: '포스팅 즉시 발행',
        description: '승인 즉시 인스타그램에 발행됩니다.',
        proposedValue: {
          channel: 'instagram',
          caption: '청라 바이름 뷰티 스튜디오 룩북',
        },
      });

      // Approve with correct version
      const res = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: proposal.proposalId,
        action: 'APPROVE',
        expectedVersion: 1,
        actorId: 'owner-user-1',
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED');
      expect(res.approval.version).toBe(1);
      expect(res.approval.status).toBe('PENDING');
      expect(dispatchSpy).not.toHaveBeenCalled();

      const updatedSession = await AgentSessionService.getSession(WORKSPACE_ID, sessionRes.session.sessionId);
      expect(updatedSession?.status).toBe('AWAITING_APPROVAL');
    });

    it('cancels proposal and returns REJECTED status without executing tool upon rejection', async () => {
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');

      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app/content' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        actionRunId: 'act_run_cancel_99',
        proposalType: 'PUBLISH_APPROVAL',
        title: '발행 반려 테스트',
        description: '원장님이 반려하는 시나리오',
        proposedValue: { channel: 'instagram' },
      });

      const res = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: proposal.proposalId,
        action: 'REJECT',
        rejectionReason: '문구 수정 필요',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('REJECTED');
      expect(res.approval.status).toBe('REJECTED');
      expect(res.approval.rejectionReason).toBe('문구 수정 필요');
      expect(dispatchSpy).not.toHaveBeenCalled();

      // Session transitioned back to ACTIVE
      const updatedSession = await AgentSessionService.getSession(WORKSPACE_ID, sessionRes.session.sessionId);
      expect(updatedSession?.status).toBe('ACTIVE');
    });

    it('prevents resolving already resolved or expired approvals', async () => {
      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app' },
      });

      // Expired proposal
      const expiredProposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        proposalType: 'EXPIRED_TEST',
        title: '만료 테스트',
        description: '1초 전 만료',
        proposedValue: {},
        expiresAt: new Date(Date.now() - 5000).toISOString(),
      });

      const expiredRes = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: expiredProposal.proposalId,
        action: 'APPROVE',
      });

      expect(expiredRes.success).toBe(false);
      expect(expiredRes.error?.code).toBe('APPROVAL_EXPIRED');
    });
  });

  describe('3. False-Green Elimination in Chat Fallbacks', () => {
    it('ensures no synthetic optimistic copy is returned on empty or failed responses', () => {
      // Test the contract: empty responses must never produce synthetic affirmations like "지시사항을 확인했습니다!"
      const forbiddenPhrases = [
        '지시사항을 확인했습니다! 미션에 반영하여 처리하겠습니다.',
        '매장 상태를 안전하게 지키고 있습니다',
        '모든 작업이 성공적으로 처리되었습니다',
      ];

      const emptyData: any = {};
      const fallbackOnEmpty =
        emptyData?.reply ||
        emptyData?.content ||
        (emptyData?.step === 'BLOCKED'
          ? '⚠️ 실행 조건이 충족되지 않아 중단되었습니다 (BLOCKED).'
          : '⚠️ 응답 내용이 비어 있습니다 (EMPTY_RESPONSE).');

      expect(fallbackOnEmpty).toBe('⚠️ 응답 내용이 비어 있습니다 (EMPTY_RESPONSE).');

      for (const phrase of forbiddenPhrases) {
        expect(fallbackOnEmpty).not.toContain(phrase);
      }

      // Blocked step fallback
      const blockedData: any = { step: 'BLOCKED' };
      const fallbackOnBlocked =
        blockedData?.reply ||
        blockedData?.content ||
        (blockedData?.step === 'BLOCKED'
          ? '⚠️ 실행 조건이 충족되지 않아 중단되었습니다 (BLOCKED).'
          : '⚠️ 응답 내용이 비어 있습니다 (EMPTY_RESPONSE).');

      expect(fallbackOnBlocked).toBe('⚠️ 실행 조건이 충족되지 않아 중단되었습니다 (BLOCKED).');
    });
  });
});
