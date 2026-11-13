import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationRepository } from '../conversation-repository'
import { PersistenceError } from '@/lib/errors/persistence-error'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    from: mockFrom,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'mock-user' } } }) },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

describe('Canonical Agent Run Ledger (ANI-993)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createAgentRun', () => {
    it('persists run to canonical conversation_jobs ledger and returns runId', async () => {
      const insertedRow = {
        id: 'run-uuid-1111-2222',
        workspace_id: 'ws-test-1',
        thread_id: 'thread-test-1',
        kind: 'chat',
        status: 'running',
        goal: '인스타그램 피드 발행',
      }

      const queryMock = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
      }
      mockFrom.mockReturnValue(queryMock)

      const runId = await ConversationRepository.createAgentRun(
        'ws-test-1',
        'thread-test-1',
        '인스타그램 피드 발행',
        { actionGraph: {} },
        'trace-1234',
        'msg-user-1'
      )

      expect(mockFrom).toHaveBeenCalledWith('conversation_jobs')
      expect(queryMock.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-test-1',
          thread_id: 'thread-test-1',
          user_message_id: 'msg-user-1',
          kind: 'chat',
          status: 'running',
          goal: '인스타그램 피드 발행',
          trace_id: 'trace-1234',
        })
      )
      expect(runId).toBeDefined()
    })

    it('throws PersistenceError fail-closed when conversation_jobs insertion fails', async () => {
      const queryMock = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'relation conversation_jobs does not exist', code: '42P01' },
        }),
      }
      mockFrom.mockReturnValue(queryMock)

      await expect(
        ConversationRepository.createAgentRun(
          'ws-test-1',
          'thread-test-1',
          '인스타그램 피드 발행',
          {},
          'trace-fail'
        )
      ).rejects.toThrow(PersistenceError)
    })
  })

  describe('updateAgentRunStatus', () => {
    it('keeps approval waiting nonterminal and fences final linkage by workspace and running state', async () => {
      const queryMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      }
      mockFrom.mockReturnValue(queryMock)

      await ConversationRepository.updateAgentRunStatus(
        'run-1', 'awaiting_approval', false, 'assistant-final',
        { workspaceId: 'ws-test-1', onlyRunning: true }
      )

      expect(queryMock.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'awaiting_approval', completed_at: null, assistant_message_id: 'assistant-final',
      }))
      expect(queryMock.update.mock.calls[0][0]).not.toHaveProperty('safe_error_code')
      expect(queryMock.eq.mock.calls).toEqual([
        ['id', 'run-1'], ['workspace_id', 'ws-test-1'], ['status', 'running'],
      ])
    })

    it('updates conversation_jobs with mapped status and links assistantMessageId', async () => {
      const queryMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'run-1' }], error: null }),
      }
      mockFrom.mockReturnValue(queryMock)

      await ConversationRepository.updateAgentRunStatus(
        'run-1',
        'completed',
        true,
        'msg-assistant-final'
      )

      expect(mockFrom).toHaveBeenCalledWith('conversation_jobs')
      expect(queryMock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'succeeded',
          completed_at: expect.any(String),
          assistant_message_id: 'msg-assistant-final',
        })
      )
    })
  })

  describe('recordAgentRunStep', () => {
    it('records durable ordered step to conversation_job_steps', async () => {
      const queryMock = {
        upsert: vi.fn().mockResolvedValue({ data: [{ id: 'step-1' }], error: null }),
      }
      mockFrom.mockReturnValue(queryMock)

      await ConversationRepository.recordAgentRunStep({
        runId: 'run-1',
        stepIndex: 1,
        capabilityId: 'instagram_publish',
        riskTier: 'HIGH',
        status: 'completed',
        inputPayload: { caption: '안녕하세요' },
        outputPayload: { receiptId: 'receipt-123' },
        idempotencyKey: 'idem-key-1',
        externalReceiptId: '00000000-0000-0000-0000-000000000001',
        completed: true,
      })

      expect(mockFrom).toHaveBeenCalledWith('conversation_job_steps')
      expect(queryMock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          job_id: 'run-1',
          step_index: 1,
          capability_id: 'instagram_publish',
          risk_tier: 'HIGH',
          status: 'completed',
          input_payload: { caption: '안녕하세요' },
          output_payload: { receiptId: 'receipt-123' },
          idempotency_key: 'idem-key-1',
          external_receipt_id: '00000000-0000-0000-0000-000000000001',
          provider_call_key: 'run-1:1',
          completed_at: expect.any(String),
        }),
        { onConflict: 'job_id,provider_call_key' }
      )
    })

    it('throws PersistenceError fail-closed when step recording fails', async () => {
      const queryMock = {
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'db disk full', code: '53100' },
        }),
      }
      mockFrom.mockReturnValue(queryMock)

      await expect(
        ConversationRepository.recordAgentRunStep({
          runId: 'run-fail',
          stepIndex: 1,
          capabilityId: 'tool_call',
          status: 'running',
          inputPayload: {},
        })
      ).rejects.toThrow(PersistenceError)
    })
  })

  describe('saveMessage correlation', () => {
    it('stores runId and evidence in usage_metadata for correlation tree', async () => {
      const queryMock = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'msg-new' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      }
      // First call for messages.insert, second call for conversation_threads.update
      mockFrom.mockReturnValue(queryMock)
      queryMock.eq.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'th-1' }], error: null }),
      })

      const msgId = await ConversationRepository.saveMessage(
        'ws-1',
        'th-1',
        'sohee',
        '완료했습니다.',
        {
          runId: 'run-uuid-1111-2222',
          toolCalls: [{ id: 'tc-1', name: 'tool_a' }],
          evidenceRefs: [{ receiptId: 'rec-1' }],
        }
      )

      expect(msgId).toBeDefined()
      expect(mockFrom).toHaveBeenCalledWith('messages')
      expect(queryMock.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-1',
          thread_id: 'th-1',
          role: 'sohee',
          usage_metadata: {
            missionId: null,
            planVersion: 0,
            runId: 'run-uuid-1111-2222',
            toolCalls: [{ id: 'tc-1', name: 'tool_a' }],
            evidenceRefs: [{ receiptId: 'rec-1' }],
            actionGraph: null,
          },
        })
      )
    })
  })
})
