import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  decideKnowledgeProposal,
  generateCuriosityQueue,
  getStudioKnowledgeViews,
  getStudioOverview,
  listStudioGoals,
  listStudioTurns,
  processStudioTurn,
  resolveCuriosity,
  saveGoal,
  updateStudioGoal,
} from '../services/sohee-studio-service'
import * as repository from '../repository'
import * as aiModule from '../ai'
import * as creditsRepository from '@/features/credits/repository'

vi.mock('../repository', () => ({
  getOrCreateStudioThread: vi.fn(),
  listStudioMessages: vi.fn(),
  ensureUserMessage: vi.fn(),
  claimAssistantTurn: vi.fn(),
  finalizeAssistantTurn: vi.fn(),
  persistTurn: vi.fn(),
  decideProposal: vi.fn(),
  listGoals: vi.fn(),
  listDecisions: vi.fn(),
  decideQuestion: vi.fn(),
  listProposals: vi.fn(),
  listKnowledgeDetails: vi.fn(),
  updateGoal: vi.fn(),
}))

vi.mock('../ai', () => ({
  generateStudioTurnAi: vi.fn(),
}))

vi.mock('@/features/credits/repository', () => ({
  reserveCredits: vi.fn(),
  settleCredits: vi.fn(),
  releaseCredits: vi.fn(),
}))

const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => mockSupabase,
}))

