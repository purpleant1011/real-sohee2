import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelMocks = vi.hoisted(() => ({
  calculateApprovalFingerprint: vi.fn((payload: unknown) => `fingerprint:${JSON.stringify(payload)}`),
  composeFirstPostWithGemini: vi.fn(),
  generateAndStoreQuickImage: vi.fn(),
  reserveQuickPostCredits: vi.fn(),
  settleQuickPostCredits: vi.fn(),
  releaseQuickPostCredits: vi.fn(),
  quickPostOperationKey: vi.fn(() => 'quick-post-operation-key'),
  quickPostCost: vi.fn((scope: string) => (scope === 'image' ? 0 : 100) + (scope === 'text' ? 0 : 150)),
}))

vi.mock('@/features/missions/conversational-first-post', () => ({
  calculateApprovalFingerprint: modelMocks.calculateApprovalFingerprint,
}))
vi.mock('../quick-copy', () => ({ composeQuickPostCopy: modelMocks.composeFirstPostWithGemini }))
vi.mock('../quick-image', () => ({ generateAndStoreQuickImage: modelMocks.generateAndStoreQuickImage }))
vi.mock('../quick-post-credits', () => ({
  QuickPostCreditFailure: class QuickPostCreditFailure extends Error {},
  quickPostCost: modelMocks.quickPostCost,
  quickPostOperationKey: modelMocks.quickPostOperationKey,
  reserveQuickPostCredits: modelMocks.reserveQuickPostCredits,
  settleQuickPostCredits: modelMocks.settleQuickPostCredits,
  releaseQuickPostCredits: modelMocks.releaseQuickPostCredits,
}))

import { createQuickDraft, listQuickPosts, summarize } from '../quick-post-service'

const payload = {
  workspaceId: 'ws-test',
  missionId: 'mission-without-payload',
  channels: [{ provider: 'instagram', handle: '@sohee' }],
  copies: { instagram: { caption: '첫 게시물', hashtags: ['소희'] }, threads: { content: '첫 게시물' } },
  imageIds: ['media-1'],
  boundVersions: { knowledgeVersion: 1, textHarnessVersion: 2, imageHarnessVersion: 3, operatingPolicyVersion: 4 },
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
}

function listingAdmin(rows: unknown[]) {
  const missionQuery: any = {
    select: vi.fn(() => missionQuery),
    eq: vi.fn(() => missionQuery),
    order: vi.fn(() => missionQuery),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  }
  const factQuery: any = {
    select: vi.fn(() => factQuery),
    eq: vi.fn(() => Promise.resolve({ data: [], count: 0, error: null })),
  }
  return {
    from: vi.fn((table: string) => {
      if (table === 'knowledge_facts') return factQuery
      return missionQuery
    }),
  }
}

