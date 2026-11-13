import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filteredTableUpdate } from '../helpers/filtered-table-update'
import {
  CanonicalContentLifecycleService,
} from '@/features/content/canonical-content-lifecycle'

const WORKSPACE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const ACTOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

let mockDb: Record<string, any[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => {
      mockDb[tableName] = mockDb[tableName] || []

      return {
        select: vi.fn(() => {
          const filters: Array<(row: any) => boolean> = []
          const rows = () => mockDb[tableName].filter(row => filters.every(filter => filter(row)))
            .map(row => ({ ...row }))
          const query: any = {
            eq: vi.fn((column: string, value: any) => {
              filters.push(row => row[column] === value)
              return query
            }),
            in: vi.fn((column: string, values: any[]) => {
              filters.push(row => values.includes(row[column]))
              return query
            }),
            order: vi.fn(() => query),
            maybeSingle: vi.fn(async () => ({ data: rows()[0] ?? null, error: null })),
            single: vi.fn(async () => {
              const row = rows()[0]
              return { data: row ?? null, error: row ? null : new Error('Row not found') }
            }),
            then: (resolve: any) => Promise.resolve({ data: rows(), error: null }).then(resolve),
          }
          return query
        }),

        insert: vi.fn((record: any) => {
          const row = { id: record.id || crypto.randomUUID(), ...record }
          mockDb[tableName].push(row)
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { ...row }, error: null })),
            })),
            then: (resolve: any) => resolve({ data: { ...row }, error: null }),
          }
        }),

        upsert: vi.fn((record: any) => {
          const row = { id: record.id || crypto.randomUUID(), ...record }
          const existingIdx = mockDb[tableName].findIndex((r) => r.id === row.id)
          if (existingIdx >= 0) {
            mockDb[tableName][existingIdx] = { ...mockDb[tableName][existingIdx], ...row }
          } else {
            mockDb[tableName].push(row)
          }
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { ...row }, error: null })),
            })),
            then: (resolve: any) => resolve({ data: { ...row }, error: null }),
          }
        }),

        update: vi.fn((patch: any) => filteredTableUpdate(mockDb[tableName], patch)),
      }
    }),
  })),
}))

