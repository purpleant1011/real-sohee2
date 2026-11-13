import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  dispatch: vi.fn(),
  setSessionStatus: vi.fn(),
  updateRun: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServer }));
vi.mock('@/features/tool-runtime/tool-dispatcher', () => ({
  ToolDispatcher: { dispatch: mocks.dispatch },
}));
vi.mock('../agent-session-service', () => ({
  AgentSessionService: { setSessionStatus: mocks.setSessionStatus },
}));
vi.mock('@/lib/conversation/conversation-repository', () => ({
  ConversationRepository: { updateAgentRunStatus: mocks.updateRun },
}));

import {
  AgentApprovalService,
  resetApprovalExecutionClaimsForTests,
} from '../agent-approval-service';

const workspaceId = 'ws-1';
const proposalId = 'prop-1';

/** DB 에 승인 행이 없는 상태 — 메모리 스토어만 남는 경로(가드가 없으면 이중 실행이 가능했다). */
function dbWithoutRow() {
  const noRow = async () => ({ data: null, error: { message: 'no row' } });
  return {
    from: () => ({
      upsert: () => ({ select: () => ({ single: noRow }) }),
      select: () => ({ eq: () => ({ eq: () => ({ single: noRow }) }) }),
    }),
  };
}

/** DB 에 승인 행이 있으나 상태 저장(update)이 예외로 끊기는 상태. */
function dbWithRowButBrokenUpdate(row: Record<string, unknown>) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }) }),
      update: () => {
        throw new Error('connection reset by peer');
      },
    }),
  };
}

/**
 * DB 커밋은 반영됐지만 응답이 유실된 상태.
 * 첫 select 는 PENDING, update 는 예외, 대사용 select 는 APPROVED 를 돌려준다.
 */
function dbWithLostUpdateResponse(pending: Record<string, unknown>, approved: Record<string, unknown>) {
  let selects = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => {
              selects += 1;
              return { data: selects === 1 ? pending : approved, error: null };
            },
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                throw new Error('socket hang up');
              },
            }),
          }),
        }),
      }),
    }),
  };
}

/** 상태 저장이 끊긴 뒤 대사 재조회까지 실패하는 상태 — 반영 여부를 알 수 없다. */
function dbWithRowAndUnreadableReconcile(row: Record<string, unknown>) {
  let selects = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => {
              selects += 1;
              if (selects === 1) return { data: row, error: null };
              return { data: null, error: { message: 'connection refused' } };
            },
          }),
        }),
      }),
      update: () => {
        throw new Error('connection reset by peer');
      },
    }),
  };
}

const pendingRow = {
  id: 'approval-row-1',
  workspace_id: workspaceId,
  proposal_id: proposalId,
  session_id: 'session-1',
  action_run_id: null,
  proposal_type: 'DM_SEND_APPROVAL',
  title: '답장을 보낼까요?',
  description: '고객에게 답장을 보냅니다.',
  target_field: null,
  current_value: null,
  proposed_value: { threadKey: 'dm:1', body: '네, 가능합니다.' },
  status: 'PENDING',
  actor_id: null,
  rejection_reason: null,
  version: 1,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  created_at: '2026-10-24T00:00:00.000Z',
  updated_at: '2026-10-24T00:00:00.000Z',
  resolved_at: null,
};

async function seedMemoryProposal() {
  mocks.createServer.mockResolvedValue(dbWithoutRow());
  await AgentApprovalService.createProposal({
    workspaceId,
    sessionId: 'session-1',
    proposalId,
    proposalType: 'DM_SEND_APPROVAL',
    title: pendingRow.title,
    description: pendingRow.description,
    proposedValue: pendingRow.proposed_value,
  });
}

describe('AgentApprovalService 외부 쓰기 실행 가드 (ANI-1778)', () => {
  beforeEach(() => {
    AgentApprovalService.resetMemoryStoreForTesting();
    resetApprovalExecutionClaimsForTests();
    mocks.createServer.mockReset();
    mocks.dispatch.mockReset();
    mocks.setSessionStatus.mockReset().mockResolvedValue(undefined);
    mocks.updateRun.mockReset().mockResolvedValue(undefined);
    mocks.dispatch.mockResolvedValue({ success: true, status: 'SENT', data: {} });
  });

  it('같은 승인을 동시에 승인해도 도구는 한 번만 실행한다', async () => {
    await seedMemoryProposal();

    const [a, b] = await Promise.all([
      AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE' }),
      AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE' }),
    ]);

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0][0]).toBe('dm.send');
    const blocked = [a, b].find((r) => r.error?.code === 'ALREADY_EXECUTING');
    expect(blocked).toBeTruthy();
  });

  it('승인 상태 저장이 예외로 끊기면 도구를 실행하지 않는다', async () => {
    mocks.createServer.mockResolvedValue(dbWithRowButBrokenUpdate(pendingRow));

    const result = await AgentApprovalService.resolveApproval({
      workspaceId,
      proposalId,
      action: 'APPROVE',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VERSION_CONFLICT');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('응답만 유실되고 커밋이 반영됐으면 대사 후 도구를 실행한다', async () => {
    const approvedRow = {
      ...pendingRow,
      status: 'APPROVED',
      version: 2,
      resolved_at: '2026-10-24T00:00:05.000Z',
    };
    mocks.createServer.mockResolvedValue(dbWithLostUpdateResponse(pendingRow, approvedRow));

    const result = await AgentApprovalService.resolveApproval({
      workspaceId,
      proposalId,
      action: 'APPROVE',
    });

    // 재시도가 ALREADY_RESOLVED 로 끝나 승인이 영영 실행되지 않던 경로를 막는다.
    expect(result.success).toBe(true);
    expect(result.status).toBe('APPROVED');
    expect(result.approval.version).toBe(2);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0][0]).toBe('dm.send');
  });

  it('반영 여부를 확인할 수 없으면 RESULT_UNKNOWN 으로 끝내고 도구를 실행하지 않는다', async () => {
    mocks.createServer.mockResolvedValue(dbWithRowAndUnreadableReconcile(pendingRow));

    const result = await AgentApprovalService.resolveApproval({
      workspaceId,
      proposalId,
      action: 'APPROVE',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESULT_UNKNOWN');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('expectedVersion 이 다르면 승인을 거부하고 도구를 실행하지 않는다', async () => {
    await seedMemoryProposal();

    const result = await AgentApprovalService.resolveApproval({
      workspaceId,
      proposalId,
      action: 'APPROVE',
      expectedVersion: 99,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VERSION_CONFLICT');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('처음 승인은 EXECUTE 모드로 도구를 한 번 실행한다', async () => {
    await seedMemoryProposal();

    const result = await AgentApprovalService.resolveApproval({
      workspaceId,
      proposalId,
      action: 'APPROVE',
    });

    expect(result.success).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0][1]).toEqual(pendingRow.proposed_value);
    expect(mocks.dispatch.mock.calls[0][2]).toMatchObject({
      workspaceId,
      intentMode: 'EXECUTE',
    });
  });
});
