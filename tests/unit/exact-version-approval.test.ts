import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filteredTableUpdate } from '../helpers/filtered-table-update'
import {
  CanonicalContentLifecycleService,
} from '@/features/content/canonical-content-lifecycle'

const WORKSPACE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_WORKSPACE_ID = 'cccccccc-3333-4333-8333-333333333333'
const ACTOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

let mockDb: Record<string, any[]> = {}
let beforeApprovalInsert: (() => void) | undefined
let beforeApprovalRead: (() => void) | undefined

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => {
      mockDb[tableName] = mockDb[tableName] || []

      return {
        select: vi.fn((_cols?: string) => {
          if (tableName === 'approvals') beforeApprovalRead?.()
          return {
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
        } }),

        insert: vi.fn((record: any) => {
          if (tableName === 'approvals') beforeApprovalInsert?.()
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

describe('ANI-1043: Durable Exact-Version Approval Authority & Readback Verification', () => {
  beforeEach(() => {
    mockDb = {
      content_items: [],
      content_versions: [],
      content_drafts: [],
      approvals: [],
    }
    beforeApprovalInsert = undefined
    beforeApprovalRead = undefined
    vi.restoreAllMocks()
  })

  it('approves exact version, writes immutable approval row, and verifies via readback', async () => {
    const created = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '승인 테스트',
      caption: '승인 대상 본문입니다.',
      createdBy: ACTOR_ID,
    })

    const approval = await CanonicalContentLifecycleService.approveContentVersion({
      workspaceId: WORKSPACE_ID,
      contentId: created.contentId,
      versionId: created.versionId,
      fingerprint: created.fingerprint,
      decidedBy: ACTOR_ID,
      reason: '사장님 승인 완료',
    })

    expect(approval.status).toBe('approved')
    expect(approval.approvalId).toBeDefined()
    expect(approval.versionId).toBe(created.versionId)
    expect(approval.fingerprint).toBe(created.fingerprint)

    // DB row in approvals
    expect(mockDb.approvals).toHaveLength(1)
    const appRecord = mockDb.approvals[0]
    expect(appRecord.workspace_id).toBe(WORKSPACE_ID)
    expect(appRecord.content_id).toBe(created.contentId)
    expect(appRecord.version_id).toBe(created.versionId)
    expect(appRecord.fingerprint).toBe(created.fingerprint)
    expect(appRecord.status).toBe('approved')
    expect(appRecord.disclosure_confirmed).toBe(true)
    expect(appRecord.rights_confirmed).toBe(true)

    // content_items status must be approved
    const item = mockDb.content_items[0]
    expect(item.status).toBe('approved')
  })

  it('rejects approval when version is stale / not current_version_id', async () => {
    const v1 = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '버전 분기 테스트',
      caption: 'v1 초안',
      createdBy: ACTOR_ID,
    })

    // Content is revised to v2
    await CanonicalContentLifecycleService.reviseContent({
      workspaceId: WORKSPACE_ID,
      contentId: v1.contentId,
      expectedVersionId: v1.versionId,
      caption: 'v2 수정본',
      createdBy: ACTOR_ID,
    })

    // Attempting to approve stale v1 must be rejected
    await expect(
      CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: v1.contentId,
        versionId: v1.versionId, // stale! current is v2!
        fingerprint: v1.fingerprint,
        decidedBy: ACTOR_ID,
      })
    ).rejects.toThrow(/최신 버전만 승인할 수 있습니다/)

    expect(mockDb.approvals).toHaveLength(0)
  })

  it('rejects approval when fingerprint does not match the version fingerprint', async () => {
    const created = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '지문 불일치 테스트',
      caption: '정상 본문',
      createdBy: ACTOR_ID,
    })

    const fakeFingerprint = '0'.repeat(64)

    await expect(
      CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: created.contentId,
        versionId: created.versionId,
        fingerprint: fakeFingerprint, // mismatch!
        decidedBy: ACTOR_ID,
      })
    ).rejects.toThrow(/지문.*일치하지 않습니다/)

    expect(mockDb.approvals).toHaveLength(0)
  })

  it('invalidates prior approval when content is revised to a new version', async () => {
    const v1 = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '승인 후 수정 테스트',
      caption: 'v1 본문',
      createdBy: ACTOR_ID,
    })

    // 1. Approve v1
    await CanonicalContentLifecycleService.approveContentVersion({
      workspaceId: WORKSPACE_ID,
      contentId: v1.contentId,
      versionId: v1.versionId,
      fingerprint: v1.fingerprint,
      decidedBy: ACTOR_ID,
    })

    let content = await CanonicalContentLifecycleService.getContent(WORKSPACE_ID, v1.contentId)
    expect(content?.isApproved).toBe(true)

    // 2. Revise content to v2
    const v2 = await CanonicalContentLifecycleService.reviseContent({
      workspaceId: WORKSPACE_ID,
      contentId: v1.contentId,
      expectedVersionId: v1.versionId,
      caption: 'v2 수정 본문',
      createdBy: ACTOR_ID,
    })

    // 3. v2 must NOT be approved! Prior approval is invalid for v2!
    content = await CanonicalContentLifecycleService.getContent(WORKSPACE_ID, v1.contentId)
    expect(content?.currentVersionId).toBe(v2.versionId)
    expect(content?.isApproved).toBe(false)
    expect(content?.status).toBe('draft')
  })

  it('does not approve a replacement version committed after the approval read', async () => {
    const created = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID, channel: 'instagram', title: '동시 수정',
      caption: '사장님이 확인한 원고', createdBy: ACTOR_ID,
    })
    const replacementId = 'dddddddd-4444-4444-8444-444444444444'
    beforeApprovalInsert = () => {
      mockDb.content_versions.push({ ...mockDb.content_versions[0], id: replacementId, caption: '다른 창의 수정본', fingerprint: 'f'.repeat(64) })
      Object.assign(mockDb.content_items[0], { current_version_id: replacementId, status: 'draft' })
    }

    await expect(CanonicalContentLifecycleService.approveContentVersion({
      workspaceId: WORKSPACE_ID, contentId: created.contentId, versionId: created.versionId,
      fingerprint: created.fingerprint, decidedBy: ACTOR_ID,
    })).rejects.toMatchObject({ code: 'NOT_LATEST_VERSION' })

    expect(mockDb.content_items[0]).toMatchObject({ current_version_id: replacementId, status: 'draft' })
    expect(await CanonicalContentLifecycleService.getContent(WORKSPACE_ID, created.contentId)).toMatchObject({
      currentVersionId: replacementId, isApproved: false, status: 'draft',
    })
  })

  it.each([
    { id: 'other-approval' },
    { content_id: 'other-content' },
    { fingerprint: 'b'.repeat(64) },
    { decided_by: 'other-actor' },
    { decided_at: null },
    { decided_at: 'not-a-date' },
    { rights_confirmed: false },
    { disclosure_confirmed: false },
  ])('does not treat an unrelated or incomplete persisted decision as approval readback: %j', async patch => {
    const created = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID, channel: 'instagram', title: '저장 근거 확인',
      caption: '검토한 원고', createdBy: ACTOR_ID,
    })
    beforeApprovalRead = () => Object.assign(mockDb.approvals[0], patch)

    await expect(CanonicalContentLifecycleService.approveContentVersion({
      workspaceId: WORKSPACE_ID, contentId: created.contentId, versionId: created.versionId,
      fingerprint: created.fingerprint, decidedBy: ACTOR_ID,
    })).rejects.toMatchObject({ code: 'APPROVAL_READBACK_FAILED' })
    expect(mockDb.content_items[0].status).toBe('draft')
  })

  it('isolates approval by workspace_id', async () => {
    const created = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '격리 테스트',
      caption: '본문',
      createdBy: ACTOR_ID,
    })

    // Attempting to approve from another workspace must be rejected
    await expect(
      CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: OTHER_WORKSPACE_ID,
        contentId: created.contentId,
        versionId: created.versionId,
        fingerprint: created.fingerprint,
        decidedBy: ACTOR_ID,
      })
    ).rejects.toThrow()

    expect(mockDb.approvals).toHaveLength(0)
  })
})
