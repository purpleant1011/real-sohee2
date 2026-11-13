import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getOrCreateStudioThread,
  listStudioMessages,
  persistTurn,
  saveProposal,
  decideProposal,
  listGoals,
  updateGoal,
  listDecisions,
  decideQuestion,
  listKnowledgeDetails,
} from '../repository'

describe('Sohee Studio Repository', () => {
  const workspaceId = 'w-test-1111'
  const userId = 'u-test-1111'
  const threadId = 't-test-1111'

  let mockClient: any

  beforeEach(() => {
    mockClient = {
      from: vi.fn(),
      rpc: vi.fn(),
    }
  })

  describe('getOrCreateStudioThread', () => {
    it('returns existing active studio thread if found', async () => {
      const existingThread = {
        id: threadId,
        workspace_id: workspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      }

      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingThread, error: null }),
      })

      const thread = await getOrCreateStudioThread(workspaceId, mockClient)
      expect(thread).toEqual(existingThread)
      expect(mockClient.from).toHaveBeenCalledWith('conversation_threads')
    })

    it('creates a new studio thread if none exists', async () => {
      const createdThread = {
        id: threadId,
        workspace_id: workspaceId,
        kind: 'studio',
        title: '소희 스튜디오',
        status: 'active',
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      }

      mockClient.from
        // First call: lookup returns null
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })
        // Second call: insert returns created thread
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: createdThread, error: null }),
        })

      const thread = await getOrCreateStudioThread(workspaceId, mockClient)
      expect(thread).toEqual(createdThread)
    })

    it('propagates DB query errors', async () => {
      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB_CONNECTION_LOST' } }),
      })

      await expect(getOrCreateStudioThread(workspaceId, mockClient)).rejects.toThrow('DB_CONNECTION_LOST')
    })
  })

  describe('listStudioMessages', () => {
    it('returns messages and their associated proposals', async () => {
      const messageRows = [
        {
          id: 'msg-1',
          workspace_id: workspaceId,
          thread_id: threadId,
          role: 'user',
          content: '영업시간은 10시부터 20시입니다.',
          created_at: '2026-10-16T01:00:00Z',
        },
        {
          id: 'msg-2',
          workspace_id: workspaceId,
          thread_id: threadId,
          role: 'sohee',
          content: '영업시간을 매일 10:00~20:00으로 지식에 추가할까요?',
          created_at: '2026-10-16T01:00:05Z',
        },
      ]

      const proposalRows = [
        {
          id: 'prop-1',
          workspace_id: workspaceId,
          source_message_id: 'msg-1',
          kind: 'fact',
          category: '영업시간',
          content: '매일 10:00 ~ 20:00',
          replaces_fact_id: null,
          expected_fact_created_at: null,
          status: 'proposed',
          confirmed_target_id: null,
          created_at: '2026-10-16T01:00:05Z',
        },
      ]

      mockClient.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: messageRows, error: null }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: proposalRows, error: null }),
        })

      const result = await listStudioMessages(workspaceId, threadId, { limit: 50 }, mockClient)
      expect(result.messages).toHaveLength(2)
      expect(result.proposals).toHaveLength(1)
      expect(result.proposals[0].id).toBe('prop-1')
      expect(result.proposals[0].proposedContent).toBe('매일 10:00 ~ 20:00')
    })
  })

  describe('persistTurn', () => {
    it('idempotently returns existing turn if clientMessageId already exists', async () => {
      const existingUserMsg = {
        id: 'msg-user-existing',
        workspace_id: workspaceId,
        thread_id: threadId,
        role: 'user',
        content: '동일 요청',
        client_message_id: 'client-key-123',
        created_by_user_id: userId,
        created_at: '2026-10-16T01:00:00Z',
      }
      const existingAssistantMsg = {
        id: 'msg-sohee-existing',
        workspace_id: workspaceId,
        thread_id: threadId,
        role: 'sohee',
        content: '기존 응답',
        reply_to_message_id: 'msg-user-existing',
        created_at: '2026-10-16T01:00:02Z',
      }

      mockClient.from
        // Check existing user message by client_message_id
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existingUserMsg, error: null }),
        })
        // Fetch assistant reply
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existingAssistantMsg, error: null }),
        })
        // Fetch associated proposals
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })

      const result = await persistTurn(
        {
          workspaceId,
          threadId,
          userMessage: {
            clientMessageId: 'client-key-123',
            content: '동일 요청',
            userId,
          },
          assistantMessage: {
            content: '기존 응답',
          },
        },
        mockClient,
      )

      expect(result.idempotent).toBe(true)
      expect(result.userMessage.id).toBe('msg-user-existing')
      expect(result.assistantMessage.id).toBe('msg-sohee-existing')
    })

    it('inserts user message, assistant message and proposals in a new turn via atomic RPC', async () => {
      const userMsg = {
        id: 'msg-new-user',
        workspace_id: workspaceId,
        thread_id: threadId,
        role: 'user',
        content: '안녕하세요',
        client_message_id: 'client-key-456',
        created_at: '2026-10-16T02:00:00Z',
      }
      const assistantClaimMsg = {
        id: 'msg-new-sohee',
        workspace_id: workspaceId,
        thread_id: threadId,
        role: 'sohee',
        content: '응답을 준비하고 있습니다.',
        status: 'streaming',
        reply_to_message_id: 'msg-new-user',
        created_at: '2026-10-16T02:00:01Z',
      }
      const finalizedAssistantMsg = {
        ...assistantClaimMsg,
        content: '반갑습니다 사장님!',
        status: 'completed',
        completed_at: '2026-10-16T02:00:02Z',
      }
      const proposalRow = {
        id: 'prop-new-1',
        workspace_id: workspaceId,
        source_message_id: 'msg-new-user',
        kind: 'fact',
        category: '인사',
        content: '친절한 매장',
        replaces_fact_id: null,
        expected_fact_created_at: null,
        status: 'proposed',
        confirmed_target_id: null,
        created_at: '2026-10-16T02:00:02Z',
      }

      mockClient.from
        // 1. ensureUserMessage: select idempotency check -> null
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })
        // 2. ensureUserMessage: insert user message
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: userMsg, error: null }),
        })
        // 3. claimAssistantTurn: check existing claim -> null
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })
        // 4. claimAssistantTurn: insert streaming assistant message
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: assistantClaimMsg, error: null }),
        })

      // 5. finalizeAssistantTurn: atomic DB RPC
      mockClient.rpc.mockResolvedValueOnce({
        data: {
          success: true,
          assistant_message: finalizedAssistantMsg,
          proposals: [proposalRow],
        },
        error: null,
      })

      const result = await persistTurn(
        {
          workspaceId,
          threadId,
          userMessage: {
            clientMessageId: 'client-key-456',
            content: '안녕하세요',
            userId,
          },
          assistantMessage: {
            content: '반갑습니다 사장님!',
            modelName: 'gemini-3.8-flash',
          },
          proposals: [
            {
              kind: 'fact',
              category: '인사',
              content: '친절한 매장',
            },
          ],
        },
        mockClient,
      )

      expect(result.idempotent).toBe(false)
      expect(result.userMessage.id).toBe('msg-new-user')
      expect(result.assistantMessage.id).toBe('msg-new-sohee')
      expect(result.proposals).toHaveLength(1)
      expect(result.proposals[0].id).toBe('prop-new-1')
      expect(mockClient.rpc).toHaveBeenCalledWith('finalize_studio_turn', expect.any(Object))
    })

    it('throws STUDIO_TURN_CONFLICT on clientMessageId replay with different content or thread', async () => {
      const existingUserMsg = {
        id: 'msg-user-1',
        workspace_id: workspaceId,
        thread_id: threadId,
        role: 'user',
        content: '원래 질문',
        client_message_id: 'client-key-dup',
        created_by_user_id: userId,
        created_at: '2026-10-16T01:00:00Z',
      }

      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingUserMsg, error: null }),
      })

      await expect(
        persistTurn(
          {
            workspaceId,
            threadId,
            userMessage: {
              clientMessageId: 'client-key-dup',
              content: '변조된 다른 질문', // content mismatch
              userId,
            },
            assistantMessage: {
              content: '응답',
            },
          },
          mockClient,
        ),
      ).rejects.toThrow('STUDIO_TURN_CONFLICT')
    })
  })

  describe('saveProposal', () => {
    it('saves a proposed fact/goal with length contract check', async () => {
      const createdRow = {
        id: 'prop-saved-1',
        workspace_id: workspaceId,
        source_message_id: 'msg-1',
        kind: 'goal',
        category: '단골 고객 20% 증가를 위한 월간 운영 목표 설정',
        content: '이번달 단골 고객 20% 증가',
        replaces_fact_id: null,
        expected_fact_created_at: null,
        status: 'proposed',
        confirmed_target_id: null,
        created_at: '2026-10-16T03:00:00Z',
      }

      mockClient.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: createdRow, error: null }),
      })

      const proposal = await saveProposal(
        {
          workspaceId,
          sourceMessageId: 'msg-1',
          kind: 'goal',
          category: '단골 고객 20% 증가를 위한 월간 운영 목표 설정',
          content: '이번달 단골 고객 20% 증가',
          userId,
        },
        mockClient,
      )

      expect(proposal.id).toBe('prop-saved-1')
      expect(proposal.kind).toBe('goal')
      expect(proposal.proposedContent).toBe('이번달 단골 고객 20% 증가')
    })

    it('rejects fact category exceeding 120 characters', async () => {
      await expect(
        saveProposal(
          {
            workspaceId,
            sourceMessageId: 'msg-1',
            kind: 'fact',
            category: 'A'.repeat(125), // exceeds 120
            content: '내용',
            userId,
          },
          mockClient,
        ),
      ).rejects.toThrow('category exceeds maximum length of 120')
    })
  })

  describe('decideProposal', () => {
    it('calls DB RPC decide_studio_proposal and returns result', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: {
          success: true,
          id: 'prop-1',
          status: 'confirmed',
          confirmed_target_id: 'fact-1',
          kind: 'fact',
          idempotent: false,
        },
        error: null,
      })

      const res = await decideProposal(
        {
          workspaceId,
          proposalId: 'prop-1',
          decision: 'confirm',
          userId,
        },
        mockClient,
      )

      expect(res.success).toBe(true)
      expect(res.confirmedTargetId).toBe('fact-1')
      expect(mockClient.rpc).toHaveBeenCalledWith('decide_studio_proposal', {
        p_workspace_id: workspaceId,
        p_proposal_id: 'prop-1',
        p_decision: 'confirm',
        p_user_id: userId,
        p_revised_content: null,
      })
    })

    it('propagates RPC error', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'conflict: fact to replace is not active' },
      })

      await expect(
        decideProposal(
          {
            workspaceId,
            proposalId: 'prop-1',
            decision: 'confirm',
            userId,
          },
          mockClient,
        ),
      ).rejects.toThrow('conflict: fact to replace is not active')
    })
  })

  describe('listGoals & decideQuestion', () => {
    it('lists goals for a workspace', async () => {
      const goalsRows = [
        {
          id: 'goal-1',
          workspace_id: workspaceId,
          title: '단골 확보',
          desired_outcome: '월 재방문율 30%',
          priority: 'high',
          status: 'active',
          version: 1,
          created_at: '2026-10-16T00:00:00Z',
          updated_at: '2026-10-16T00:00:00Z',
        },
      ]

      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: goalsRows, error: null }),
      })

      const goals = await listGoals(workspaceId, undefined, mockClient)
      expect(goals).toHaveLength(1)
      expect(goals[0].title).toBe('단골 확보')
      expect(goals[0].desiredOutcome).toBe('월 재방문율 30%')
    })

    it('updates a goal with optimistic version increment', async () => {
      const existingGoal = {
        id: 'goal-1',
        workspace_id: workspaceId,
        title: '단골 확보',
        desired_outcome: '월 재방문율 30%',
        priority: 'high',
        status: 'active',
        version: 1,
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      }
      const updatedGoalRow = {
        ...existingGoal,
        status: 'paused',
        version: 2,
        updated_at: '2026-10-16T01:00:00Z',
      }

      mockClient.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existingGoal, error: null }),
        })
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: updatedGoalRow, error: null }),
        })

      const updated = await updateGoal(
        {
          workspaceId,
          userId,
          goalId: 'goal-1',
          expectedVersion: 1,
          status: 'paused',
        },
        mockClient,
      )

      expect(updated.status).toBe('paused')
      expect(updated.version).toBe(2)
    })

    it('throws conflict error if expectedVersion does not match current version', async () => {
      const existingGoal = {
        id: 'goal-1',
        workspace_id: workspaceId,
        title: '단골 확보',
        desired_outcome: '월 재방문율 30%',
        priority: 'high',
        status: 'active',
        version: 2, // version already bumped to 2
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      }

      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingGoal, error: null }),
      })

      await expect(
        updateGoal(
          {
            workspaceId,
            userId,
            goalId: 'goal-1',
            expectedVersion: 1, // expecting 1
            status: 'paused',
          },
          mockClient,
        ),
      ).rejects.toThrow('conflict: goal version conflict')
    })

    it('decides a question with upsert', async () => {
      const decisionRow = {
        workspace_id: workspaceId,
        question_key: 'PRICE',
        status: 'snoozed',
        updated_by: userId,
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
      }

      mockClient.from.mockReturnValueOnce({
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: decisionRow, error: null }),
      })

      const decision = await decideQuestion(
        {
          workspaceId,
          questionKey: 'PRICE',
          status: 'snoozed',
          userId,
        },
        mockClient,
      )

      expect(decision.questionKey).toBe('PRICE')
      expect(decision.status).toBe('snoozed')
    })

    it('lists decisions', async () => {
      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: workspaceId,
              question_key: 'HOURS',
              status: 'not_applicable',
              updated_by: userId,
              created_at: '2026-10-16T00:00:00Z',
              updated_at: '2026-10-16T00:00:00Z',
            },
          ],
          error: null,
        }),
      })

      const decisions = await listDecisions(workspaceId, mockClient)
      expect(decisions).toHaveLength(1)
      expect(decisions[0].questionKey).toBe('HOURS')
    })
  })

  describe('listKnowledgeDetails', () => {
    it('returns knowledge views with actual source and candidate data', async () => {
      const factsRows = [
        {
          id: 'fact-1',
          workspace_id: workspaceId,
          category: '영업시간',
          content: '매일 10:00 ~ 20:00',
          status: 'active',
          approved_at: '2026-10-16T00:00:00Z',
          valid_from: '2026-10-16T00:00:00Z',
          valid_until: null,
          supersedes_fact_id: null,
          source_candidate_id: 'cand-1',
          created_at: '2026-10-16T00:00:00Z',
        },
      ]

      const candRows = [
        {
          id: 'cand-1',
          source_location: 'studio:proposal:prop-1',
          knowledge_source_id: 'src-1',
        },
      ]

      mockClient.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: factsRows, error: null }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: candRows, error: null }),
        })

      const details = await listKnowledgeDetails(workspaceId, mockClient)
      expect(details).toHaveLength(1)
      expect(details[0].category).toBe('영업시간')
      expect(details[0].source.sourceId).toBe('src-1')
      expect(details[0].source.kind).toBe('owner_statement')
    })

    it('classifies candidate with null source_location and null evidence_doc as owner_statement (onboarding), while classifying evidence_document_id as imported_source', async () => {
      const factsRows = [
        {
          id: 'fact-onboarding',
          workspace_id: workspaceId,
          category: 'MENU',
          content: '온보딩 아메리카노 3500원',
          status: 'active',
          source_candidate_id: 'cand-onboarding',
          created_at: '2026-10-16T00:00:00Z',
        },
        {
          id: 'fact-channel-doc',
          workspace_id: workspaceId,
          category: 'MENU',
          content: '인스타 메뉴',
          status: 'active',
          source_candidate_id: 'cand-channel-doc',
          created_at: '2026-10-16T00:00:00Z',
        },
      ]

      const candRows = [
        {
          id: 'cand-onboarding',
          source_location: null,
          evidence_document_id: null,
          knowledge_source_id: 'src-manual-onboarding',
        },
        {
          id: 'cand-channel-doc',
          source_location: null,
          evidence_document_id: 'doc-uuid-channel-1',
          knowledge_source_id: 'src-channel-1',
        },
      ]

      mockClient.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: factsRows, error: null }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: candRows, error: null }),
        })

      const details = await listKnowledgeDetails(workspaceId, mockClient)
      expect(details).toHaveLength(2)

      // Onboarding candidate (cand exists, no evidence doc, null loc) -> owner_statement
      const onboardingFact = details.find((d) => d.id === 'fact-onboarding')
      expect(onboardingFact?.source.kind).toBe('owner_statement')
      expect(onboardingFact?.source.evidenceDocumentId).toBeUndefined()

      // Channel candidate with evidence_document_id -> imported_source and evidenceDocumentId attached
      const channelFact = details.find((d) => d.id === 'fact-channel-doc')
      expect(channelFact?.source.kind).toBe('imported_source')
      expect(channelFact?.source.evidenceDocumentId).toBe('doc-uuid-channel-1')
    })
  })
})
