import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { AgentSessionService } from '@/features/agent-session/agent-session-service';
import { PersistenceError } from '@/lib/errors/persistence-error';

// Mock Supabase Server Client
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

const mockFrom = vi.fn();

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

describe('Durable Persistence Fail-Closed Guarantees (ANI-959, ANI-960, ANI-961)', () => {
  const TEST_WORKSPACE = 'ws-fail-closed-test';
  const TEST_THREAD = '00000000-0000-4000-8000-000000000456';
  const TEST_SESSION = 'ses-test-789';

  beforeEach(() => {
    vi.clearAllMocks();
    AgentSessionService.resetMemoryStoreForTesting();

    // Default chain setup
    mockSingle.mockResolvedValue({ data: { id: TEST_THREAD }, error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockLimit.mockReturnValue({ data: [], error: null });
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockEq.mockReturnValue({
      eq: mockEq,
      order: mockOrder,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      order: mockOrder,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    });
    mockInsert.mockReturnValue({
      select: mockSelect,
      error: null,
    });
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockUpsert.mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      return {
        insert: mockInsert,
        update: mockUpdate,
        upsert: mockUpsert,
        select: mockSelect,
        eq: mockEq,
      };
    });
  });

  describe('ANI-959: ConversationRepository.saveMessage Fail-Closed', () => {
    it('throws PersistenceError on DB insert failure and does NOT return a fake/random UUID', async () => {
      mockInsert.mockReturnValue({
        error: { message: 'DB connection terminated unexpectedly', code: '57P01' },
      });

      await expect(
        ConversationRepository.saveMessage(
          TEST_WORKSPACE,
          TEST_THREAD,
          'user',
          'DB 장애 시 이 메시지는 조용히 성공하면 안 됩니다.'
        )
      ).rejects.toThrow(PersistenceError);
    });

    it('throws PersistenceError when createServerSupabaseClient throws an unhandled exception', async () => {
      const { createServerSupabaseClient } = await import('@/lib/supabase/server');
      vi.mocked(createServerSupabaseClient).mockRejectedValueOnce(new Error('Network error reaching Supabase cluster'));

      await expect(
        ConversationRepository.saveMessage(
          TEST_WORKSPACE,
          TEST_THREAD,
          'user',
          '네트워크 장애 발생'
        )
      ).rejects.toThrow(PersistenceError);
    });
  });

  describe('ANI-960: ConversationRepository.createAgentRun Fail-Closed', () => {
    it('throws PersistenceError on agent_runs insert failure and does NOT return a fake UUID', async () => {
      mockInsert.mockReturnValue({
        error: { message: 'relation "agent_runs" does not exist', code: '42P01' },
      });

      await expect(
        ConversationRepository.createAgentRun(
          TEST_WORKSPACE,
          TEST_THREAD,
          '광고 캠페인 생성',
          { plan: 'test' },
          'trace-fail-test'
        )
      ).rejects.toThrow(PersistenceError);
    });

    it('throws PersistenceError when DB client throws unexpected error during createAgentRun', async () => {
      const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
      vi.mocked(createAdminSupabaseClient).mockImplementationOnce(() => {
        throw new Error('Auth token expired');
      });

      await expect(
        ConversationRepository.createAgentRun(
          TEST_WORKSPACE,
          TEST_THREAD,
          '광고 캠페인 생성',
          { plan: 'test' },
          'trace-fail-test-2'
        )
      ).rejects.toThrow(PersistenceError);
    });

    it('aborts execution flow before tool or provider action is triggered when createAgentRun fails', async () => {
      mockInsert.mockReturnValue({
        error: { message: 'Database connection closed', code: '08006' },
      });

      const mockToolExecution = vi.fn();

      const pipeline = async () => {
        const runId = await ConversationRepository.createAgentRun(
          TEST_WORKSPACE,
          TEST_THREAD,
          '인스타그램 리드 수집',
          {},
          'trace-abort-test'
        );
        await mockToolExecution(runId);
      };

      await expect(pipeline()).rejects.toThrow(PersistenceError);
      expect(mockToolExecution).not.toHaveBeenCalled();
    });
  });

  describe('ANI-961: AgentSessionService.persistSession Fail-Closed', () => {
    it('throws PersistenceError on agent_sessions upsert failure and halts pipeline', async () => {
      mockUpsert.mockResolvedValue({
        error: { message: 'Unique constraint violation on workspace session', code: '23505' },
      });

      await expect(
        AgentSessionService.resolveOrCreateSession({
          workspaceId: TEST_WORKSPACE,
          sessionId: TEST_SESSION,
          surface: { route: '/app/campaigns' },
        })
      ).rejects.toThrow(PersistenceError);
    });

    it('throws PersistenceError when updateSurface encounters DB upsert failure', async () => {
      // First resolve session successfully
      mockUpsert.mockResolvedValueOnce({ error: null });
      const initial = await AgentSessionService.resolveOrCreateSession({
        workspaceId: TEST_WORKSPACE,
        sessionId: TEST_SESSION,
        surface: { route: '/app/campaigns' },
      });
      expect(initial.session.sessionId).toBe(TEST_SESSION);

      // Now simulate DB failure on surface update
      mockUpsert.mockResolvedValueOnce({
        error: { message: 'Database disk full', code: '53100' },
      });

      await expect(
        AgentSessionService.updateSurface({
          workspaceId: TEST_WORKSPACE,
          sessionId: TEST_SESSION,
          surface: { route: '/app/analytics' },
        })
      ).rejects.toThrow(PersistenceError);
    });
  });

  describe('Happy Path: Clean durable persistence to Supabase DB', () => {
    it('successfully persists message and updates thread timestamp', async () => {
      mockInsert.mockReturnValue({ error: null });

      const msgId = await ConversationRepository.saveMessage(
        TEST_WORKSPACE,
        TEST_THREAD,
        'sohee',
        '정상 저장된 메시지입니다.',
        { clientMessageId: '11111111-1111-4111-8111-111111111111' }
      );

      expect(msgId).toBe('11111111-1111-4111-8111-111111111111');
      expect(mockFrom).toHaveBeenCalledWith('messages');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
          workspace_id: TEST_WORKSPACE,
          thread_id: TEST_THREAD,
          role: 'sohee',
          content: '정상 저장된 메시지입니다.',
          status: 'completed',
        })
      );
      expect(mockFrom).toHaveBeenCalledWith('conversation_threads');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('successfully persists agent run and returns runId', async () => {
      mockInsert.mockReturnValue({ error: null });

      const runId = await ConversationRepository.createAgentRun(
        TEST_WORKSPACE,
        TEST_THREAD,
        '리드 타겟팅 최적화',
        { mode: 'fast' },
        'trace-happy-123'
      );

      expect(typeof runId).toBe('string');
      expect(runId.length).toBeGreaterThan(0);
      expect(['conversation_jobs', 'agent_runs']).toContain(mockFrom.mock.calls[0][0]);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: runId,
          workspace_id: TEST_WORKSPACE,
          thread_id: TEST_THREAD,
          goal: '리드 타겟팅 최적화',
          trace_id: 'trace-happy-123',
        })
      );
    });

    it('successfully resolves session and persists canonical state to agent_sessions table', async () => {
      mockUpsert.mockResolvedValue({ error: null });

      const result = await AgentSessionService.resolveOrCreateSession({
        workspaceId: TEST_WORKSPACE,
        sessionId: 'ses-happy-path',
        surface: { route: '/app/dashboard' },
      });

      expect(result.session.sessionId).toBe('ses-happy-path');
      expect(mockFrom).toHaveBeenCalledWith('agent_sessions');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: TEST_WORKSPACE,
          session_id: 'ses-happy-path',
          status: 'ACTIVE',
        }),
        { onConflict: 'workspace_id,session_id' }
      );
    });
  });
});
