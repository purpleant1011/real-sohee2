import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveApprovedFacts, type ApprovedFactRow, type ApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import { listQuickPosts, QuickPostError } from '../quick-post-service'

const workspaceId = 'ws-test'

const baseFact: ApprovedFactRow = {
  id: 'price-1',
  workspace_id: workspaceId,
  category: 'PRICE',
  content: '라테 4,000원',
  status: 'active',
  source_candidate_id: 'cand-1',
  approved_by_user_id: 'owner-1',
  approved_at: '2026-10-01T00:00:00Z',
  valid_from: '2026-10-01T00:00:00Z',
  valid_until: null,
  supersedes_fact_id: null,
  created_at: '2026-10-01T00:00:00Z',
}

const payload = {
  workspaceId,
  missionId: 'mission-1',
  channels: [{ provider: 'instagram', handle: '@sohee' }],
  copies: { instagram: { caption: '첫 게시물', hashtags: ['소희'] }, threads: { content: '첫 게시물' } },
  imageIds: ['media-1'],
  boundVersions: { knowledgeVersion: 1, textHarnessVersion: 2, imageHarnessVersion: 3, operatingPolicyVersion: 4 },
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
}

function createMockAdmin(options: {
  missions: any[]
  factRows?: ApprovedFactRow[]
  factError?: any
  onFactQuery?: () => void
}) {
  const queryMissions: any = {
    select: vi.fn(() => queryMissions),
    eq: vi.fn(() => queryMissions),
    order: vi.fn(() => queryMissions),
    limit: vi.fn(() => Promise.resolve({ data: options.missions, error: null })),
  }

  const queryFacts: any = {
    select: vi.fn(() => queryFacts),
    eq: vi.fn((col: string, val: string) => {
      options.onFactQuery?.()
      if (options.factError) {
        return Promise.resolve({ data: null, error: options.factError })
      }
      const data = options.factRows ?? [baseFact]
      return Promise.resolve({ data, count: data.length, error: null })
    }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'marketing_missions') return queryMissions
      if (table === 'knowledge_facts') return queryFacts
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('quick post fact review contract (ANI-1601)', () => {
  let currentSnapshot: ApprovedFactSnapshot

  beforeEach(() => {
    vi.clearAllMocks()
    currentSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-21T00:00:00Z',
      rows: [baseFact],
    })
  })

  it('provides factReview with CURRENT when draft snapshot matches current facts', async () => {
    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-current',
          status: 'AWAITING_APPROVAL',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            factSnapshot: currentSnapshot,
            quick: { topic: '오늘의 메뉴', businessName: '소희 카페' },
          },
          created_at: '2026-10-21T00:00:00.000Z',
        },
      ],
      factRows: [baseFact],
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(posts[0].factReview).toEqual({
      state: 'CURRENT',
      requiresOwnerReview: false,
      notice: null,
    })
  })

  it('marks REVIEW_REQUIRED with SNAPSHOT_MISSING when awaiting draft lacks persisted fact snapshot', async () => {
    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-legacy',
          status: 'AWAITING_APPROVAL',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            // no factSnapshot (legacy draft)
            quick: { topic: '과거 초안', businessName: '소희 카페' },
          },
          created_at: '2026-10-20T00:00:00.000Z',
        },
      ],
      factRows: [baseFact],
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(posts[0].factReview).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'SNAPSHOT_MISSING',
      notice: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    })
  })

  it('marks REVIEW_REQUIRED with WORKSPACE_MISMATCH if snapshot belongs to another workspace', async () => {
    const foreignSnapshot: ApprovedFactSnapshot = {
      ...currentSnapshot,
      workspaceId: 'other-workspace',
    }

    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-foreign',
          status: 'AWAITING_APPROVAL',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            factSnapshot: foreignSnapshot,
            quick: { topic: '타 매장 초안', businessName: '소희 카페' },
          },
          created_at: '2026-10-21T00:00:00.000Z',
        },
      ],
      factRows: [baseFact],
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(posts[0].factReview).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'WORKSPACE_MISMATCH',
      notice: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    })
  })

  it('marks REVIEW_REQUIRED with FACTS_CHANGED when price updates across Seoul effective date', async () => {
    // Draft was created with 4,000 KRW
    const draftSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-15T00:00:00Z',
      rows: [baseFact],
    })

    // Now current facts include a price increase to 5,000 KRW effective 2026-10-20
    const newPrice: ApprovedFactRow = {
      ...baseFact,
      id: 'price-2',
      content: '라테 5,000원',
      source_candidate_id: 'cand-2',
      valid_from: '2026-10-20T00:00:00Z',
      supersedes_fact_id: 'price-1',
    }

    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-price-changed',
          status: 'AWAITING_APPROVAL',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            factSnapshot: draftSnapshot,
            quick: { topic: '인상 전 가격 초안', businessName: '소희 카페' },
          },
          created_at: '2026-10-15T00:00:00.000Z',
        },
      ],
      factRows: [baseFact, newPrice],
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(posts[0].factReview).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'FACTS_CHANGED',
      notice: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    })
  })

  it('marks REVIEW_REQUIRED with FACTS_CHANGED when promo event expires', async () => {
    const eventFact: ApprovedFactRow = {
      id: 'event-1',
      workspace_id: workspaceId,
      category: 'EVENT',
      content: '오픈 기념 10% 할인',
      status: 'active',
      source_candidate_id: 'cand-event',
      approved_by_user_id: 'owner-1',
      approved_at: '2026-10-01T00:00:00Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-20T00:00:00Z',
      supersedes_fact_id: null,
      created_at: '2026-10-01T00:00:00Z',
    }

    // Created while event was valid
    const draftSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-15T00:00:00Z',
      rows: [baseFact, eventFact],
    })

    // Current time is after 2026-10-20, so eventFact is expired
    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-event-expired',
          status: 'AWAITING_APPROVAL',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            factSnapshot: draftSnapshot,
            quick: { topic: '이벤트 초안', businessName: '소희 카페' },
          },
          created_at: '2026-10-15T00:00:00.000Z',
        },
      ],
      factRows: [baseFact, eventFact],
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(posts[0].factReview).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'FACTS_CHANGED',
      notice: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    })
  })

  it('does NOT retroactively modify terminal (PUBLISHED / COMPLETED / SCHEDULED) posts', async () => {
    // Even if facts changed, published posts do not require review
    const oldSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-01T00:00:00Z',
      rows: [baseFact],
    })

    const admin = createMockAdmin({
      missions: [
        {
          id: 'mission-published',
          status: 'PUBLISHED',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            factSnapshot: oldSnapshot,
            quick: { topic: '이미 발행된 글', businessName: '소희 카페' },
          },
          created_at: '2026-10-01T00:00:00.000Z',
        },
      ],
      // No fact query should even be executed when there are no AWAITING_APPROVAL rows
      factRows: [baseFact],
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(posts[0].status).toBe('PUBLISHED')
    expect(posts[0].factReview).toBeUndefined()
  })

  it('fails with 503 FACT_READ_FAILED when fact snapshot query fails (never conceals as empty list)', async () => {
    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-1',
          status: 'AWAITING_APPROVAL',
          metadata: {
            lane: 'QUICK_POST',
            payload,
            factSnapshot: currentSnapshot,
            quick: { topic: '초안', businessName: '소희 카페' },
          },
          created_at: '2026-10-21T00:00:00.000Z',
        },
      ],
      factError: { message: 'Database connection timeout', code: 'PGRST_TIMEOUT' },
    })

    await expect(listQuickPosts(admin, workspaceId)).rejects.toThrow(QuickPostError)
    await expect(listQuickPosts(admin, workspaceId)).rejects.toMatchObject({
      code: 'FACT_READ_FAILED',
      status: 503,
    })
  })

  it('queries facts exactly once per list call (no N+1 query) when multiple awaiting drafts exist', async () => {
    let factQueryCount = 0
    const admin = createMockAdmin({
      missions: [
        {
          id: 'draft-1',
          status: 'AWAITING_APPROVAL',
          metadata: { lane: 'QUICK_POST', payload, factSnapshot: currentSnapshot, quick: { topic: '초안 1', businessName: '소희 카페' } },
          created_at: '2026-10-21T00:00:00.000Z',
        },
        {
          id: 'draft-2',
          status: 'AWAITING_APPROVAL',
          metadata: { lane: 'QUICK_POST', payload, factSnapshot: currentSnapshot, quick: { topic: '초안 2', businessName: '소희 카페' } },
          created_at: '2026-10-21T00:00:00.000Z',
        },
        {
          id: 'draft-3',
          status: 'AWAITING_APPROVAL',
          metadata: { lane: 'QUICK_POST', payload, factSnapshot: currentSnapshot, quick: { topic: '초안 3', businessName: '소희 카페' } },
          created_at: '2026-10-21T00:00:00.000Z',
        },
      ],
      factRows: [baseFact],
      onFactQuery: () => {
        factQueryCount++
      },
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(3)
    expect(factQueryCount).toBe(1)
  })

  it('does NOT query facts at all if there are no AWAITING_APPROVAL rows', async () => {
    let factQueryCount = 0
    const admin = createMockAdmin({
      missions: [
        {
          id: 'post-completed',
          status: 'COMPLETED',
          metadata: { lane: 'QUICK_POST', payload, quick: { topic: '완료 글', businessName: '소희 카페' } },
          created_at: '2026-10-20T00:00:00.000Z',
        },
      ],
      onFactQuery: () => {
        factQueryCount++
      },
    })

    const posts = await listQuickPosts(admin, workspaceId)
    expect(posts).toHaveLength(1)
    expect(factQueryCount).toBe(0)
  })

  it('fails with 503 FACT_READ_FAILED when fact reading is truncated or incomplete', async () => {
    const queryFacts: any = {
      select: vi.fn(() => queryFacts),
      eq: vi.fn(() => Promise.resolve({ data: [baseFact], count: 2, error: null })),
    }
    const queryMissions: any = {
      select: vi.fn(() => queryMissions),
      eq: vi.fn(() => queryMissions),
      order: vi.fn(() => queryMissions),
      limit: vi.fn(() => Promise.resolve({
        data: [{
          id: 'draft-1',
          status: 'AWAITING_APPROVAL',
          metadata: { lane: 'QUICK_POST', payload, factSnapshot: currentSnapshot, quick: { topic: '초안', businessName: '소희 카페' } },
          created_at: '2026-10-21T00:00:00.000Z',
        }],
        error: null,
      })),
    }
    const admin: any = {
      from: vi.fn((table: string) => {
        if (table === 'marketing_missions') return queryMissions
        if (table === 'knowledge_facts') return queryFacts
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(listQuickPosts(admin, workspaceId)).rejects.toMatchObject({
      code: 'FACT_READ_FAILED',
      status: 503,
    })
  })
})
