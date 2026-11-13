import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LongTermMemoryService } from '../long-term-memory-service'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

describe('LongTermMemoryService (ANI-992)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_DATASET_MODE

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_DATASET_MODE = originalEnv
  })

  describe('retrieveRelevantMemories', () => {
    it('returns empty array in ACTUAL mode when DB returns no records', async () => {
      process.env.NEXT_PUBLIC_DATASET_MODE = 'ACTUAL'
      const queryMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
      mockFrom.mockReturnValue(queryMock)

      const memories = await LongTermMemoryService.retrieveRelevantMemories('ws-actual-1', ['test'])
      expect(memories).toEqual([])
    })

    it('returns empty array in ACTUAL mode when DB returns an error', async () => {
      process.env.NEXT_PUBLIC_DATASET_MODE = 'ACTUAL'
      const queryMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'relation not found' } }),
      }
      mockFrom.mockReturnValue(queryMock)

      const memories = await LongTermMemoryService.retrieveRelevantMemories('ws-actual-1', ['test'])
      expect(memories).toEqual([])
    })

    it('returns seed memories in DEMO mode when DB is empty', async () => {
      process.env.NEXT_PUBLIC_DATASET_MODE = 'DEMO'
      const queryMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
      mockFrom.mockReturnValue(queryMock)

      const memories = await LongTermMemoryService.retrieveRelevantMemories('ws-demo-1', ['매장 주소'])
      expect(memories.length).toBeGreaterThan(0)
      expect(memories[0].provenanceType).toBe('canonical_seed')
    })
  })

  describe('CAR memory reliability', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: 'mem-1', workspace_id: 'ws-1', memory_class: 'semantic',
      subject: '예약금 정책', fact_content: '예약금은 2만원입니다',
      confidence_score: 0.4, provenance_type: 'user_dialogue',
      status: 'approved', created_at: '2026-10-28T00:00:00Z', ...overrides,
    })
    const retrieval = (data: unknown[]) => {
      const query = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data, error: null }),
      }
      mockFrom.mockReturnValue(query)
      return query
    }
    const memory = { memoryClass: 'semantic' as const, subject: '예약금', factContent: '2만원' }

    it.each([null, {}, [], { id: '' }, { id: ' ' }, { id: 123 }])('rejects missing DB identity: %j', async data => {
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data, error: null }),
      })
      await expect(LongTermMemoryService.storeMemory('ws-1', memory)).rejects.toThrow()
    })

    it('stores automatic observations as candidate and preserves confidence zero', async () => {
      const insert = vi.fn().mockReturnThis()
      mockFrom.mockReturnValue({ insert, select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'real-id' }, error: null }) })
      await LongTermMemoryService.storeMemory('ws-1', { ...memory, confidenceScore: 0 })
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({
        workspace_id: 'ws-1', status: 'candidate', confidence_score: 0,
      }))
      await LongTermMemoryService.storeMemory('ws-1', { ...memory, status: 'canonical' })
      expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'canonical' }))
    })

    it('ranks relevant Korean memories ahead of unrelated high confidence and excludes unsafe rows', async () => {
      const query = retrieval([
        row({ id: 'unrelated', subject: '영업시간', fact_content: '오전 9시 오픈', confidence_score: 1 }),
        row({ id: 'zero', confidence_score: 0 }),
        row({ id: 'other-tenant', workspace_id: 'ws-other' }),
        ...['candidate', 'conflicted', 'superseded'].map(status => row({ id: status, status })),
      ])
      const result = await LongTermMemoryService.retrieveRelevantMemories('ws-1', ['예약금은 얼마인가요?'], 1)
      expect(result.map(item => item.id)).toEqual(['zero'])
      expect(result[0].confidenceScore).toBe(0)
      expect(query.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
      expect(query.in).toHaveBeenCalledWith('status', ['approved', 'canonical'])
      expect(query.limit.mock.calls[0][0]).toBeGreaterThan(1)
      expect(query.limit.mock.calls[0][0]).toBeLessThanOrEqual(100)
    })

    it('matches English case insensitively and ranks lexical coverage before confidence', async () => {
      retrieval([row({ id: 'partial', subject: 'STYLE', fact_content: 'formal', confidence_score: 1 }),
        row({ id: 'full', subject: 'Brand Style', fact_content: 'warm', confidence_score: 0.1 })])
      const result = await LongTermMemoryService.retrieveRelevantMemories('ws-1', ['BRAND style'])
      expect(result.map(item => item.id)).toEqual(['full', 'partial'])
    })

    it.each([{ keywords: [] }, { keywords: ['   '] }, { keywords: ['관련없는질문'] }])('excludes unrelated or empty queries: $keywords', async ({ keywords }) => {
      retrieval([row()])
      expect(await LongTermMemoryService.retrieveRelevantMemories('ws-1', keywords)).toEqual([])
    })

    it.each([0, -1])('returns no memories for nonpositive limit %s', async limit => {
      retrieval([row()])
      expect(await LongTermMemoryService.retrieveRelevantMemories('ws-1', ['예약금'], limit)).toEqual([])
    })

    it.each([[NaN, 5], [Infinity, 5], [999, 20], [1.9, 1]])('normalizes limit %s to %s', async (limit, expected) => {
      retrieval(Array.from({ length: 30 }, (_, i) => row({ id: `mem-${i}` })))
      expect(await LongTermMemoryService.retrieveRelevantMemories('ws-1', ['예약금'], limit)).toHaveLength(expected)
    })

    it.each([null, 'bad', -1, 2])('does not inflate invalid confidence %j', async confidence => {
      retrieval([row({ confidence_score: confidence })])
      const result = await LongTermMemoryService.retrieveRelevantMemories('ws-1', ['예약금'])
      expect(result[0].confidenceScore).toBe(0)
    })

    it.each([
      { data: null, error: null }, { data: [], error: null },
      { data: null, error: { message: 'private database detail' } },
      { data: { id: 'wrong', workspace_id: 'ws-1', status: 'approved' }, error: null },
      { data: { id: 'mem-1', workspace_id: 'other', status: 'approved' }, error: null },
      { data: { id: 'mem-1', workspace_id: 'ws-1', status: 'candidate' }, error: null },
    ])('fails closed when promotion is not confirmed: %j', async response => {
      const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(response) }
      mockFrom.mockReturnValue(query)
      const result = await LongTermMemoryService.promoteMemoryStatus('ws-1', 'mem-1', 'approved')
      expect(result.success).toBe(false)
      expect(result.message).not.toContain('private database detail')
      expect(query.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
      expect(query.eq).toHaveBeenCalledWith('id', 'mem-1')
    })

    it('preserves zero confidence when listing candidates for review', async () => {
      mockFrom.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({
          data: [row({ status: 'candidate', confidence_score: 0 })], error: null,
        }) })
      expect((await LongTermMemoryService.listCandidates('ws-1'))[0].confidenceScore).toBe(0)
    })

    it('does not expose thrown database details in promotion failure', async () => {
      mockFrom.mockImplementationOnce(() => { throw new Error('private database detail') })
      const result = await LongTermMemoryService.promoteMemoryStatus('ws-1', 'mem-1', 'approved')
      expect(result.success).toBe(false)
      expect(result.message).not.toContain('private database detail')
    })

    it('never falls back to demo seeds after an ACTUAL retrieval exception', async () => {
      process.env.NEXT_PUBLIC_DATASET_MODE = 'ACTUAL'
      mockFrom.mockImplementationOnce(() => { throw new Error('offline') })
      expect(await LongTermMemoryService.retrieveRelevantMemories('ws-1', ['매장'])).toEqual([])
    })

    it('only reports promotion success for the matching returned row and status', async () => {
      mockFrom.mockReturnValue({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'mem-1', workspace_id: 'ws-1', status: 'approved' }, error: null,
        }) })
      expect((await LongTermMemoryService.promoteMemoryStatus('ws-1', 'mem-1', 'approved')).success).toBe(true)
    })
  })

  describe('storeMemory', () => {
    it('throws error and does NOT return fake mem-local ID when DB fails', async () => {
      process.env.NEXT_PUBLIC_DATASET_MODE = 'ACTUAL'
      const insertMock = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed', code: '42501' } }),
      }
      mockFrom.mockReturnValue(insertMock)

      await expect(
        LongTermMemoryService.storeMemory('ws-actual-1', {
          memoryClass: 'procedural',
          subject: 'Voice',
          factContent: 'Friendly tone',
        })
      ).rejects.toThrow()
    })

    it('returns real inserted id on DB success', async () => {
      process.env.NEXT_PUBLIC_DATASET_MODE = 'ACTUAL'
      const insertMock = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'real-mem-uuid-123' }, error: null }),
      }
      mockFrom.mockReturnValue(insertMock)

      const id = await LongTermMemoryService.storeMemory('ws-actual-1', {
        memoryClass: 'procedural',
        subject: 'Voice',
        factContent: 'Friendly tone',
      })
      expect(id).toBe('real-mem-uuid-123')
    })
  })
})
