import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filteredTableUpdate } from '../helpers/filtered-table-update'
import {
  CanonicalContentLifecycleService,
  computeCanonicalFingerprint,
} from '@/features/content/canonical-content-lifecycle'
import { PersistenceError } from '@/lib/errors/persistence-error'

const WORKSPACE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const ACTOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

let mockDb: Record<string, any[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => {
      mockDb[tableName] = mockDb[tableName] || []

      return {
        select: vi.fn((_cols?: string) => ({
          eq: vi.fn((col1: string, val1: any) => ({
            eq: vi.fn((col2: string, val2: any) => ({
              eq: vi.fn((col3: string, val3: any) => ({
                maybeSingle: vi.fn(async () => {
                  const row = mockDb[tableName]?.find(
                    (r) => r[col1] === val1 && r[col2] === val2 && r[col3] === val3
                  )
                  return { data: row ? { ...row } : null, error: null }
                }),
                single: vi.fn(async () => {
                  const row = mockDb[tableName]?.find(
                    (r) => r[col1] === val1 && r[col2] === val2 && r[col3] === val3
                  )
                  if (!row) return { data: null, error: new Error('Row not found') }
                  return { data: { ...row }, error: null }
                }),
              })),
              order: vi.fn((_orderCol: string, _opts: any) => {
                const rows = mockDb[tableName]?.filter(
                  (r) => r[col1] === val1 && r[col2] === val2
                ) || []
                return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null })
              }),
              maybeSingle: vi.fn(async () => {
                const row = mockDb[tableName]?.find(
                  (r) => r[col1] === val1 && r[col2] === val2
                )
                return { data: row ? { ...row } : null, error: null }
              }),
              single: vi.fn(async () => {
                const row = mockDb[tableName]?.find(
                  (r) => r[col1] === val1 && r[col2] === val2
                )
                if (!row) return { data: null, error: new Error('Row not found') }
                return { data: { ...row }, error: null }
              }),
            })),
            order: vi.fn((_orderCol: string, _opts: any) => {
              const rows = mockDb[tableName]?.filter((r) => r[col1] === val1) || []
              return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null })
            }),
            maybeSingle: vi.fn(async () => {
              const row = mockDb[tableName]?.find((r) => r[col1] === val1)
              return { data: row ? { ...row } : null, error: null }
            }),
            single: vi.fn(async () => {
              const row = mockDb[tableName]?.find((r) => r[col1] === val1)
              if (!row) return { data: null, error: new Error('Row not found') }
              return { data: { ...row }, error: null }
            }),
          })),
        })),

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

