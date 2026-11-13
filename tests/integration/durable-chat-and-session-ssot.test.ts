import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentSessionService } from '@/features/agent-session/agent-session-service'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { AgentOrchestrator } from '@/lib/agent-os/agent-orchestrator'
import { AgentLoopEngine } from '@/features/tool-runtime/agent-loop-engine'
import { PersistenceError } from '@/lib/errors/persistence-error'

// 세션/메시지 통합 경계 밖의 활동 원장은 전용 DB 계약 테스트에서 검증한다.
const { appendActivity } = vi.hoisted(() => ({ appendActivity: vi.fn() }))
vi.mock('@/features/agent-activity/activity-store', () => ({ appendActivity }))

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const THREAD_UUID = '22222222-2222-4222-8222-222222222222'
const MESSAGE_UUID = '33333333-3333-4333-8333-333333333333'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 'admin-run-step-1' }, error: null })),
        })),
        then: (resolve: any) => resolve({ data: { id: 'admin-run-step-1' }, error: null }),
      })),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}))

describe('Wave 1: Durable Chat & Session SSOT (ANI-1017, ANI-1029)', () => {
  beforeEach(async () => {
    AgentSessionService.resetMemoryStoreForTesting()
    vi.restoreAllMocks()
    appendActivity.mockReset().mockImplementation(async (_db, input) => ({ ...input, sequence: 1 }))

    // Setup resilient Supabase DB mock
    const mockDb: Record<string, any[]> = {
      agent_sessions: [],
      conversation_threads: [],
      messages: [],
      conversation_jobs: [],
    }

    const mockSupabase = {
      from: vi.fn().mockImplementation((tableName: string) => {
        const createQueryBuilder = () => {
          const qb: any = {
            select: vi.fn(() => qb),
            eq: vi.fn(() => qb),
            in: vi.fn(() => qb),
            order: vi.fn(() => qb),
            limit: vi.fn(() => qb),
            maybeSingle: vi.fn(async () => {
              const found = mockDb[tableName]?.find(r => r.workspace_id === WORKSPACE_ID)
              return { data: found || null, error: null }
            }),
            single: vi.fn(async () => {
              const found = mockDb[tableName]?.find(r => r.workspace_id === WORKSPACE_ID)
              return { data: found || null, error: null }
            }),
            then: (resolve: any) => resolve({ data: mockDb[tableName] || [], error: null }),
          }
          return qb
        }
        return {
          select: vi.fn(() => createQueryBuilder()),
          insert: vi.fn().mockImplementation((record: any) => {
            const row = { id: record.id || crypto.randomUUID(), ...record }
            mockDb[tableName] = mockDb[tableName] || []
            mockDb[tableName].push(row)
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              }),
              then: (resolve: any) => resolve({ data: row, error: null }),
            }
          }),
          upsert: vi.fn().mockImplementation((record: any) => {
            const row = { id: record.id || crypto.randomUUID(), ...record }
            mockDb[tableName] = mockDb[tableName] || []
            mockDb[tableName].push(row)
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              }),
              then: (resolve: any) => resolve({ data: row, error: null }),
            }
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }),
    }

    const serverModule = await import('@/lib/supabase/server')
    vi.spyOn(serverModule, 'createServerSupabaseClient').mockResolvedValue(mockSupabase as any)
    vi.spyOn(AgentLoopEngine, 'run').mockResolvedValue({
      status: 'COMPLETED',
      executedSteps: [],
      cards: {},
      creditDeduction: {
        textTokens: 0,
        textSC: 0,
        imageUnits: 0,
        imageSC: 0,
        totalDeductedSC: 0,
        reason: 'test',
      },
      outputReply: '테스트 완료',
    } as any)
  })

  describe('ANI-1017: Session, Thread, and Message SSOT & Continuity', () => {
    it('creates canonical session and thread with valid UUID, zero synthetic fallback', async () => {
      vi.spyOn(ConversationRepository, 'createThread').mockResolvedValue({
        id: THREAD_UUID,
        workspaceId: WORKSPACE_ID,
        title: '세션 대화',
        kind: 'operations',
        status: 'active',
        modelProfile: 'conversation_gpt_5_6_luna_max',
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const result = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
      })

      expect(result.isNewSession).toBe(true)
      expect(result.session.workspaceId).toBe(WORKSPACE_ID)
      expect(result.session.threadId).toBe(THREAD_UUID)
      // threadId must be a valid UUID, NEVER synthetic th_*
      expect(result.session.threadId).not.toMatch(/^th_/)
      expect(result.session.threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('enforces fail-closed: throws PersistenceError if thread creation fails, prohibiting synthetic fallback', async () => {
      vi.spyOn(ConversationRepository, 'createThread').mockRejectedValue(
        new PersistenceError('createThread', 'DB connection error')
      )

      await expect(
        AgentSessionService.resolveOrCreateSession({
          workspaceId: WORKSPACE_ID,
        })
      ).rejects.toThrow(PersistenceError)
    })

    it('restores existing session and thread across page reloads (F5 continuity)', async () => {
      vi.spyOn(ConversationRepository, 'createThread').mockResolvedValue({
        id: THREAD_UUID,
        workspaceId: WORKSPACE_ID,
        title: '세션 대화',
        kind: 'operations',
        status: 'active',
        modelProfile: 'conversation_gpt_5_6_luna_max',
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const first = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
      })
      const sessionId = first.session.sessionId

      // Simulated F5 reload with existing sessionId
      const reloaded = await AgentSessionService.resolveOrCreateSession({
        workspaceId: WORKSPACE_ID,
        sessionId,
      })

      expect(reloaded.isNewSession).toBe(false)
      expect(reloaded.reconnected).toBe(true)
      expect(reloaded.session.sessionId).toBe(sessionId)
      expect(reloaded.session.threadId).toBe(THREAD_UUID)
    })
  })

  describe('ANI-1029: Current-Turn Intake Contract & Idempotency', () => {
    it('commits user message first before executing downstream agent loops', async () => {
      const callSequence: string[] = []

      vi.spyOn(ConversationRepository, 'saveMessage').mockImplementation(async (ws, tid, role) => {
        callSequence.push(`saveMessage:${role}`)
        return MESSAGE_UUID
      })

      vi.spyOn(ConversationRepository, 'createAgentRun').mockImplementation(async () => {
        callSequence.push('createAgentRun')
        return 'run-123'
      })

      vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue()

      vi.spyOn(ConversationRepository, 'createThread').mockResolvedValue({
        id: THREAD_UUID,
        workspaceId: WORKSPACE_ID,
        title: '대화',
        kind: 'operations',
        status: 'active',
        modelProfile: 'default',
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await AgentOrchestrator.executeTurn({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_UUID,
        userMessage: '인스타그램에 신메뉴 홍보 카드 만들어줘',
        clientMessageId: MESSAGE_UUID,
        isTestAccount: true,
      })

      // Must save user message BEFORE creating agent run or invoking downstream tools
      expect(callSequence[0]).toBe('saveMessage:user')
      expect(callSequence).toContain('createAgentRun')
      expect(callSequence.indexOf('saveMessage:user')).toBeLessThan(callSequence.indexOf('createAgentRun'))
    }, 30000)

    it('aborts all downstream operations if user message persistence fails (Fail-Closed)', async () => {
      vi.spyOn(ConversationRepository, 'saveMessage').mockRejectedValue(
        new PersistenceError('saveMessage', 'Database unavailable')
      )
      const agentRunSpy = vi.spyOn(ConversationRepository, 'createAgentRun')

      await expect(
        AgentOrchestrator.executeTurn({
          workspaceId: WORKSPACE_ID,
          threadId: THREAD_UUID,
          userMessage: '중요 마케팅 지시',
          isTestAccount: true,
        })
      ).rejects.toThrow(PersistenceError)

      // Zero downstream execution
      expect(agentRunSpy).not.toHaveBeenCalled()
    })

    it('correctly maps clientMessageId into message record', async () => {
      let capturedMetadata: any = null
      vi.spyOn(ConversationRepository, 'saveMessage').mockImplementation(async (ws, tid, role, content, meta) => {
        if (role === 'user') {
          capturedMetadata = meta
        }
        return MESSAGE_UUID
      })

      vi.spyOn(ConversationRepository, 'createAgentRun').mockResolvedValue('run-123')
      vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue()

      await AgentOrchestrator.executeTurn({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_UUID,
        userMessage: '새로운 이벤트 지시',
        clientMessageId: MESSAGE_UUID,
        isTestAccount: true,
      })

      expect(capturedMetadata).toBeDefined()
      expect(capturedMetadata.clientMessageId).toBe(MESSAGE_UUID)
    }, 30000)
  })
})
