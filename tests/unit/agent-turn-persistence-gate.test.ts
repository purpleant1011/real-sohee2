import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentOrchestrator } from '@/lib/agent-os/agent-orchestrator'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { AgentLoopEngine } from '@/features/tool-runtime/agent-loop-engine'
import { PersistenceError } from '@/lib/errors/persistence-error'

// 이 테스트의 경계는 메시지 선저장이다. 활동 원장은 전용 DB 계약 테스트에서 검증한다.
const { appendActivity } = vi.hoisted(() => ({ appendActivity: vi.fn() }))
vi.mock('@/features/agent-activity/activity-store', () => ({ appendActivity }))

vi.mock('@/lib/conversation/conversation-repository')
vi.mock('@/features/tool-runtime/agent-loop-engine')
// ANI-1753: buildWorkspaceMarketingContext() 의 DB 조회가 실제 Supabase 로 나가지 않도록 대역을 둔다.
vi.mock('@/lib/supabase/server', async () => (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule())
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule())
vi.mock('@/lib/memory/long-term-memory-service', () => ({
  LongTermMemoryService: {
    retrieveRelevantMemories: vi.fn().mockResolvedValue([]),
    storeMemory: vi.fn().mockResolvedValue(undefined),
  }
}))
vi.mock('@/lib/ai/conversation-brain', () => ({
  ConversationBrain: {
    generateResponse: vi.fn().mockResolvedValue({
      content: '작성을 완료했습니다.',
      totalTokens: 120,
    }),
  },
  isOperationalControlCommand: vi.fn().mockReturnValue(false),
}))
vi.mock('@/features/agent-session/agent-session-service', () => ({
  AgentSessionService: {
    resolveOrCreateSession: vi.fn().mockResolvedValue({
      session: {
        sessionId: '00000000-0000-0000-0000-000000000001',
        threadId: '00000000-0000-0000-0000-000000000002',
      }
    })
  }
}))

describe('ANI-1037: Durable Employee Conversation Gate (No Durable Turn, No Work)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const threadId = '11111111-1111-1111-1111-111111111111'
  const clientMessageId = '22222222-2222-2222-2222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ConversationRepository.getThreadMessagesResult).mockResolvedValue({ state: 'EMPTY', data: [], observedAt: '2026-10-28T00:00:00.000Z' })
    appendActivity.mockReset().mockImplementation(async (_db, input) => ({ ...input, sequence: 1 }))
  })

  it('1. Fails closed when user message persistence fails: Zero downstream tool execution or planning', async () => {
    // Simulate DB failure when persisting user message
    vi.mocked(ConversationRepository.saveMessage).mockRejectedValueOnce(
      new PersistenceError('saveMessage', 'DB connection error while saving user message')
    )

    await expect(
      AgentOrchestrator.executeTurn({
        workspaceId,
        threadId,
        clientMessageId,
        userMessage: '인스타그램 신메뉴 홍보 피드 올려줘',
      })
    ).rejects.toThrow(PersistenceError)

    // DOWNSTREAM VERIFICATION: AgentLoopEngine must NEVER be called
    expect(AgentLoopEngine.run).not.toHaveBeenCalled()
    // Agent run must NOT be created
    expect(ConversationRepository.createAgentRun).not.toHaveBeenCalled()
  })

  it('해석된 세션을 실행 원장에 남겨 활동 append가 대화방 범위를 검사할 수 있다', async () => {
    vi.mocked(ConversationRepository.saveMessage).mockResolvedValueOnce('user-msg-uuid')
    vi.mocked(ConversationRepository.createAgentRun).mockResolvedValueOnce('run-uuid')
    appendActivity.mockRejectedValueOnce(new Error('ACTIVITY_UNAVAILABLE'))

    await expect(AgentOrchestrator.executeTurn({
      workspaceId, sessionId: 'incoming-session', userMessage: '안녕하세요',
    })).rejects.toThrow('ACTIVITY_UNAVAILABLE')

    expect(ConversationRepository.createAgentRun).toHaveBeenCalledWith(
      workspaceId,
      '00000000-0000-0000-0000-000000000002',
      '안녕하세요',
      expect.objectContaining({ sessionId: '00000000-0000-0000-0000-000000000001' }),
      expect.any(String),
      'user-msg-uuid',
    )
    expect(AgentLoopEngine.run).not.toHaveBeenCalled()
  })

  it('2. Persists user message with clientMessageId before any planning/loop begins', async () => {
    vi.mocked(ConversationRepository.saveMessage).mockResolvedValueOnce('user-msg-uuid')
    vi.mocked(ConversationRepository.createAgentRun).mockResolvedValueOnce('run-uuid')
    vi.mocked(AgentLoopEngine.run).mockResolvedValueOnce({
      status: 'COMPLETED',
      finalAnswer: '작성을 완료했습니다.',
      primaryToolName: 'draft_content',
      executedSteps: [],
      accumulatedToolResults: [],
      actionGraph: null,
      cards: {},
      totalCreditsDeducted: 0,
      totalTokens: 100,
    } as any)
    vi.mocked(ConversationRepository.saveMessage).mockResolvedValueOnce('assistant-msg-uuid')

    const result = await AgentOrchestrator.executeTurn({
      workspaceId,
      threadId,
      clientMessageId,
      userMessage: '매장 프로모션 초안 작성해줘',
    })

    // First call to saveMessage must be the user message with clientMessageId
    expect(ConversationRepository.saveMessage).toHaveBeenNthCalledWith(
      1,
      workspaceId,
      threadId,
      'user',
      '매장 프로모션 초안 작성해줘',
      expect.objectContaining({
        clientMessageId,
      })
    )

    // Second call must be assistant message
    expect(ConversationRepository.saveMessage).toHaveBeenNthCalledWith(
      2,
      workspaceId,
      threadId,
      'sohee',
      expect.any(String),
      expect.objectContaining({
        runId: 'run-uuid',
      })
    )

    expect(result.runId).toBe('run-uuid')
    expect(result.replyContent).toBeDefined()
  })
})
