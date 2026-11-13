import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MarketingWorkService,
  shouldCreateWorkItem,
} from '@/lib/agent-os/marketing-work-service'

describe('ANI-1040: Marketing WorkItem SSOT Contract', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const threadId = 'th_test_123'
  const messageId = 'msg_test_456'
  const actorId = 'usr_owner_789'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('1. shouldCreateWorkItem classification', () => {
    it('classifies actionable content and marketing creation as true', () => {
      expect(shouldCreateWorkItem('신메뉴 바질 크림 파스타 인스타 피드 써줘', 'DRAFT')).toBe(true)
      expect(shouldCreateWorkItem('이번 주말 딸기 크루아상 홍보 콘텐츠 제작해줘', 'DRAFT')).toBe(true)
      expect(shouldCreateWorkItem('인스타 피드에 당장 올려줘', 'EXECUTE')).toBe(true)
      expect(shouldCreateWorkItem('스토리 시안 만들어줘', 'DRAFT')).toBe(true)
      expect(shouldCreateWorkItem('당근마켓 이벤트 소식 원고 작성해줘', 'DRAFT')).toBe(true)
    })

    it('classifies small talk, greeting, and simple Q&A as false', () => {
      expect(shouldCreateWorkItem('안녕 소희야', 'DRAFT')).toBe(false)
      expect(shouldCreateWorkItem('오늘 날씨 어때?', 'DRAFT')).toBe(false)
      expect(shouldCreateWorkItem('고마워 잘 알겠어', 'DRAFT')).toBe(false)
      expect(shouldCreateWorkItem('수고했어', 'DRAFT')).toBe(false)
    })

    it('classifies operational control commands as false', () => {
      expect(shouldCreateWorkItem('PAUSE', 'DRAFT')).toBe(false)
      expect(shouldCreateWorkItem('일시정지해줘', 'DRAFT')).toBe(false)
      expect(shouldCreateWorkItem('STATUS', 'DRAFT')).toBe(false)
      expect(shouldCreateWorkItem('현재 가동 상태 조회', 'DRAFT')).toBe(false)
    })
  })

  describe('2. ensureMarketingWorkItem persistence & idempotency', () => {
    it('creates a new work_items row with canonical schema when not existing', async () => {
      const createdRow = {
        id: 'work_item_001',
        workspace_id: workspaceId,
        type: 'content',
        title: '신메뉴 바질 크림 파스타 인스타 피드 작성',
        summary: '신메뉴 바질 크림 파스타 인스타 피드 써줘',
        status: 'drafting',
        priority: 'normal',
        owner_type: 'sohee',
        source_thread_id: threadId,
        source_message_id: messageId,
        content_item_id: null,
        created_by: actorId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'work_items') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: createdRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'workspace_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: actorId }, error: null }),
            }
          }
          return {}
        }),
      }

      const res = await MarketingWorkService.ensureMarketingWorkItem({
        workspaceId,
        threadId,
        messageId,
        userPrompt: '신메뉴 바질 크림 파스타 인스타 피드 써줘',
        actorId,
        client: mockClient as any,
      })

      expect(res.created).toBe(true)
      expect(res.workItem.id).toBe('work_item_001')
      expect(res.workItem.type).toBe('content')
      expect(res.workItem.status).toBe('drafting')
      expect(res.workItem.source_thread_id).toBe(threadId)
      expect(res.workItem.source_message_id).toBe(messageId)
      expect(res.workItem.created_by).toBe(actorId)
    })

    it('returns existing work item without inserting duplicate on retry (idempotency)', async () => {
      const existingRow = {
        id: 'work_item_existing_999',
        workspace_id: workspaceId,
        type: 'content',
        title: '신메뉴 바질 크림 파스타 인스타 피드 작성',
        summary: '신메뉴 바질 크림 파스타 인스타 피드 써줘',
        status: 'drafting',
        priority: 'normal',
        owner_type: 'sohee',
        source_thread_id: threadId,
        source_message_id: messageId,
        content_item_id: null,
        created_by: actorId,
        created_at: '2026-09-08T00:00:00Z',
        updated_at: '2026-09-08T00:00:00Z',
      }

      const insertSpy = vi.fn()
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'work_items') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
              insert: insertSpy,
            }
          }
          return {}
        }),
      }

      const res = await MarketingWorkService.ensureMarketingWorkItem({
        workspaceId,
        threadId,
        messageId,
        userPrompt: '신메뉴 바질 크림 파스타 인스타 피드 써줘',
        actorId,
        client: mockClient as any,
      })

      expect(res.created).toBe(false)
      expect(res.workItem.id).toBe('work_item_existing_999')
      expect(insertSpy).not.toHaveBeenCalled()
    })
  })

  describe('3. linkContentToWorkItem', () => {
    it('updates work_items row with content_item_id and review_required status', async () => {
      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      })

      const mockClient = {
        from: vi.fn(() => ({
          update: updateSpy,
        })),
      }

      await MarketingWorkService.linkContentToWorkItem({
        workspaceId,
        workItemId: 'work_item_001',
        contentItemId: 'content_item_abc',
        client: mockClient as any,
      })

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content_item_id: 'content_item_abc',
          status: 'review_required',
        })
      )
    })
  })
})
