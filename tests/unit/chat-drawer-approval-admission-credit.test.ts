import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentApprovalService } from '@/features/agent-session/agent-approval-service';
import { AgentSessionService } from '@/features/agent-session/agent-session-service';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import { CapabilityStatusRegistry } from '@/lib/mcp-gateway/capability-status-registry';
import { ToolAdmissionController } from '@/lib/mcp-gateway/tool-admission-controller';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import { PersistenceError } from '@/lib/errors/persistence-error';
import { SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry';
import { systemDispatcher } from '@/features/tool-runtime/dispatchers/system-dispatcher';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

import { createDurableApprovalTable } from '../helpers/durable-approval-table';

const { rows: approvalRows, table: approvalTable } = createDurableApprovalTable();

function nonMissionRunsTable() {
  const filters: Record<string, unknown> = {};
  const rows = ['run-publish_approval', 'run-content_publish'].map(id => ({
    id, workspace_id: 'ws-test-chat-drawer', plan_data: {},
  }));
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query; },
    maybeSingle: async () => ({ data: rows.find(row => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value)) ?? null, error: null }),
  };
  return query;
}

// 나머지 경계는 각 테스트에서 필요한 응답만 제공한다.
const mockFrom = vi.fn((table?: string) => table === 'agent_approvals' ? approvalTable()
  : table === 'conversation_jobs' ? nonMissionRunsTable() : ({
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
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
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

describe('Chat Drawer Integration: Approval Resume, Admission DB Authority, Credit Truth', () => {
  const WORKSPACE_ID = 'ws-test-chat-drawer';

  beforeEach(() => {
    approvalRows.clear();
    AgentSessionService.resetMemoryStoreForTesting();
    AgentApprovalService.resetMemoryStoreForTesting();
    AgentControlPlaneService.resetForTest(WORKSPACE_ID);
    CapabilityStatusRegistry.resetForTest();
    vi.restoreAllMocks();
  });

  describe('과제 1: 승인 후 재개가 발행 외 도구를 올바르게 실행', () => {
    const proposalToolCases = [
      {
        proposalType: 'COMMENT_REPLY_APPROVAL',
        expectedTool: 'comment.reply',
        proposedValue: { targetId: 'comment-123', replyText: '방문해 주셔서 감사합니다!', channel: 'INSTAGRAM' },
      },
      {
        proposalType: 'DM_SEND_APPROVAL',
        expectedTool: 'dm.send',
        proposedValue: { targetId: 'user-456', replyText: '예약 문의 답변드립니다.', channel: 'INSTAGRAM' },
      },
      {
        proposalType: 'CAMPAIGN_APPROVAL',
        expectedTool: 'campaign.create',
        proposedValue: { title: '봄맞이 이벤트', goal: '신규 고객 확보', budget: 50000, adAccountId: 'act-789' },
      },
      {
        proposalType: 'RESERVATION_CONFIRMATION',
        expectedTool: 'reservation.create',
        proposedValue: { slotId: 'slot-999', customerId: 'cust-111', customerName: '홍길동', depositKrw: 20000 },
      },
      {
        proposalType: 'PUBLISH_APPROVAL',
        expectedTool: 'publish.create',
        proposedValue: { channel: 'instagram', caption: '새로운 룩북 오픈' },
      },
      {
        proposalType: 'CONTENT_PUBLISH',
        expectedTool: 'publish.create',
        proposedValue: { channel: 'instagram', caption: '새로운 룩북 오픈 2' },
      },
    ];

    for (const tc of proposalToolCases) {
      it(`[${tc.proposalType}] 정확 게시 검토가 없는 요청은 차단하고 그 외 도구는 승인 후 재개한다`, async () => {
        const updateStatusSpy = vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined);
        const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
          success: true,
          status: 'COMPLETED',
          toolId: tc.expectedTool,
          data: { executed: true },
          logs: ['정상 실행 완료'],
        });

        const sessionRes = await AgentSessionService.resolveOrCreateSession({
          workspaceId: WORKSPACE_ID,
          surface: { route: '/app' },
        });

        const proposal = await AgentApprovalService.createProposal({
          workspaceId: WORKSPACE_ID,
          sessionId: sessionRes.session.sessionId,
          actionRunId: `run-${tc.proposalType.toLowerCase()}`,
          proposalType: tc.proposalType,
          title: `${tc.proposalType} 테스트`,
          description: '승인 테스트',
          proposedValue: tc.proposedValue,
        });

        const res = await AgentApprovalService.resolveApproval({
          workspaceId: WORKSPACE_ID,
          proposalId: proposal.proposalId,
          action: 'APPROVE',
        });

        if (tc.expectedTool === 'publish.create') {
          expect(res.success).toBe(false);
          expect(res.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED');
          expect(res.approval.status).toBe('PENDING');
          expect(dispatchSpy).not.toHaveBeenCalled();
          expect(updateStatusSpy).not.toHaveBeenCalled();
          return;
        }
        expect(res.success).toBe(true);
        expect(res.status).toBe('APPROVED');
        expect(dispatchSpy).toHaveBeenCalledWith(
          tc.expectedTool,
          expect.objectContaining(tc.proposedValue),
          expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            sessionId: sessionRes.session.sessionId,
            intentMode: 'EXECUTE',
          })
        );
        expect(updateStatusSpy).toHaveBeenCalledWith(
          `run-${tc.proposalType.toLowerCase()}`,
          'completed',
          true
        );
        expect(res.executionResult?.success).toBe(true);
      });
    }

    it('도구 실행(dispatch) 실패 시 actionRun을 completed로 마킹하지 않고 failed로 처리한다', async () => {
      const updateStatusSpy = vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined);
      vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
        success: false,
        status: 'FAILED',
        toolId: 'comment.reply',
        error: { code: 'NETWORK_TIMEOUT', message: '인스타그램 서버 응답 시간 초과' },
        logs: ['실행 실패'],
      });

      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        actionRunId: 'run-fail-1',
        proposalType: 'COMMENT_REPLY_APPROVAL',
        title: '댓글 실패 테스트',
        description: '실패 검증',
        proposedValue: { targetId: 'c1', replyText: 'test' },
      });

      const res = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: proposal.proposalId,
        action: 'APPROVE',
      });

      expect(res.success).toBe(true);
      expect(res.executionResult?.success).toBe(false);
      expect(updateStatusSpy).not.toHaveBeenCalledWith('run-fail-1', 'completed', true);
      expect(updateStatusSpy).toHaveBeenCalledWith('run-fail-1', 'failed', true);
    });

    it('도구 실행 중 예외(exception) 발생 시 actionRun을 failed 처리하고 한국어 사유를 반환한다', async () => {
      const updateStatusSpy = vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined);
      vi.spyOn(ToolDispatcher, 'dispatch').mockRejectedValue(new Error('네트워크 연결 끊김'));

      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        actionRunId: 'run-throw-1',
        proposalType: 'DM_SEND_APPROVAL',
        title: 'DM 예외 테스트',
        description: '예외 검증',
        proposedValue: { targetId: 'u1', replyText: 'test' },
      });

      const res = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: proposal.proposalId,
        action: 'APPROVE',
      });

      expect(res.success).toBe(true);
      expect(res.executionResult?.success).toBe(false);
      expect((res.executionResult?.error as any)?.message).toContain('실행되지 않았');
      expect(updateStatusSpy).not.toHaveBeenCalledWith('run-throw-1', 'completed', true);
      expect(updateStatusSpy).toHaveBeenCalledWith('run-throw-1', 'failed', true);
    });

    it('매핑 테이블에 없는 미지원 proposalType은 completed가 아닌 failed로 처리하고 한국어 사유를 담는다', async () => {
      const updateStatusSpy = vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined);
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');

      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        surface: { route: '/app' },
      });

      const proposal = await AgentApprovalService.createProposal({
        workspaceId: WORKSPACE_ID,
        sessionId: sessionRes.session.sessionId,
        actionRunId: 'run-unsupported-1',
        proposalType: 'UNKNOWN_CUSTOM_APPROVAL',
        title: '미지원 제안',
        description: '미지원 타입',
        proposedValue: { key: 'val' },
      });

      const res = await AgentApprovalService.resolveApproval({
        workspaceId: WORKSPACE_ID,
        proposalId: proposal.proposalId,
        action: 'APPROVE',
      });

      expect(res.success).toBe(true);
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(res.executionResult?.success).toBe(false);
      expect(typeof (res.executionResult?.error as any)?.message).toBe('string');
      expect(updateStatusSpy).not.toHaveBeenCalledWith('run-unsupported-1', 'completed', true);
      expect(updateStatusSpy).toHaveBeenCalledWith('run-unsupported-1', 'failed', true);
    });

    it('reservation.create가 CapabilityStatusRegistry에 등록되어 Preflight를 통과하며, DRAFT 모드에서는 AWAITING_APPROVAL을 반환한다', async () => {
      const status = await CapabilityStatusRegistry.getStatus(WORKSPACE_ID, 'reservation.create');
      expect(status.status).toBe('OPERATIONAL_READY');

      const capDef = SOHEE_CAPABILITY_REGISTRY['reservation.create'];
      expect(capDef).toBeDefined();
      expect(capDef.riskTier).toBe('MEDIUM');
      expect(capDef.requiresOwnerApproval).toBe(true);

      const draftRes = await ToolDispatcher.dispatch(
        'reservation.create',
        {
          customerId: 'cust_minji',
          customerName: '김민지',
          serviceId: 'srv_lash',
          serviceName: '속눈썹 펌',
          totalAmountKrw: 50000,
          slotId: '2026-10-15T14:00:00Z',
          depositKrw: 30000,
        },
        { workspaceId: WORKSPACE_ID, intentMode: 'DRAFT', correlationId: 'corr-res-draft' }
      );

      expect(draftRes.success).toBe(true);
      expect(draftRes.status).toBe('AWAITING_APPROVAL');
      expect(draftRes.proposal?.proposalType).toBe('RESERVATION_CONFIRMATION');
    });
  });

  describe('과제 2: 킬스위치/일시정지가 DB 권위 상태를 async로 읽고 fail-closed 적용', () => {
    it('빈 메모리 캐시 상태에서도 DB에 킬스위치가 설정되어 있으면 쓰기 도구를 BLOCKED 판정한다', async () => {
      AgentControlPlaneService.clearTransientCache();

      // DB 모의 클라이언트 설정 (kill_switch_active = true)
      AgentControlPlaneService.setDbClientForTest({
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  workspace_id: WORKSPACE_ID,
                  kill_switch_active: true,
                  actual_mode: 'BLOCKED',
                  blocker_code: 'KILL_SWITCH_ACTIVE',
                  desired_mode: 'PAUSED',
                  version: 5,
                  snapshot_version: 5,
                  transition_id: 't-kill-db',
                  updated_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const admission = await ToolAdmissionController.checkAdmission({
        workspaceId: WORKSPACE_ID,
        capabilityId: 'publish.create',
      });

      expect(admission.admitted).toBe(false);
      expect(admission.status).toBe('BLOCKED');
      expect(admission.errorCode).toBe('KILLSWITCH_ACTIVE');
    });

    it('DB 조회 에러 시 쓰기 도구는 fail-closed로 차단되고 한국어 사유를 반환한다', async () => {
      AgentControlPlaneService.clearTransientCache();

      AgentControlPlaneService.setDbClientForTest({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'Database connection failed' },
              }),
            }),
          }),
        }),
      });

      const writeAdmission = await ToolAdmissionController.checkAdmission({
        workspaceId: WORKSPACE_ID,
        capabilityId: 'publish.create',
      });

      expect(writeAdmission.admitted).toBe(false);
      expect(writeAdmission.status).toBe('BLOCKED');
      expect(writeAdmission.reason).toContain('안전');
    });

    it('DB 조회 에러 시에도 읽기 전용 LOW 위험 도구는 차단되지 않고 emergency_killswitch는 항상 통과한다', async () => {
      AgentControlPlaneService.clearTransientCache();

      AgentControlPlaneService.setDbClientForTest({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'Database connection failed' },
              }),
            }),
          }),
        }),
      });

      const killswitchAdmission = await ToolAdmissionController.checkAdmission({
        workspaceId: WORKSPACE_ID,
        capabilityId: 'emergency_killswitch',
      });
      expect(killswitchAdmission.admitted).toBe(true);

      const readAdmission = await ToolAdmissionController.checkAdmission({
        workspaceId: WORKSPACE_ID,
        capabilityId: 'credit.status',
      });
      expect(readAdmission.admitted).toBe(true);
    });

    it('정상 상태에서는 쓰기 도구가 정상 통과한다', async () => {
      AgentControlPlaneService.clearTransientCache();

      AgentControlPlaneService.setDbClientForTest({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  workspace_id: WORKSPACE_ID,
                  kill_switch_active: false,
                  actual_mode: 'RUNNING',
                  desired_mode: 'RUNNING',
                  blocker_code: null,
                  version: 1,
                  snapshot_version: 1,
                  transition_id: 't-normal',
                  updated_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const admission = await ToolAdmissionController.checkAdmission({
        workspaceId: WORKSPACE_ID,
        capabilityId: 'publish.create',
      });
      expect(admission.admitted).toBe(true);
    });
  });

  describe('과제 3: credit.status 하드코딩 500 제거 및 DB 권위 조회', () => {
    it('context.creditBalance가 주어지면 해당 숫자를 그대로 반환한다', async () => {
      const res = await systemDispatcher.execute(
        { toolName: 'credit.status' },
        { workspaceId: WORKSPACE_ID, correlationId: 'corr-credit-1', creditBalance: 750 }
      );

      expect(res.success).toBe(true);
      expect(res.data?.balance).toBe(750);
      expect((res.logs || [])[0]).toContain('750');
    });

    it('context.creditBalance가 없을 때 DB에서 total_available_credits를 조회하여 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { total_available_credits: 320 },
                error: null,
              }),
            })),
          })),
        })),
      };
      vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any);

      const res = await systemDispatcher.execute(
        { toolName: 'credit.status' },
        { workspaceId: WORKSPACE_ID, correlationId: 'corr-credit-2' }
      );

      expect(res.success).toBe(true);
      expect(res.data?.balance).toBe(320);
      expect((res.logs || [])[0]).toContain('320');
      // 테스트계정 999999 또는 기본값 500이 아니어야 함
      expect(res.data?.balance).not.toBe(500);
      expect(res.data?.balance).not.toBe(999999);
    });

    it('context.creditBalance가 없고 DB 행이 없거나 에러 시 숫자를 지어내지 않고 FAILED 및 한국어 안내를 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Row not found' },
              }),
            })),
          })),
        })),
      };
      vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any);

      const res = await systemDispatcher.execute(
        { toolName: 'credit.status' },
        { workspaceId: WORKSPACE_ID, correlationId: 'corr-credit-3' }
      );

      expect(res.success).toBe(false);
      expect(res.status).toBe('FAILED');
      expect(res.error?.message).toContain('크레딧 정보를 확인할 수 없어요');
      expect(res.data?.balance).toBeUndefined();
      // 로그에 500이나 999999 같은 가짜 숫자가 없어야 함
      expect((res.logs || []).join(' ')).not.toContain('500');
      expect((res.logs || []).join(' ')).not.toContain('999999');
    });
  });
});