describe('ANI-1042: Chat ↔ Content Panel Same Entity SSOT & Concurrency Control', () => {
  beforeEach(() => {
    mockDb = {
      content_items: [],
      content_versions: [],
      content_drafts: [],
      approvals: [],
    }
    vi.restoreAllMocks()
  })

  it('v1 -> v2 (Panel Edit) -> v3 (Chat Edit): preserves Same Entity and monotonically increments version', async () => {
    // 1. Initial creation (e.g. from Interview or Chat)
    const initial = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '청라 카페 봄 신메뉴',
      caption: 'v1 초기 초안입니다.',
      createdBy: ACTOR_ID,
    })

    expect(initial.status).toBe('draft')

    // 2. Panel Edit creates v2
    const panelEdit = await CanonicalContentLifecycleService.reviseContent({
      workspaceId: WORKSPACE_ID,
      contentId: initial.contentId,
      expectedVersionId: initial.versionId,
      caption: 'v2 패널에서 사장님이 직접 수정한 본문입니다.',
      revisionReason: '패널 에디터 수정',
      createdBy: ACTOR_ID,
    })

    expect(panelEdit.versionNumber).toBe(2)
    expect(panelEdit.versionId).not.toBe(initial.versionId)

    // Verify Chat reading the latest item sees v2
    const currentForChat = await CanonicalContentLifecycleService.getContent(WORKSPACE_ID, initial.contentId)
    expect(currentForChat).toBeDefined()
    expect(currentForChat?.currentVersionId).toBe(panelEdit.versionId)
    expect(currentForChat?.versionNumber).toBe(2)
    expect(currentForChat?.caption).toBe('v2 패널에서 사장님이 직접 수정한 본문입니다.')

    // 3. Chat Edit creates v3
    const chatEdit = await CanonicalContentLifecycleService.reviseContent({
      workspaceId: WORKSPACE_ID,
      contentId: initial.contentId,
      expectedVersionId: panelEdit.versionId, // Chat references latest v2
      caption: 'v3 챗봇 소희가 사장님 지시에 따라 재작성한 본문입니다.',
      revisionReason: '대화형 AI 수정 지시',
      createdBy: ACTOR_ID,
    })

    expect(chatEdit.versionNumber).toBe(3)
    expect(chatEdit.versionId).not.toBe(panelEdit.versionId)

    // Verify Panel reading the latest item sees v3
    const currentForPanel = await CanonicalContentLifecycleService.getContent(WORKSPACE_ID, initial.contentId)
    expect(currentForPanel?.currentVersionId).toBe(chatEdit.versionId)
    expect(currentForPanel?.versionNumber).toBe(3)
    expect(currentForPanel?.caption).toBe('v3 챗봇 소희가 사장님 지시에 따라 재작성한 본문입니다.')

    // Both Chat and Panel share exact same versionId and fingerprint
    expect(currentForPanel?.fingerprint).toBe(chatEdit.fingerprint)
  })

  it('blocks stale edit with STALE_VERSION_CONFLICT when another surface already incremented version', async () => {
    // Initial v1
    const initial = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '동시성 테스트',
      caption: 'v1 초안',
      createdBy: ACTOR_ID,
    })

    // Surface 1 (Panel) updates to v2
    const v2 = await CanonicalContentLifecycleService.reviseContent({
      workspaceId: WORKSPACE_ID,
      contentId: initial.contentId,
      expectedVersionId: initial.versionId,
      caption: 'v2 패널 수정',
      createdBy: ACTOR_ID,
    })

    // Surface 2 (Chat) tries to update using v1 (stale)
    let errorCaught: any = null
    try {
      await CanonicalContentLifecycleService.reviseContent({
        workspaceId: WORKSPACE_ID,
        contentId: initial.contentId,
        expectedVersionId: initial.versionId, // STALE!
        caption: '충돌 시도',
        createdBy: ACTOR_ID,
      })
    } catch (err: any) {
      errorCaught = err
    }

    expect(errorCaught).toBeDefined()
    expect(errorCaught.code).toBe('STALE_VERSION_CONFLICT')

    // Current version remains v2
    const content = await CanonicalContentLifecycleService.getContent(WORKSPACE_ID, initial.contentId)
    expect(content?.currentVersionId).toBe(v2.versionId)
    expect(content?.versionNumber).toBe(2)
  })

  describe('resolveAmbiguousContentTarget', () => {
    it('resolves activeContentId immediately if provided and exists', async () => {
      const item = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '선택된 콘텐츠',
        caption: '본문',
        createdBy: ACTOR_ID,
      })

      const target = await CanonicalContentLifecycleService.resolveAmbiguousContentTarget({
        workspaceId: WORKSPACE_ID,
        userPrompt: '이거 좀 더 짧게 고쳐줘',
        activeContentId: item.contentId,
      })

      expect(target.resolved).toBe(true)
      expect(target.contentId).toBe(item.contentId)
    })

    it('resolves the only existing draft if user mentions "아까 그거 / 마지막 초안"', async () => {
      const item = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '단일 초안',
        caption: '단일 초안 본문',
        createdBy: ACTOR_ID,
      })

      const target = await CanonicalContentLifecycleService.resolveAmbiguousContentTarget({
        workspaceId: WORKSPACE_ID,
        userPrompt: '아까 만든 초안 수정해줘',
      })

      expect(target.resolved).toBe(true)
      expect(target.contentId).toBe(item.contentId)
    })

    it('flags ambiguity when multiple candidates exist without activeContentId', async () => {
      await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '첫 번째 초안',
        caption: '초안 1',
        createdBy: ACTOR_ID,
      })
      await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '두 번째 초안',
        caption: '초안 2',
        createdBy: ACTOR_ID,
      })

      const target = await CanonicalContentLifecycleService.resolveAmbiguousContentTarget({
        workspaceId: WORKSPACE_ID,
        userPrompt: '방금 거 수정해줘',
      })

      expect(target.resolved).toBe(false)
      expect(target.ambiguous).toBe(true)
      expect(target.candidateItems?.length).toBeGreaterThanOrEqual(2)
    })
  })
})