describe('SoheeStudioService (Production V1 - Hardened)', () => {
  const testWorkspaceId = 'ws-test-1234'
  const testUserId = 'user-test-5678'
  const testThreadId = 'thread-test-9999'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SOHEE_CHAT_TURN_CREDITS = '1'
    vi.mocked(repository.listGoals).mockResolvedValue([])
  })

  it('preserves owner-confirmed effective dates through the knowledge decision service', async () => {
    vi.mocked(repository.listProposals).mockResolvedValue([{ id: 'proposal-validity', kind: 'fact' } as any])
    vi.mocked(repository.decideProposal).mockResolvedValue({ success: true, id: 'proposal-validity', status: 'confirmed', kind: 'fact' })
    const validity = { validFrom: '2026-11-01T00:00:00+09:00', validUntil: '2026-12-01T00:00:00+09:00' }
    await decideKnowledgeProposal(testWorkspaceId, testUserId, 'proposal-validity', 'confirm', undefined, undefined, validity)
    expect(repository.decideProposal).toHaveBeenCalledWith(expect.objectContaining(validity))
  })

  describe('generateCuriosityQueue', () => {
    it('generates questions based on missing knowledge categories with neutral wording', () => {
      const existing = [{ category: 'MENU', content: '시그니처 메뉴' }]
      const queue = generateCuriosityQueue(testWorkspaceId, existing)

      expect(queue.length).toBeGreaterThan(0)
      const hoursQ = queue.find((q) => q.id.includes('hours'))
      expect(hoursQ).toBeDefined()
      expect(hoursQ?.priority).toBe('important')
      expect(hoursQ?.status).toBe('open')

      const diffQ = queue.find((q) => q.id.includes('differentiator'))
      expect(diffQ).toBeDefined()
    })
  })

  describe('getStudioOverview', () => {
    it('returns overview with real statistics, educationReadiness: null, and recentActivity: []', async () => {
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: 'fact-1',
          category: 'HOURS',
          content: '매일 10시-22시',
          status: 'active',
          source: { kind: 'owner_statement', sourceId: 'msg-1' },
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: ['content'],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-1',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'fact',
          category: 'PRICE',
          proposedContent: '가격 15,000원',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.listDecisions).mockResolvedValueOnce([
        {
          workspaceId: testWorkspaceId,
          questionKey: 'HOURS',
          status: 'snoozed',
          updatedBy: testUserId,
          createdAt: '2026-10-16T00:00:00Z',
          updatedAt: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.listGoals).mockResolvedValueOnce([
        {
          id: 'goal-1',
          workspaceId: testWorkspaceId,
          title: '예약 20% 증대',
          desiredOutcome: '신규 고객 확보',
          priority: 'high',
          status: 'active',
          version: 1,
          createdAt: '2026-10-16T00:00:00Z',
          updatedAt: '2026-10-16T00:00:00Z',
        },
      ])

      const overview = await getStudioOverview(testWorkspaceId)

      expect(overview.workspaceId).toBe(testWorkspaceId)
      expect(overview.knowledgeStats.activeCount).toBe(1)
      expect(overview.knowledgeStats.pendingProposalCount).toBe(1)
      expect(overview.knowledgeStats.byCategory).toEqual({ HOURS: 1 })
      expect(overview.educationReadiness).toBeNull()
      expect(overview.recentActivity).toEqual([])
      expect(overview.activeGoals).toHaveLength(1)

      const hoursQuestion = overview.topQuestions.find((q) => q.id.includes('hours'))
      expect(hoursQuestion).toBeUndefined()
    })

    it('re-includes snoozed question after 24 hours have elapsed but permanently excludes not_applicable', async () => {
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.listProposals).mockResolvedValueOnce([])
      vi.mocked(repository.listGoals).mockResolvedValueOnce([])

      const now = new Date('2026-10-17T12:00:00.000Z')
      const twentyFiveHoursAgo = new Date('2026-10-16T11:00:00.000Z').toISOString()
      const twoHoursAgo = new Date('2026-10-17T10:00:00.000Z').toISOString()

      vi.mocked(repository.listDecisions).mockResolvedValueOnce([
        {
          workspaceId: testWorkspaceId,
          questionKey: 'HOURS',
          status: 'snoozed',
          updatedBy: testUserId,
          createdAt: twentyFiveHoursAgo,
          updatedAt: twentyFiveHoursAgo,
        },
        {
          workspaceId: testWorkspaceId,
          questionKey: 'PRICE',
          status: 'snoozed',
          updatedBy: testUserId,
          createdAt: twoHoursAgo,
          updatedAt: twoHoursAgo,
        },
        {
          workspaceId: testWorkspaceId,
          questionKey: 'DIFFERENTIATOR',
          status: 'not_applicable',
          updatedBy: testUserId,
          createdAt: twentyFiveHoursAgo,
          updatedAt: twentyFiveHoursAgo,
        },
      ])

      const overview = await getStudioOverview(testWorkspaceId, now)

      // 25시간 경과한 HOURS는 24시간 만료되어 재등장
      const hoursQ = overview.topQuestions.find((q) => q.id.includes('hours'))
      expect(hoursQ).toBeDefined()

      // 2시간 경과한 PRICE는 계속 숨김
      const priceQ = overview.topQuestions.find((q) => q.id.includes('price'))
      expect(priceQ).toBeUndefined()

      // not_applicable인 DIFFERENTIATOR는 영구 제외
      const diffQ = overview.topQuestions.find((q) => q.id.includes('differentiator'))
      expect(diffQ).toBeUndefined()
    })

    it('propagates DB query error without silent empty fallback', async () => {
      vi.mocked(repository.listKnowledgeDetails).mockRejectedValueOnce(new Error('DATABASE_CONNECTION_ERROR'))

      await expect(getStudioOverview(testWorkspaceId)).rejects.toThrow('DATABASE_CONNECTION_ERROR')
    })
  })

  describe('getStudioKnowledgeViews', () => {
    it('returns filtered views by category and propagates DB errors', async () => {
      const mockViews = [
        {
          id: 'fact-1',
          category: 'MENU',
          content: '제주 흑돼지',
          status: 'active' as const,
          source: { kind: 'owner_statement' as const, sourceId: 'src-1' },
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: ['content' as const],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
      ]
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce(mockViews)

      const filtered = await getStudioKnowledgeViews(testWorkspaceId, 'MENU')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('fact-1')

      vi.mocked(repository.listKnowledgeDetails).mockRejectedValueOnce(new Error('KNOWLEDGE_DB_UNAVAILABLE'))
      await expect(getStudioKnowledgeViews(testWorkspaceId)).rejects.toThrow('KNOWLEDGE_DB_UNAVAILABLE')
    })
  })

  describe('listStudioTurns', () => {
    it('returns empty array without creating a thread if no active thread exists (read-only for viewers)', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      })

      const turns = await listStudioTurns(testWorkspaceId)
      expect(turns).toEqual([])
      expect(repository.getOrCreateStudioThread).not.toHaveBeenCalled()
    })

    it('retrieves messages and connects proposals with strict fact filter', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: testThreadId },
          error: null,
        }),
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({
        messages: [
          {
            id: 'msg-u1',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'user',
            content: '영업시간은 11시부터입니다',
            status: 'completed',
            client_message_id: 'client-m-1',
            created_at: '2026-10-16T01:00:00Z',
          },
          {
            id: 'msg-a1',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'sohee',
            content: '영업시간을 등록할게요.',
            status: 'completed',
            reply_to_message_id: 'msg-u1',
            created_at: '2026-10-16T01:00:02Z',
          },
        ],
        proposals: [
          {
            id: 'prop-1',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u1',
            kind: 'fact',
            category: 'HOURS',
            proposedContent: '매일 11시 오픈',
            evidence: [],
            status: 'proposed',
            createdAt: '2026-10-16T01:00:02Z',
          },
          {
            id: 'prop-goal-1',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u1',
            kind: 'goal',
            category: '예약 증대',
            proposedContent: '예약 20% 늘리기',
            evidence: [],
            status: 'proposed',
            createdAt: '2026-10-16T01:00:02Z',
          },
        ],
      })

      const turns = await listStudioTurns(testWorkspaceId)
      expect(turns).toHaveLength(2)
      // factProposals는 오직 kind === 'fact'만 포함 (goal proposal이 섞이지 않음)
      expect(turns[1].proposals).toHaveLength(1)
      expect(turns[1].proposals?.[0].id).toBe('prop-1')
      expect(turns[1].suggestedGoal?.id).toBe('prop-goal-1')
    })

    it('filters out confirmed and rejected proposals on reload (only status proposed appears as cards)', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: testThreadId },
          error: null,
        }),
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({
        messages: [
          {
            id: 'msg-u1',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'user',
            content: '대화 내용',
            status: 'completed',
            client_message_id: 'client-m-1',
            created_at: '2026-10-16T01:00:00Z',
          },
          {
            id: 'msg-a1',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'sohee',
            content: '소희 답변',
            status: 'completed',
            reply_to_message_id: 'msg-u1',
            created_at: '2026-10-16T01:00:02Z',
          },
        ],
        proposals: [
          {
            id: 'prop-confirmed',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u1',
            kind: 'fact',
            category: 'HOURS',
            proposedContent: '이미 확정된 사실',
            evidence: [],
            status: 'confirmed',
            createdAt: '2026-10-16T01:00:02Z',
          },
          {
            id: 'prop-rejected',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u1',
            kind: 'goal',
            category: '제외된 목표',
            proposedContent: '이미 제외된 목표',
            evidence: [],
            status: 'rejected',
            createdAt: '2026-10-16T01:00:02Z',
          },
        ],
      })

      const turns = await listStudioTurns(testWorkspaceId)
      expect(turns).toHaveLength(2)
      // 이미 확정되거나 제외된 제안은 다시 대기 카드로 노출되지 않음
      expect(turns[1].proposals).toBeUndefined()
      expect(turns[1].suggestedGoal).toBeUndefined()
    })
  })

  describe('processStudioTurn', () => {
    const defaultTurnParams = {
      workspaceId: testWorkspaceId,
      userId: testUserId,
      clientMessageId: '10000000-0000-4000-8000-000000000001',
      content: '우리 매장은 지하 주차장 2시간 무료 지원돼요',
    }

    it('fails closed when SOHEE_CHAT_TURN_CREDITS is invalid', async () => {
      process.env.SOHEE_CHAT_TURN_CREDITS = 'invalid_number'
      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow(
        /CONFIG_INVALID: SOHEE_CHAT_TURN_CREDITS/
      )
    })

    it('secures claim before calling AI provider and settles credits on success', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-100',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: defaultTurnParams.content,
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-100',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-100',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({
        messages: [
          {
            id: 'old-1',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'user',
            content: '이전 대화',
            status: 'completed',
            created_at: '2026-10-16T01:00:00Z',
          },
        ],
        proposals: [],
      })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '주차 지원 혜택을 등록해 드릴까요?',
        intent: 'teach',
        proposals: [{ category: 'PARKING', content: '지하 주차장 2시간 무료 지원' }],
        modelId: 'gemini-3.8-flash-production',
        usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-100',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '주차 지원 혜택을 등록해 드릴까요?',
          status: 'completed',
          reply_to_message_id: 'msg-u-100',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [
          {
            id: 'prop-saved-100',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u-100',
            kind: 'fact',
            category: 'PARKING',
            proposedContent: '지하 주차장 2시간 무료 지원',
            evidence: [],
            status: 'proposed',
            createdAt: '2026-10-16T02:00:02Z',
          },
        ],
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'settled' },
      })

      const reply = await processStudioTurn(defaultTurnParams)

      expect(repository.ensureUserMessage).toHaveBeenCalledTimes(1)
      expect(repository.claimAssistantTurn).toHaveBeenCalledTimes(1)
      expect(creditsRepository.reserveCredits).toHaveBeenCalledTimes(1)
      expect(aiModule.generateStudioTurnAi).toHaveBeenCalledTimes(1)
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          usageMetadata: {
            model: 'gemini-3.8-flash-production',
            usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
          },
        })
      )
      expect(creditsRepository.settleCredits).toHaveBeenCalledTimes(1)
      expect(reply.sender).toBe('sohee')
      expect(reply.proposals).toHaveLength(1)
    })

    it('rejects concurrent streaming replay with STUDIO_TURN_CONFLICT', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-100',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: defaultTurnParams.content,
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: false,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-streaming',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-100',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: false,
      })

      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow('STUDIO_TURN_CONFLICT')
      expect(aiModule.generateStudioTurnAi).not.toHaveBeenCalled()
    })

    it('releases reserved credits and throws STUDIO_AI_GENERATION_FAILED when provider fails', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-timeout',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: defaultTurnParams.content,
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-timeout',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-timeout',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockRejectedValueOnce(
        new Error('Upstream network timeout with sensitive api key')
      )
      vi.mocked(creditsRepository.releaseCredits).mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'released' },
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-timeout',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '답변을 생성하지 못했어요.',
          status: 'failed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow('STUDIO_AI_GENERATION_FAILED')

      expect(creditsRepository.releaseCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: testWorkspaceId,
          reservationId: defaultTurnParams.clientMessageId,
        })
      )
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          usageMetadata: expect.objectContaining({ error: 'STUDIO_AI_GENERATION_FAILED' }),
        })
      )
    })

    it('marks assistant failed when credit settlement fails to prevent clean replay', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-100',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: defaultTurnParams.content,
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-100',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-100',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '응답 완료',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn)
        .mockResolvedValueOnce({
          assistantMessage: {
            id: 'msg-a-100',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'sohee',
            content: '응답 완료',
            status: 'completed',
            created_at: '2026-10-16T02:00:02Z',
          },
          proposals: [],
        })
        .mockResolvedValueOnce({
          assistantMessage: {
            id: 'msg-a-100',
            workspace_id: testWorkspaceId,
            thread_id: testThreadId,
            role: 'sohee',
            content: '크레딧 정산에 실패하였습니다.',
            status: 'failed',
            created_at: '2026-10-16T02:00:03Z',
          },
          proposals: [],
        })
      // 정산 실패 시뮬레이션
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        error: { code: 'CREDIT_RPC_FAILED' },
      })

      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow('CREDIT_RPC_FAILED')
      // 정산 실패 시 assistant 메시지를 failed로 마킹하여 replay 시 성공 위장 방지
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          usageMetadata: expect.objectContaining({ billing_error: 'CREDIT_RPC_FAILED' }),
        })
      )
    })

    it('only checks fact boundary when focus is inspect; curiosity key does NOT throw STUDIO_FACT_NOT_FOUND', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-curiosity',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '대표 메뉴는 삼겹살입니다',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-curiosity',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-curiosity',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '대표 메뉴 삼겹살을 등록할게요.',
        intent: 'teach',
        proposals: [{ category: 'MENU', content: '대표 삼겹살' }],
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-curiosity',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '대표 메뉴 삼겹살을 등록할게요.',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'settled' },
      })

      // focus: curiosity 일 때는 relatedEntityId가 stable question key ('curiosity_ws_menu_price')여도 에러를 던지지 않음
      const reply = await processStudioTurn({
        ...defaultTurnParams,
        focus: 'curiosity',
        relatedEntityId: `curiosity_${testWorkspaceId}_menu_price`,
      })

      expect(reply.relatedCuriosityId).toBe(`curiosity_${testWorkspaceId}_menu_price`)
    })

    it('throws STUDIO_FACT_NOT_FOUND when focus is inspect and relatedEntityId does not exist in facts', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])

      await expect(
        processStudioTurn({
          ...defaultTurnParams,
          focus: 'inspect',
          relatedEntityId: 'non-existent-fact-uuid',
        })
      ).rejects.toThrow('STUDIO_FACT_NOT_FOUND')
    })

    it('fails closed with STUDIO_FACT_NOT_FOUND when model returns replacesFactId that does not exist in workspace facts', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: 'fact-real-1',
          category: 'HOURS',
          content: '10시 오픈',
          status: 'active',
          source: { kind: 'owner_statement', sourceId: 's-1' },
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: ['content'],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-ghost',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '영업시간 바뀜',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-ghost',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답 준비',
          status: 'streaming',
          reply_to_message_id: 'msg-u-ghost',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      // 모델이 워크스페이스에 존재하지 않는 유령 fact ID를 replacesFactId로 반환
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '영업시간 수정할게요.',
        intent: 'teach',
        proposals: [{ category: 'HOURS', content: '11시 오픈', replacesFactId: 'ghost-fact-uuid-999' }],
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-ghost',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '수정하려는 기존 지식을 찾을 수 없어요. 최신 지식 목록을 확인해 주세요.',
          status: 'failed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // 신규 fact로 전환되지 않고 fail-closed 차단되어야 함
      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow('STUDIO_FACT_NOT_FOUND')
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        })
      )
    })

    it('enforces 1 proposal per correction target when focus is inspect, ignoring duplicate replacements', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: 'fact-target-1',
          category: 'HOURS',
          content: '10시 오픈',
          status: 'active',
          source: { kind: 'owner_statement', sourceId: 's-1' },
          createdAt: '2026-10-16T01:00:00.000Z',
          approvedAt: '2026-10-16T02:00:00.000Z',
          validFrom: '2026-10-16T03:00:00.000Z',
          versionTimestamp: '2026-10-16T01:00:00.000Z',
          usedBy: [],
        },
      ])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-inspect',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '11시 오픈으로 수정',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-inspect',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답 준비',
          status: 'streaming',
          reply_to_message_id: 'msg-u-inspect',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      // 모델이 동일 target에 대해 2개의 제안을 반환한 상황
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '영업시간 수정할게요.',
        intent: 'teach',
        proposals: [
          { category: 'HOURS', content: '11시 오픈 1안' },
          { category: 'HOURS', content: '11시 오픈 2안' },
        ],
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-inspect',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '영업시간 수정할게요.',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [
          {
            id: 'prop-single-1',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u-inspect',
            kind: 'fact',
            category: 'HOURS',
            proposedContent: '11시 오픈 1안',
            evidence: [],
            status: 'proposed',
            createdAt: '2026-10-16T02:00:02Z',
          },
        ],
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'settled' },
      })

      const reply = await processStudioTurn({
        ...defaultTurnParams,
        focus: 'inspect',
        relatedEntityId: 'fact-target-1',
      })

      // finalizeAssistantTurn에 전달된 proposals가 정확히 1개여야 하며
      // expectedFactCreatedAt은 approvedAt이나 validFrom이 아닌 오직 실제 createdAt/versionTimestamp만 사용해야 함
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          proposals: [
            expect.objectContaining({
              replacesFactId: 'fact-target-1',
              content: '11시 오픈 1안',
              expectedFactCreatedAt: '2026-10-16T01:00:00.000Z',
            }),
          ],
        })
      )
      expect(reply.proposals).toHaveLength(1)
    })

    it('releases reserved credits and marks assistant failed when DB context query rejects (AI 0 calls, 0 credit leak, 0 dangling claims)', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-ctx-fail',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: defaultTurnParams.content,
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-ctx-fail',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-ctx-fail',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      // DB 문맥(대화 내역) 조회 실패
      vi.mocked(repository.listStudioMessages).mockRejectedValueOnce(
        new Error('DB_CONTEXT_QUERY_FAILED')
      )
      vi.mocked(creditsRepository.releaseCredits).mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'released' },
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-ctx-fail',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '문맥 정보를 불러오지 못하여 답변 생성을 중단했어요.',
          status: 'failed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow('DB_CONTEXT_QUERY_FAILED')

      // 1. 예약된 크레딧이 즉시 릴리즈되어 잔액 누수 방지
      expect(creditsRepository.releaseCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: testWorkspaceId,
          reservationId: defaultTurnParams.clientMessageId,
        })
      )
      // 2. 어시스턴트 메시지가 failed로 마킹되어 streaming 영구 잔류 방지
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          usageMetadata: expect.objectContaining({ error: 'DB_CONTEXT_QUERY_FAILED' }),
        })
      )
      // 3. AI provider는 0회 호출
      expect(aiModule.generateStudioTurnAi).not.toHaveBeenCalled()
    })

    it('blocks assistant response promotion and marks status as failed when learning source was revoked mid-flight', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: 'fact-channel-1',
          category: 'MENU',
          content: '인스타 메뉴 바닐라 라떼',
          status: 'active',
          source: { kind: 'channel', sourceId: 'src-revoked-1' } as any,
          createdAt: '2026-10-16T00:00:00Z',
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
          usedBy: ['content'],
        },
      ])
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-revoke',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '메뉴 알려줘',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-revoke',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '응답을 준비하고 있습니다.',
          status: 'streaming',
          reply_to_message_id: 'msg-u-revoke',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '바닐라 라떼가 맛있어요!',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-revoke',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '가게 정보가 변경되어 답변을 완료하지 못했어요.',
          status: 'failed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // validateLearning fails because source was revoked during AI execution!
      const mockValidateLearning = vi.fn().mockResolvedValue(false)

      await expect(
        processStudioTurn({
          ...defaultTurnParams,
          _deps: {
            validateLearning: mockValidateLearning,
          },
        })
      ).rejects.toThrow('STUDIO_KNOWLEDGE_REVOKED')

      expect(mockValidateLearning).toHaveBeenCalled()
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          usageMetadata: expect.objectContaining({ error: 'LEARNING_SOURCE_REVOKED' }),
        })
      )
    })

    it('production default: queries get_approved_learning_context RPC and validates via validate_learning_result RPC with actual epoch', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-prod',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '채널 지식으로 답변해줘',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-prod',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: {
          reservationId: defaultTurnParams.clientMessageId,
          state: 'settled',
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '채널에서 배운 메뉴입니다!',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-prod',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '채널에서 배운 메뉴입니다!',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // mockSupabase.rpc:
      // 1) get_approved_learning_context -> returns channel knowledge with epoch 5 and leaf dependencies
      // 2) validate_learning_result -> returns true
      mockSupabase.rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return {
            data: [
              {
                id: 'fact-ch-1',
                category: 'MENU',
                content: '시그니처 바닐라빈 라떼',
                source_type: 'channel',
                source_id: 'src-insta-1',
                source_revision: 2,
                epoch: 5,
                dependencies: [
                  { sourceId: 'src-insta-1', revision: 2 },
                  { sourceId: 'src-insta-leaf-2', revision: 3 },
                ],
              },
            ],
            error: null,
          }
        }
        if (fn === 'validate_learning_result') {
          return { data: true, error: null }
        }
        return { data: null, error: null }
      })

      // Call WITHOUT _deps (production path)
      const reply = await processStudioTurn(defaultTurnParams)

      expect(reply.content).toBe('채널에서 배운 메뉴입니다!')
      // Verify get_approved_learning_context was called with purpose: conversation
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_approved_learning_context',
        expect.objectContaining({
          p_workspace_id: testWorkspaceId,
          p_purpose: 'conversation',
        })
      )
      // Verify validate_learning_result was called with actual epoch 5 (NOT hardcoded 1!) and all-leaf dependencies
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'validate_learning_result',
        expect.objectContaining({
          p_workspace_id: testWorkspaceId,
          p_expected_epoch: 5,
          p_purpose: 'conversation',
          p_dependencies: expect.arrayContaining([
            { workspaceId: testWorkspaceId, sourceId: 'src-insta-1', revision: 2 },
            { workspaceId: testWorkspaceId, sourceId: 'src-insta-leaf-2', revision: 3 },
          ]),
        })
      )
    })

    it('production default: blocks completed turn when validate_learning_result returns false', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-revoked',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '채널 지식 조회',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-revoked',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '답변 생성 완료',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-revoked',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '가게 정보가 변경되어 답변을 완료하지 못했어요.',
          status: 'failed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // validate_learning_result returns false because source was revoked during AI execution!
      mockSupabase.rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return {
            data: [
              {
                id: 'fact-ch-2',
                category: 'PRICE',
                content: '아메리카노 4500원',
                source_type: 'channel',
                source_id: 'src-insta-rev',
                source_revision: 1,
                epoch: 3,
                dependencies: [{ sourceId: 'src-insta-rev', revision: 1 }],
              },
            ],
            error: null,
          }
        }
        if (fn === 'validate_learning_result') {
          return { data: false, error: null }
        }
        return { data: null, error: null }
      })

      await expect(processStudioTurn(defaultTurnParams)).rejects.toThrow('STUDIO_KNOWLEDGE_REVOKED')

      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          usageMetadata: expect.objectContaining({ error: 'LEARNING_SOURCE_REVOKED' }),
        })
      )
    })

    it('does not fall back to legacy facts when get_approved_learning_context returns normal empty items', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-empty',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '지식 없어도 대화 진행',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-empty',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: {
          reservationId: defaultTurnParams.clientMessageId,
          state: 'settled',
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '안녕하세요 사장님!',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-empty',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '안녕하세요 사장님!',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // Normal empty RPC result
      mockSupabase.rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return { data: [], error: null }
        }
        return { data: null, error: null }
      })

      const reply = await processStudioTurn(defaultTurnParams)

      expect(reply.content).toBe('안녕하세요 사장님!')
      // listKnowledgeDetails should NOT be called as fallback!
      expect(repository.listKnowledgeDetails).not.toHaveBeenCalled()
      // AI was called with empty approvedFacts
      expect(aiModule.generateStudioTurnAi).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedFacts: [],
        })
      )
    })

    it('fails closed on channel knowledge when get_approved_learning_context RPC errors, preserving manual facts', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-fallback',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '지식 조회',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-fallback',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: {
          reservationId: defaultTurnParams.clientMessageId,
          state: 'settled',
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '수동 지식만 안전하게 사용했습니다.',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-fallback',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '수동 지식만 안전하게 사용했습니다.',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // RPC fails with error
      mockSupabase.rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return { data: null, error: { message: 'RPC_UNAVAILABLE' } }
        }
        return { data: null, error: null }
      })

      // Fallback listKnowledgeDetails returns both manual and channel-like facts
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: 'fact-manual-1',
          category: 'HOURS',
          content: '매일 10:00 - 22:00',
          status: 'active',
          source: { kind: 'owner_statement', sourceId: 'src-1', observedAt: '2026-10-16T00:00:00Z' },
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: [],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
        {
          id: 'fact-channel-unverified',
          category: 'MENU',
          content: '인스타 미검증 메뉴',
          status: 'active',
          // channel source in fallback must be stripped (fail-closed!)
          source: { kind: 'imported_source', sourceId: 'src-insta-unverified', observedAt: '2026-10-16T00:00:00Z' },
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: [],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
      ])

      const reply = await processStudioTurn(defaultTurnParams)

      expect(reply.content).toBe('수동 지식만 안전하게 사용했습니다.')
      // Verify only manual fact is passed to AI, channel fact is stripped
      expect(aiModule.generateStudioTurnAi).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedFacts: [
            { id: 'fact-manual-1', category: 'HOURS', content: '매일 10:00 - 22:00' },
          ],
        })
      )
    })

    it('(1) releases reserved credits exactly once and never settles when validateLearning returns false', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-rel',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '지식 질의',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-rel',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      const mockReserve = vi.fn().mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      const mockRelease = vi.fn().mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'released' },
      })
      const mockSettle = vi.fn()
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '답변 완료',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })

      mockSupabase.rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return {
            data: [
              {
                id: 'fact-ch-rel',
                category: 'PRICE',
                content: '아메리카노 4500원',
                source_type: 'channel',
                source_id: 'src-insta-rel',
                source_revision: 1,
                epoch: 1,
                dependencies: [{ sourceId: 'src-insta-rel', revision: 1 }],
              },
            ],
            error: null,
          }
        }
        if (fn === 'validate_learning_result') {
          return { data: false, error: null }
        }
        return { data: null, error: null }
      })

      await expect(
        processStudioTurn({
          ...defaultTurnParams,
          _deps: {
            reserveCredits: mockReserve as any,
            releaseCredits: mockRelease as any,
            settleCredits: mockSettle as any,
          },
        })
      ).rejects.toThrow('STUDIO_KNOWLEDGE_REVOKED')

      // Must release credits exactly once and never settle
      expect(mockRelease).toHaveBeenCalledTimes(1)
      expect(mockRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: testWorkspaceId,
          reservationId: defaultTurnParams.clientMessageId,
          credits: 1,
        })
      )
      expect(mockSettle).not.toHaveBeenCalled()
    })

    it('(2) fails closed in fallback on channel candidates having evidence_document_id or unknown origin, preserving onboarding facts', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-fallback-doc',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '가게 소개',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-fallback-doc',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: {
          reservationId: defaultTurnParams.clientMessageId,
          state: 'settled',
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '가게 소개 답변',
        intent: 'none',
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-fallback-doc',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '가게 소개 답변',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // RPC fails
      mockSupabase.rpc.mockImplementation(async () => {
        return { data: null, error: { message: 'RPC_UNAVAILABLE' } }
      })

      // Fallback returns 3 facts:
      // 1) Onboarding fact (owner statement / interview) -> keep
      // 2) Channel candidate with evidence_document_id (source_location is null!) -> must fail closed (strip!)
      // 3) Unknown provenance fact -> must fail closed (strip!)
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: 'fact-onboarding-1',
          category: 'HOURS',
          content: '온보딩에서 직접 입력한 영업시간 10:00 - 22:00',
          status: 'active',
          source: { kind: 'owner_statement', sourceId: 'src-manual-onboarding', observedAt: '2026-10-16T00:00:00Z' },
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: [],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
        {
          id: 'fact-channel-doc-only',
          category: 'MENU',
          content: '채널 후보: source_location은 null이지만 evidence_document_id가 있는 메뉴',
          status: 'active',
          source: {
            kind: 'unknown',
            sourceId: 'src-uuid-channel-opaque',
            evidenceDocumentId: 'doc-channel-evidence-uuid-1',
            observedAt: '2026-10-16T00:00:00Z',
          } as any,
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: [],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
        {
          id: 'fact-uncertain-origin',
          category: 'PRICE',
          content: '출처 불명 가격 정보',
          status: 'active',
          source: { kind: 'unknown', sourceId: 'opaque-source-1' } as any,
          approvedAt: '2026-10-16T00:00:00Z',
          validFrom: '2026-10-16T00:00:00Z',
          usedBy: [],
          createdAt: '2026-10-16T00:00:00Z',
          versionTimestamp: '2026-10-16T00:00:00Z',
        },
      ])

      const reply = await processStudioTurn(defaultTurnParams)

      expect(reply.content).toBe('가게 소개 답변')
      // Only onboarding fact must be preserved!
      expect(aiModule.generateStudioTurnAi).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedFacts: [
            {
              id: 'fact-onboarding-1',
              category: 'HOURS',
              content: '온보딩에서 직접 입력한 영업시간 10:00 - 22:00',
            },
          ],
        })
      )
    })

    it('(3) calls get_approved_learning_context with p_query: "" so that low-relevance facts are preserved for focus: inspect', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      const targetFactId = 'fact-hours-target'

      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-inspect',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '아니 21시까지야', // Has zero keyword relevance to "영업시간"
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-inspect',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: {
          reservationId: defaultTurnParams.clientMessageId,
          state: 'settled',
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '영업시간을 21시로 교정할게요.',
        intent: 'teach',
        proposals: [{ category: 'HOURS', content: '매일 10:00 - 21:00', replacesFactId: targetFactId }],
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-inspect',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '영업시간을 21시로 교정할게요.',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [
          {
            id: 'prop-hours-new',
            workspaceId: testWorkspaceId,
            threadId: testThreadId,
            sourceMessageId: 'msg-u-inspect',
            kind: 'fact',
            category: 'HOURS',
            proposedContent: '매일 10:00 - 21:00',
            replacesFactId: targetFactId,
            evidence: [],
            status: 'proposed',
            createdAt: '2026-10-16T02:00:02Z',
          },
        ],
      })

      // When p_query is '', the RPC returns the full knowledge scope including targetFact
      mockSupabase.rpc.mockImplementation(async (fn: string, args: any) => {
        if (fn === 'get_approved_learning_context') {
          // If p_query is not empty string, simulate relevance filtering excluding targetFact
          if (args.p_query && args.p_query !== '') {
            return { data: [], error: null }
          }
          return {
            data: [
              {
                id: targetFactId,
                category: 'HOURS',
                content: '매일 10:00 - 20:00',
                source_type: 'manual',
                epoch: 1,
                created_at: '2026-10-15T00:00:00Z',
              },
            ],
            error: null,
          }
        }
        return { data: null, error: null }
      })

      const reply = await processStudioTurn({
        ...defaultTurnParams,
        content: '아니 21시까지야',
        focus: 'inspect',
        relatedEntityId: targetFactId,
      })

      expect(reply.content).toBe('영업시간을 21시로 교정할게요.')
      // p_query must be '' to preserve entire active knowledge scope for inspect/replaces
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_approved_learning_context',
        expect.objectContaining({
          p_query: '',
        })
      )
    })

    it('(2-1) enriches expectedFactCreatedAt from repository when RPC get_approved_learning_context omits created_at', async () => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      const targetFactId = 'fact-legacy-schema-no-created-at'
      const canonicalCreatedAt = '2026-10-15T09:30:00Z'

      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-enrich',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '가격 변경',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-enrich',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      vi.mocked(creditsRepository.reserveCredits).mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      vi.mocked(creditsRepository.settleCredits).mockResolvedValueOnce({
        data: {
          reservationId: defaultTurnParams.clientMessageId,
          state: 'settled',
        },
      })
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '가격 5000원으로 수정할게요.',
        intent: 'teach',
        proposals: [{ category: 'PRICE', content: '라떼 5000원', replacesFactId: targetFactId }],
        modelId: 'gemini-3.8-flash',
      })
      vi.mocked(repository.finalizeAssistantTurn).mockResolvedValueOnce({
        assistantMessage: {
          id: 'msg-a-enrich',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '가격 5000원으로 수정할게요.',
          status: 'completed',
          created_at: '2026-10-16T02:00:02Z',
        },
        proposals: [],
      })

      // RPC returns item WITHOUT created_at (older RPC schema)
      mockSupabase.rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return {
            data: [
              {
                id: targetFactId,
                category: 'PRICE',
                content: '라떼 4500원',
                source_type: 'manual',
                epoch: 1,
                // created_at is omitted!
              },
            ],
            error: null,
          }
        }
        return { data: null, error: null }
      })

      // Repository listKnowledgeDetails provides the canonical createdAt
      vi.mocked(repository.listKnowledgeDetails).mockResolvedValueOnce([
        {
          id: targetFactId,
          category: 'PRICE',
          content: '라떼 4500원',
          status: 'active',
          source: { kind: 'owner_statement', sourceId: 'src-1' },
          approvedAt: canonicalCreatedAt,
          validFrom: canonicalCreatedAt,
          usedBy: [],
          createdAt: canonicalCreatedAt,
          versionTimestamp: canonicalCreatedAt,
        },
      ])

      await processStudioTurn({
        ...defaultTurnParams,
        content: '가격 변경',
        focus: 'inspect',
        relatedEntityId: targetFactId,
      })

      // finalizeAssistantTurn must receive expectedFactCreatedAt enriched with canonicalCreatedAt
      expect(repository.finalizeAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          proposals: [
            expect.objectContaining({
              replacesFactId: targetFactId,
              expectedFactCreatedAt: canonicalCreatedAt,
            }),
          ],
        })
      )
    })

    it('(2-2) releases reserved credits exactly once and marks status as failed when replacesFactId is not found', async () => {
      vi.mocked(repository.getOrCreateStudioThread).mockResolvedValueOnce({
        id: testThreadId,
        workspace_id: testWorkspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      })
      vi.mocked(repository.ensureUserMessage).mockResolvedValueOnce({
        message: {
          id: 'msg-u-ghost-fact',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'user',
          content: '주차 정보 수정해줘',
          status: 'completed',
          client_message_id: defaultTurnParams.clientMessageId,
          created_at: '2026-10-16T02:00:00Z',
        },
        created: true,
      })
      vi.mocked(repository.claimAssistantTurn).mockResolvedValueOnce({
        message: {
          id: 'msg-a-ghost-fact',
          workspace_id: testWorkspaceId,
          thread_id: testThreadId,
          role: 'sohee',
          content: '',
          status: 'streaming',
          created_at: '2026-10-16T02:00:01Z',
        },
        claimed: true,
      })
      const mockReserve = vi.fn().mockResolvedValueOnce({
        data: {
          id: defaultTurnParams.clientMessageId,
          workspaceId: testWorkspaceId,
          action: 'chat_turn',
          settledCredits: 0,
          releasedCredits: 0,
          idempotencyKey: defaultTurnParams.clientMessageId,
          state: 'reserved',
          requestedCredits: 1,
        },
      })
      const mockRelease = vi.fn().mockResolvedValueOnce({
        data: { reservationId: defaultTurnParams.clientMessageId, state: 'released' },
      })
      const mockSettle = vi.fn()
      vi.mocked(repository.listStudioMessages).mockResolvedValueOnce({ messages: [], proposals: [] })
      vi.mocked(aiModule.generateStudioTurnAi).mockResolvedValueOnce({
        reply: '주차 정보 수정 제안',
        intent: 'teach',
        // Model hallucinates a replacesFactId that does not exist in workspace facts
        proposals: [{ category: 'PARKING', content: '무료 주차 1시간', replacesFactId: 'non-existent-fact-uuid' }],
        modelId: 'gemini-3.8-flash',
      })
      mockSupabase.rpc.mockImplementation(async () => {
        return { data: [], error: null }
      })

      await expect(
        processStudioTurn({
          ...defaultTurnParams,
          _deps: {
            reserveCredits: mockReserve as any,
            releaseCredits: mockRelease as any,
            settleCredits: mockSettle as any,
          },
        })
      ).rejects.toThrow('STUDIO_FACT_NOT_FOUND')

      // Must release credits exactly once on replacesFactId not found
      expect(mockRelease).toHaveBeenCalledTimes(1)
      expect(mockRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: testWorkspaceId,
          reservationId: defaultTurnParams.clientMessageId,
          credits: 1,
        })
      )
      expect(mockSettle).not.toHaveBeenCalled()
    })
  })

  describe('decideKnowledgeProposal', () => {
    it('throws STUDIO_PROPOSAL_NOT_FOUND when proposal is missing', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([])

      await expect(
        decideKnowledgeProposal(testWorkspaceId, testUserId, 'prop-non-existent', 'confirm')
      ).rejects.toThrow('STUDIO_PROPOSAL_NOT_FOUND')
    })

    it('throws STUDIO_PROPOSAL_CONFLICT when proposal kind is goal rather than fact', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-goal-wrong',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'goal',
          category: '목표',
          proposedContent: '예약 증대',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])

      await expect(
        decideKnowledgeProposal(testWorkspaceId, testUserId, 'prop-goal-wrong', 'confirm')
      ).rejects.toThrow('STUDIO_PROPOSAL_CONFLICT')
    })

    it('allows rejecting a goal proposal via decideKnowledgeProposal (reject is allowed for both fact and goal)', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-goal-reject',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'goal',
          category: '목표',
          proposedContent: '제외할 목표',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.decideProposal).mockResolvedValueOnce({
        success: true,
        id: 'prop-goal-reject',
        status: 'rejected',
        kind: 'goal',
      })

      const result = await decideKnowledgeProposal(testWorkspaceId, testUserId, 'prop-goal-reject', 'reject')
      expect(result.success).toBe(true)
      expect(repository.decideProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          proposalId: 'prop-goal-reject',
          decision: 'reject',
        })
      )
    })

    it('confirms fact proposal and maps fact conflict correctly', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-fact-1',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'fact',
          category: 'HOURS',
          proposedContent: '10시 오픈',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.decideProposal).mockRejectedValueOnce(
        new Error('conflict: fact to replace is not active')
      )

      await expect(
        decideKnowledgeProposal(testWorkspaceId, testUserId, 'prop-fact-1', 'confirm')
      ).rejects.toThrow('STUDIO_FACT_CONFLICT')
    })
  })

  describe('saveGoal', () => {
    it('throws STUDIO_PROPOSAL_NOT_FOUND when proposal is missing', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([])

      await expect(saveGoal(testWorkspaceId, testUserId, 'prop-non-existent')).rejects.toThrow(
        'STUDIO_PROPOSAL_NOT_FOUND'
      )
    })

    it('throws STUDIO_PROPOSAL_CONFLICT when proposal kind is fact rather than goal', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-fact-wrong',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'fact',
          category: 'HOURS',
          proposedContent: '10시 오픈',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])

      await expect(saveGoal(testWorkspaceId, testUserId, 'prop-fact-wrong')).rejects.toThrow(
        'STUDIO_PROPOSAL_CONFLICT'
      )
    })

    it('throws STUDIO_GOAL_NOT_FOUND when confirmed goal cannot be read from DB (no fake active return)', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-goal-1',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'goal',
          category: '예약 증대',
          proposedContent: '예약 20% 늘리기',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.decideProposal).mockResolvedValueOnce({
        success: true,
        id: 'prop-goal-1',
        status: 'confirmed',
        confirmedTargetId: 'goal-target-99',
        kind: 'goal',
      })
      // DB 조회에서 생성된 목표를 찾을 수 없음
      vi.mocked(repository.listGoals).mockResolvedValueOnce([])

      await expect(saveGoal(testWorkspaceId, testUserId, 'prop-goal-1')).rejects.toThrow(
        'STUDIO_GOAL_NOT_FOUND'
      )
    })

    it('successfully confirms goal and returns SoheeGoal', async () => {
      vi.mocked(repository.listProposals).mockResolvedValueOnce([
        {
          id: 'prop-goal-1',
          workspaceId: testWorkspaceId,
          threadId: testThreadId,
          sourceMessageId: 'msg-1',
          kind: 'goal',
          category: '예약 증대',
          proposedContent: '예약 20% 늘리기',
          evidence: [],
          status: 'proposed',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ])
      vi.mocked(repository.decideProposal).mockResolvedValueOnce({
        success: true,
        id: 'prop-goal-1',
        status: 'confirmed',
        confirmedTargetId: 'goal-target-99',
        kind: 'goal',
      })
      vi.mocked(repository.listGoals).mockResolvedValueOnce([
        {
          id: 'goal-target-99',
          workspaceId: testWorkspaceId,
          title: '예약 증대',
          desiredOutcome: '예약 20% 늘리기',
          priority: 'normal',
          status: 'active',
          version: 1,
          createdAt: '2026-10-16T01:00:00Z',
          updatedAt: '2026-10-16T01:00:00Z',
        },
      ])

      const goal = await saveGoal(testWorkspaceId, testUserId, 'prop-goal-1')
      expect(goal.id).toBe('goal-target-99')
      expect(goal.status).toBe('active')
      expect(goal.proposalId).toBe('prop-goal-1')
    })
  })

  describe('resolveCuriosity', () => {
    it('persists snoozed/not_applicable decision for valid question keys', async () => {
      vi.mocked(repository.decideQuestion).mockResolvedValueOnce({
        workspaceId: testWorkspaceId,
        questionKey: 'PRICE',
        status: 'snoozed',
        updatedBy: testUserId,
        createdAt: '2026-10-16T00:00:00Z',
        updatedAt: '2026-10-16T00:00:00Z',
      })

      const ok = await resolveCuriosity(
        testWorkspaceId,
        testUserId,
        `curiosity_${testWorkspaceId}_menu_price`,
        'snoozed'
      )
      expect(ok).toBe(true)
      expect(repository.decideQuestion).toHaveBeenCalledWith({
        workspaceId: testWorkspaceId,
        questionKey: 'PRICE',
        status: 'snoozed',
        userId: testUserId,
      })
    })

    it('rejects unsupported arbitrary question keys with STUDIO_QUESTION_NOT_FOUND', async () => {
      await expect(
        resolveCuriosity(testWorkspaceId, testUserId, 'invalid_random_key_123', 'snoozed')
      ).rejects.toThrow('STUDIO_QUESTION_NOT_FOUND')
    })
  })

  describe('updateStudioGoal (CAS Optimistic Concurrency via repository.updateGoal)', () => {
    it('throws STUDIO_GOAL_NOT_FOUND when goal does not exist', async () => {
      vi.mocked(repository.updateGoal).mockRejectedValueOnce(new Error('goal_not_found: Goal does not exist'))

      await expect(
        updateStudioGoal({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          goalId: 'goal-missing',
          expectedVersion: 1,
        })
      ).rejects.toThrow('STUDIO_GOAL_NOT_FOUND')
    })

    it('throws STUDIO_GOAL_CONFLICT when version does not match', async () => {
      vi.mocked(repository.updateGoal).mockRejectedValueOnce(
        new Error('conflict: goal version conflict (expected 4, current 5)')
      )

      await expect(
        updateStudioGoal({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          goalId: 'goal-cas-1',
          expectedVersion: 4,
          status: 'paused',
        })
      ).rejects.toThrow('STUDIO_GOAL_CONFLICT')
    })

    it('updates goal successfully and preserves actor userId', async () => {
      vi.mocked(repository.updateGoal).mockResolvedValueOnce({
        id: 'goal-cas-1',
        workspaceId: testWorkspaceId,
        title: '신규 목표',
        desiredOutcome: '결과',
        priority: 'high',
        status: 'active',
        version: 2,
        updatedBy: testUserId,
        createdAt: '2026-10-16T00:00:00Z',
        updatedAt: '2026-10-16T01:00:00Z',
      })

      const updated = await updateStudioGoal({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        goalId: 'goal-cas-1',
        expectedVersion: 1,
        title: '신규 목표',
      })

      expect(updated.version).toBe(2)
      expect(repository.updateGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          goalId: 'goal-cas-1',
          expectedVersion: 1,
          title: '신규 목표',
        })
      )
    })
  })
})