describe('quick post service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelMocks.calculateApprovalFingerprint.mockImplementation((value) => `fingerprint:${JSON.stringify(value)}`)
    modelMocks.composeFirstPostWithGemini.mockResolvedValue(payload.copies)
    modelMocks.generateAndStoreQuickImage.mockResolvedValue({ assetId: 'media-1', objectPath: 'private/path', sha256Digest: 'digest', model: 'mock' })
    modelMocks.reserveQuickPostCredits.mockImplementation(async (params: any) => ({
      reservationId: 'reservation-1',
      requestedCredits: (params.scope === 'image' ? 0 : 100) + (params.scope === 'text' ? 0 : 150),
      state: 'reserved',
      operationKey: 'op-1',
      isReplay: false,
    }))
    modelMocks.settleQuickPostCredits.mockResolvedValue(undefined)
    modelMocks.releaseQuickPostCredits.mockResolvedValue(undefined)
  })

  it('omits missions without a payload and maps an image id to the workspace media URL', async () => {
    const admin = listingAdmin([
      { id: 'mission-without-payload', status: 'AWAITING_APPROVAL', metadata: { lane: 'QUICK_POST' }, created_at: '2025-01-01T00:00:00.000Z' },
      { id: 'mission-with-payload', status: 'AWAITING_APPROVAL', metadata: { payload, quick: { topic: '첫 게시물', businessName: '모모 카페' } }, created_at: '2025-01-02T00:00:00.000Z' },
    ])

    const result = await listQuickPosts(admin, 'ws-test')

    expect(result).toHaveLength(1)
    expect(result[0].missionId).toBe('mission-with-payload')
    expect(result[0].imageUrl).toBe('/api/workspaces/ws-test/media/media-1')
  })

  it.each(['generated', 'uploaded', 'pending', 'foreign'])('binds facts and %s photo to the stored draft without requiring a connected channel', async (source) => {
    const inserted: any[] = []
    const storedRow = {
      id: 'mission-created',
      status: 'AWAITING_APPROVAL',
      metadata: { lane: 'QUICK_POST', quick: { topic: '첫 게시물', businessName: '모모 카페', revision: 1 }, payload },
      created_at: '2025-01-02T00:00:00.000Z',
    }
    const insertQuery: any = {
      select: vi.fn(() => insertQuery),
      single: vi.fn(async () => ({ data: storedRow, error: null })),
    }
    const existingQuery: any = {
      select: vi.fn(() => existingQuery),
      eq: vi.fn(() => existingQuery),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    }
    const admin: any = {
      from: vi.fn((table: string) => {
        if (table === 'marketing_missions') {
          return {
            select: vi.fn((_columns: string, options?: { count?: string }) => {
              if (options?.count) {
                const quotaQuery: any = {
                  eq: vi.fn(() => quotaQuery),
                  not: vi.fn(() => quotaQuery),
                  gte: vi.fn(async () => ({ count: 0, error: null })),
                  then: (resolve: (v: any) => any) => Promise.resolve({ count: 0, error: null }).then(resolve),
                }
                return quotaQuery
              }
              return existingQuery
            }),
            insert: vi.fn((row: any) => {
              inserted.push(row)
              const insertChain: any = {
                select: vi.fn(() => insertChain),
                eq: vi.fn(() => insertChain),
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                single: vi.fn(async () => ({ data: { ...storedRow, id: row.id, metadata: row.metadata }, error: null })),
              }
              return insertChain
            }),
          }
        }
        const rows: Record<string, any> = {
          business_profiles: { data: { business_name: '모모 카페', industry: '카페', location: '성수동', summary: '동네 카페' } },
          workspace_knowledge_harnesses: { data: { version_no: 1, offerings: [{ value: '라테' }] } },
          harness_rules: { data: { version: 2, structured_rule: { brandVoice: '친근한 말투' } } },
          channel_connections: { data: [] },
          media_assets: { data: { id: 'uploaded-1', workspace_id: source === 'foreign' ? 'other-shop' : 'ws-test', provenance_kind: 'USER_UPLOAD', lifecycle_status: 'READY', rights_status: source === 'pending' ? 'pending' : 'confirmed', publish_eligibility: true,
            generation_metadata: { uploadRights: { copyright: 'owned', commercialUse: true, identifiablePeople: 'none', consentReference: null } } }, error: null },
          knowledge_facts: { data: [{
            id: 'fact-1', workspace_id: 'ws-test', category: 'PRICE', content: '라테 5,000원',
            status: 'active', source_candidate_id: 'candidate-1', approved_by_user_id: 'user-test',
            approved_at: '2025-01-01T00:00:00Z', valid_from: '2025-01-01T00:00:00Z',
            valid_until: null, supersedes_fact_id: null, created_at: '2025-01-01T00:00:00Z',
          }], count: 1, error: null },
        }
        const row = rows[table]
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          in: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          maybeSingle: vi.fn(async () => row),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(row).then(resolve),
        }
        return query
      }),
    }

    const request = createQuickDraft({ admin, workspaceId: 'ws-test', userId: 'user-test', topic: '첫 게시물',
      ...(source !== 'generated' ? { sourceAssetIds: ['uploaded-1'] } : {}),
    })
    if (source === 'pending' || source === 'foreign') {
      await expect(request).rejects.toMatchObject({ code: 'SOURCE_MEDIA_NOT_READY' })
      expect(modelMocks.composeFirstPostWithGemini).not.toHaveBeenCalled()
      expect(modelMocks.generateAndStoreQuickImage).not.toHaveBeenCalled()
      expect(inserted).toEqual([])
      return
    }
    const result = await request

    expect(modelMocks.composeFirstPostWithGemini).toHaveBeenCalledOnce()
    expect(modelMocks.generateAndStoreQuickImage).toHaveBeenCalledTimes(source === 'uploaded' ? 0 : 1)
    if (source === 'uploaded') {
      expect(inserted[0].metadata.sourceAssetIds).toEqual(['uploaded-1'])
      expect(inserted[0].metadata.payload.imageIds).toEqual(['uploaded-1'])
      expect(modelMocks.reserveQuickPostCredits).toHaveBeenCalledWith(expect.objectContaining({ scope: 'text' }))
    }
    expect(inserted).toHaveLength(1)
    expect(modelMocks.composeFirstPostWithGemini).toHaveBeenCalledWith(expect.objectContaining({
      confirmedFacts: ['라테 5,000원'],
    }))
    expect(inserted[0].metadata.factSnapshot.facts.map((fact: any) => fact.id)).toEqual(['fact-1'])
    expect(inserted[0].metadata.factSnapshot.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(inserted[0].metadata.lane).toBe('QUICK_POST')
    expect(inserted[0].metadata.payload.channels).toEqual([])
    expect(inserted[0].metadata.contract.budget_caps.max_cost_minor_units).toBe(source === 'uploaded' ? 100 : 250)
    expect(inserted[0].metadata.cost_credits).toBe(source === 'uploaded' ? 100 : 250)
    expect(inserted[0].metadata.draftFingerprint).toBe(`fingerprint:${JSON.stringify(inserted[0].metadata.payload)}`)
    expect(result.approvalFingerprint).toBe(modelMocks.calculateApprovalFingerprint.mock.results.at(-1)?.value)
    expect(inserted[0].metadata.draftFingerprint).toBe(result.approvalFingerprint)
  })

  it('combines brandVoice and 1200 chars toneAndManner when calling composeQuickPostCopy and queries harness_rules ordered by version desc', async () => {
    const inserted: any[] = []
    const storedRow = {
      id: 'mission-created',
      status: 'AWAITING_APPROVAL',
      metadata: { lane: 'QUICK_POST', quick: { topic: '스타일 테스트', businessName: '모모 카페', revision: 1 }, payload },
      created_at: '2025-01-02T00:00:00.000Z',
    }
    const orderCalls: Array<{ table: string; column: string; ascending: boolean }> = []
    const longStyle = '2. 상세 메뉴 지시문입니다. '.repeat(60)
    const admin: any = {
      from: vi.fn((table: string) => {
        if (table === 'marketing_missions') {
          return {
            select: vi.fn((_columns?: string, options?: { count?: string }) => {
              if (options?.count) {
                const quotaQuery: any = {
                  eq: vi.fn(() => quotaQuery),
                  not: vi.fn(() => quotaQuery),
                  gte: vi.fn(async () => ({ count: 0, error: null })),
                  then: (resolve: (v: any) => any) => Promise.resolve({ count: 0, error: null }).then(resolve),
                }
                return quotaQuery
              }
              const existingQuery: any = {
                eq: vi.fn(() => existingQuery),
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              }
              return existingQuery
            }),
            insert: vi.fn((row: any) => {
              inserted.push(row)
              const insertChain: any = {
                select: vi.fn(() => insertChain),
                eq: vi.fn(() => insertChain),
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                single: vi.fn(async () => ({ data: { ...storedRow, id: row.id, metadata: row.metadata }, error: null })),
              }
              return insertChain
            }),
          }
        }
        const rows: Record<string, any> = {
          business_profiles: { data: { business_name: '모모 카페', industry: '카페', location: '성수동', summary: '동네 카페' } },
          workspace_knowledge_harnesses: { data: { version_no: 1, offerings: [{ value: '라테' }] } },
          harness_rules: { data: { version: 3, structured_rule: { brandVoice: '친근한 말투', toneAndManner: longStyle } } },
          channel_connections: { data: [] },
          knowledge_facts: { data: [], count: 0, error: null },
        }
        const row = rows[table]
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          in: vi.fn(() => query),
          order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
            orderCalls.push({ table, column: col, ascending: opts?.ascending ?? true })
            return query
          }),
          limit: vi.fn(() => query),
          maybeSingle: vi.fn(async () => row),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(row).then(resolve),
        }
        return query
      }),
    }

    await createQuickDraft({ admin, workspaceId: 'ws-test', userId: 'user-test', topic: '스타일 테스트' })

    expect(modelMocks.composeFirstPostWithGemini).toHaveBeenCalledWith(expect.objectContaining({
      brandVoice: expect.stringContaining('친근한 말투'),
    }))
    expect(modelMocks.composeFirstPostWithGemini).toHaveBeenCalledWith(expect.objectContaining({
      brandVoice: expect.stringContaining('2. 상세 메뉴 지시문입니다.'),
    }))
    expect(orderCalls.some((call) => call.table === 'harness_rules' && call.column === 'version' && call.ascending === false)).toBe(true)
  })

  it('summarize assigns supportsApprovalActions: true only when metadata.lane === QUICK_POST', () => {
    const quickLaneRow = {
      id: 'mission-quick',
      status: 'AWAITING_APPROVAL',
      created_at: '2025-01-01T00:00:00.000Z',
      metadata: { lane: 'QUICK_POST', payload, quick: { topic: '글', businessName: '가게' } },
    }
    const legacyRow = {
      id: 'mission-legacy',
      status: 'AWAITING_APPROVAL',
      created_at: '2025-01-01T00:00:00.000Z',
      metadata: { lane: 'FIRST_POST', payload, quick: { topic: '글', businessName: '가게' } },
    }
    const noLaneRow = {
      id: 'mission-nolane',
      status: 'AWAITING_APPROVAL',
      created_at: '2025-01-01T00:00:00.000Z',
      metadata: { payload, quick: { topic: '글', businessName: '가게' } },
    }

    const quickSummary = summarize('ws-test', quickLaneRow)
    const legacySummary = summarize('ws-test', legacyRow)
    const noLaneSummary = summarize('ws-test', noLaneRow)

    expect(quickSummary?.supportsApprovalActions).toBe(true)
    expect(legacySummary?.supportsApprovalActions).toBe(false)
    expect(noLaneSummary?.supportsApprovalActions).toBe(false)
  })
})