describe('ANI-1041: Canonical ContentItem·Version Persistence & Invariants', () => {
  beforeEach(() => {
    mockDb = {
      content_items: [],
      content_versions: [],
      content_drafts: [],
      approvals: [],
    }
    vi.restoreAllMocks()
  })

  describe('createContent', () => {
    it('creates content_items, content_versions (v1), and content_drafts with valid SHA-256 fingerprint', async () => {
      const caption = '소희 테스트 키친의 대표 메뉴 바질 파스타입니다.'
      const created = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '바질 파스타 룩북',
        caption,
        hashtags: ['#바질파스타', '#소희테스트키친'],
        mediaUrls: ['https://storage.example.com/media/pasta.jpg'],
        createdBy: ACTOR_ID,
      })

      expect(created.contentId).toBeDefined()
      expect(created.versionId).toBeDefined()
      expect(created.status).toBe('draft')
      expect(created.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(created.fingerprint).toBe(computeCanonicalFingerprint(caption))

      // DB check
      expect(mockDb.content_items).toHaveLength(1)
      expect(mockDb.content_versions).toHaveLength(1)
      expect(mockDb.content_drafts).toHaveLength(1)

      const item = mockDb.content_items[0]
      expect(item.id).toBe(created.contentId)
      expect(item.workspace_id).toBe(WORKSPACE_ID)
      expect(item.current_version_id).toBe(created.versionId)
      expect(item.status).toBe('draft')

      const version = mockDb.content_versions[0]
      expect(version.id).toBe(created.versionId)
      expect(version.version_number).toBe(1)
      expect(version.content_id).toBe(created.contentId)
      expect(version.fingerprint).toBe(created.fingerprint)
      expect(version.caption).toBe(caption)
    })

    it('rejects empty or whitespace-only caption (Fail-Closed)', async () => {
      await expect(
        CanonicalContentLifecycleService.createContent({
          workspaceId: WORKSPACE_ID,
          channel: 'instagram',
          title: '빈 본문',
          caption: '   \n  ',
        })
      ).rejects.toThrow(PersistenceError)

      expect(mockDb.content_items).toHaveLength(0)
      expect(mockDb.content_versions).toHaveLength(0)
    })
  })

  describe('reviseContent (Immutable Version Increment)', () => {
    it('creates v2 on revision, updates current_version_id, and resets status to draft', async () => {
      const v1 = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '초안',
        caption: '첫 번째 버전 본문',
        createdBy: ACTOR_ID,
      })

      // Simulate approving v1 first
      await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: v1.contentId,
        versionId: v1.versionId,
        fingerprint: v1.fingerprint,
        decidedBy: ACTOR_ID,
      })

      const itemBeforeRevision = mockDb.content_items[0]
      expect(itemBeforeRevision.status).toBe('approved')

      // Now revise to v2
      const revisedCaption = '두 번째 수정된 버전 본문입니다.'
      const v2 = await CanonicalContentLifecycleService.reviseContent({
        workspaceId: WORKSPACE_ID,
        contentId: v1.contentId,
        expectedVersionId: v1.versionId,
        caption: revisedCaption,
        hashtags: ['#수정본'],
        revisionReason: '대표님 피드백 반영 문구 보강',
        createdBy: ACTOR_ID,
      })

      expect(v2.contentId).toBe(v1.contentId)
      expect(v2.versionId).not.toBe(v1.versionId)
      expect(v2.versionNumber).toBe(2)
      expect(v2.fingerprint).toBe(computeCanonicalFingerprint(revisedCaption))
      expect(v2.status).toBe('draft')

      // DB verification
      expect(mockDb.content_versions).toHaveLength(2)
      const v2Record = mockDb.content_versions.find((v) => v.id === v2.versionId)
      expect(v2Record).toBeDefined()
      expect(v2Record.version_number).toBe(2)
      expect(v2Record.caption).toBe(revisedCaption)
      expect(v2Record.revision_reason).toBe('대표님 피드백 반영 문구 보강')

      // content_items current_version_id must now point to v2 and status reset to draft
      const itemAfterRevision = mockDb.content_items[0]
      expect(itemAfterRevision.current_version_id).toBe(v2.versionId)
      expect(itemAfterRevision.status).toBe('draft')
    })

    it('rejects revision if expectedVersionId does not match current_version_id (Stale Concurrency Gate)', async () => {
      const v1 = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '동시 수정 테스트',
        caption: '초기 본문',
        createdBy: ACTOR_ID,
      })

      // Client A updates to v2
      await CanonicalContentLifecycleService.reviseContent({
        workspaceId: WORKSPACE_ID,
        contentId: v1.contentId,
        expectedVersionId: v1.versionId,
        caption: '클라이언트 A가 수정한 본문',
        createdBy: ACTOR_ID,
      })

      // Client B attempts to update using stale expectedVersionId (v1.versionId)
      await expect(
        CanonicalContentLifecycleService.reviseContent({
          workspaceId: WORKSPACE_ID,
          contentId: v1.contentId,
          expectedVersionId: v1.versionId, // stale! current is v2!
          caption: '클라이언트 B가 충돌을 일으키는 본문',
          createdBy: ACTOR_ID,
        })
      ).rejects.toThrow(/동시 수정 충돌/)

      // Ensure no 3rd version was created
      expect(mockDb.content_versions).toHaveLength(2)
    })
  })

  describe('Fingerprint Integrity', () => {
    it('generates consistent 64-hex SHA-256 for identical trimmed captions and diverges on any character difference', () => {
      const textA = '안녕하세요 맛있는 커피를 준비했습니다'
      const textB = '  안녕하세요 맛있는 커피를 준비했습니다  \n'
      const textC = '안녕하세요 맛있는 커피를 준비했습니다.' // period added

      const fpA = computeCanonicalFingerprint(textA)
      const fpB = computeCanonicalFingerprint(textB)
      const fpC = computeCanonicalFingerprint(textC)

      expect(fpA).toBe(fpB)
      expect(fpA).not.toBe(fpC)
      expect(fpA).toMatch(/^[a-f0-9]{64}$/)
      expect(fpC).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})
