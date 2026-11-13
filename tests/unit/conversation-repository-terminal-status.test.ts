import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}));

it('assistant 메시지의 미션 연결을 durable metadata에 보존한다', async () => {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const query: any = { eq: vi.fn(() => query), then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve) };
  vi.mocked(createAdminSupabaseClient).mockReturnValue({
    from: (table: string) => table === 'messages' ? { insert } : { update: () => query },
  } as any);
  await ConversationRepository.saveMessage('workspace-1', 'thread-1', 'sohee', '계획 검토', {
    runId: 'run-1', missionId: 'mission-1', planVersion: 2, planDiffSummary: '할인 제외',
  } as any);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({
    usage_metadata: expect.objectContaining({ runId: 'run-1', missionId: 'mission-1', planVersion: 2, planDiffSummary: '할인 제외' }),
  }));
});

describe('ConversationRepository.updateAgentRunStatus terminal time check invariants', () => {
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    (createAdminSupabaseClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
      }),
    });
  });

  it('예외 종료는 같은 workspace의 running만 변경하고 고정 오류 코드만 저장한다', async () => {
    const filters: Record<string, unknown> = {};
    const rows = [
      { id: 'run-123', workspace_id: 'ws-1', status: 'running' },
      { id: 'run-123', workspace_id: 'ws-2', status: 'running' },
      { id: 'run-123', workspace_id: 'ws-1', status: 'succeeded' },
      { id: 'run-123', workspace_id: 'ws-1', status: 'cancelled' },
    ];
    const query = {
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        for (const row of rows) {
          if (Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value)) {
            Object.assign(row, mockUpdate.mock.calls[0][0]);
          }
        }
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    mockUpdate.mockReturnValue(query);
    await ConversationRepository.updateAgentRunStatus('run-123', 'failed', true, undefined, {
      workspaceId: 'ws-1', onlyRunning: true, safeErrorCode: 'AGENT_TURN_INTERRUPTED',
    });
    expect(rows.map(row => row.status)).toEqual(['needs_attention', 'running', 'succeeded', 'cancelled']);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      safe_error_code: 'AGENT_TURN_INTERRUPTED', completed_at: expect.any(String),
    }));
  });

  it('비종결 상태(executing/running)로 전이 시 completed_at을 null로 명시하여 제약 조건을 만족한다', async () => {
    await ConversationRepository.updateAgentRunStatus('run-123', 'executing', false);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        completed_at: null,
      })
    );
  });

  it('종결 상태(completed)로 전이 시 completed_at에 ISO 타임스탬프를 설정한다', async () => {
    await ConversationRepository.updateAgentRunStatus('run-123', 'completed', true);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        completed_at: expect.any(String),
      })
    );
  });

  it('종결 상태(failed)로 전이 시 completed 플래그가 false여도 isTerminal에 의해 completed_at을 설정한다', async () => {
    await ConversationRepository.updateAgentRunStatus('run-123', 'failed', false);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'needs_attention',
        completed_at: expect.any(String),
      })
    );
  });
});
