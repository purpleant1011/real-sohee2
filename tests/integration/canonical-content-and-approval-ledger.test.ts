import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import { PersistenceError } from '@/lib/errors/persistence-error'
import { filteredTableUpdate } from '../helpers/filtered-table-update'

const WORKSPACE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const CREATOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

// In-memory table store for integration verification
let mockDb: Record<string, any[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => {
      mockDb[tableName] = mockDb[tableName] || []

      return {
        select: vi.fn(() => {
          const filters: Array<(row: any) => boolean> = []
          const rows = () => mockDb[tableName].filter(row => filters.every(filter => filter(row)))
          const query: any = {
            eq: vi.fn((key: string, value: any) => { filters.push(row => row[key] === value); return query }),
            in: vi.fn((key: string, values: any[]) => { filters.push(row => values.includes(row[key])); return query }),
            order: vi.fn(() => query),
            maybeSingle: vi.fn(async () => ({ data: rows()[0] || null, error: null })),
            single: vi.fn(async () => ({ data: rows()[0] || null, error: null })),
            then: (resolve: any) => Promise.resolve({ data: rows(), error: null }).then(resolve),
          }
          return query
        }),

        insert: vi.fn((record: any) => {
          const row = { id: record.id || crypto.randomUUID(), ...record }
          mockDb[tableName].push(row)
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null })),
            })),
            then: (resolve: any) => resolve({ data: row, error: null }),
          }
        }),

        upsert: vi.fn((record: any) => {
          const row = { id: record.id || crypto.randomUUID(), ...record }
          const existingIdx = mockDb[tableName].findIndex(r => r.id === row.id)
          if (existingIdx >= 0) {
            mockDb[tableName][existingIdx] = { ...mockDb[tableName][existingIdx], ...row }
          } else {
            mockDb[tableName].push(row)
          }
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null })),
            })),
            then: (resolve: any) => resolve({ data: row, error: null }),
          }
        }),

        update: vi.fn((patch: any) => filteredTableUpdate(mockDb[tableName], patch)),
      }
    }),
  })),
}))

describe('Wave 2: Content & Approval Envelope (ANI-1023, ANI-1020)', () => {
  beforeEach(() => {
    mockDb = {
      content_items: [],
      content_versions: [],
      approvals: [],
      content_drafts: [],
      external_action_requests: [],
      external_action_attempts: [],
      external_action_receipts: [],
    }
    vi.restoreAllMocks()
  })

  describe('Canonical Content Lifecycle (ANI-1023)', () => {
    it('creates content_items and content_versions with strict 64-char hex SHA-256 fingerprint', async () => {
      const caption = '자연스러운 한 올 한 올 결 브로우 시술 안내입니다 ✨'
      const result = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '봄맞이 자연눈썹 안내',
        caption,
        hashtags: ['#자연눈썹', '#청라뷰티'],
        createdBy: CREATOR_ID,
      })

      expect(result.contentId).toBeDefined()
      expect(result.versionId).toBeDefined()
      expect(result.status).toBe('draft')

      // PostgreSQL Check constraint validation: check (fingerprint ~ '^[a-f0-9]{64}$')
      expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)

      // Verify DB rows persisted
      expect(mockDb.content_items).toHaveLength(1)
      expect(mockDb.content_versions).toHaveLength(1)
      expect(mockDb.content_drafts).toHaveLength(1)

      const savedItem = mockDb.content_items[0]
      expect(savedItem.id).toBe(result.contentId)
      expect(savedItem.workspace_id).toBe(WORKSPACE_ID)
      expect(savedItem.current_version_id).toBe(result.versionId)
      expect(savedItem.status).toBe('draft')

      const savedVersion = mockDb.content_versions[0]
      expect(savedVersion.id).toBe(result.versionId)
      expect(savedVersion.fingerprint).toBe(result.fingerprint)
      expect(savedVersion.caption).toBe(caption)
    })

    it('rejects empty caption with fail-closed error', async () => {
      await expect(
        CanonicalContentLifecycleService.createContent({
          workspaceId: WORKSPACE_ID,
          channel: 'instagram',
          title: '빈 캡션 테스트',
          caption: '   ',
        })
      ).rejects.toThrow(PersistenceError)

      expect(mockDb.content_items).toHaveLength(0)
    })

    it('approves content version and records immutable row in approvals table', async () => {
      const created = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '승인 테스트 원고',
        caption: '승인 테스트 원고 본문입니다.',
        createdBy: CREATOR_ID,
      })

      const approval = await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: created.contentId,
        versionId: created.versionId,
        fingerprint: created.fingerprint,
        decidedBy: CREATOR_ID,
        reason: '대표 원장 직접 최종 승인',
      })

      expect(approval.status).toBe('approved')
      expect(approval.fingerprint).toBe(created.fingerprint)

      // Verify approvals table has immutable row
      expect(mockDb.approvals).toHaveLength(1)
      const savedApproval = mockDb.approvals[0]
      expect(savedApproval.content_id).toBe(created.contentId)
      expect(savedApproval.version_id).toBe(created.versionId)
      expect(savedApproval.fingerprint).toBe(created.fingerprint)
      expect(savedApproval.status).toBe('approved')

      // Verify content_items status transitioned to approved
      const updatedItem = mockDb.content_items.find(i => i.id === created.contentId)
      expect(updatedItem.status).toBe('approved')
    })

    it('lists workspace contents with accurate approval state and fingerprint', async () => {
      const created = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '목록 조회 테스트',
        caption: '조회 대상 원고 본문',
        createdBy: CREATOR_ID,
      })

      // Before approval: isApproved should be false
      let list = await CanonicalContentLifecycleService.listWorkspaceContents(WORKSPACE_ID)
      expect(list).toHaveLength(1)
      expect(list[0].isApproved).toBe(false)
      expect(list[0].fingerprint).toBe(created.fingerprint)

      // After approval: isApproved should be true
      await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: created.contentId,
        versionId: created.versionId,
        fingerprint: created.fingerprint,
      })

      list = await CanonicalContentLifecycleService.listWorkspaceContents(WORKSPACE_ID)
      expect(list[0].isApproved).toBe(true)
      expect(list[0].approvalId).toBeDefined()
    })
  })

  describe('Canonical External Action Ledger (ANI-1020)', () => {
    it('creates external_action_requests before provider write invocation', async () => {
      const request = await CanonicalActionLedgerService.createActionRequest({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        targetExternalId: '17841400000000000',
        targetLabel: '@studio_by.reum',
        exactPayload: {
          caption: '실제 발행 캡션',
          imageUrl: 'https://cdn.example.com/asset.jpg',
        },
      })

      expect(request.requestId).toBeDefined()
      expect(request.status).toBe('prepared')
      expect(request.idempotencyKey).toBeDefined()

      expect(mockDb.external_action_requests).toHaveLength(1)
      const saved = mockDb.external_action_requests[0]
      expect(saved.id).toBe(request.requestId)
      expect(saved.channel).toBe('instagram')
      expect(saved.status).toBe('prepared')
    })

    it('transitions request to executing on startAttempt', async () => {
      const request = await CanonicalActionLedgerService.createActionRequest({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        targetExternalId: '17841400000000000',
        targetLabel: '@studio_by.reum',
        exactPayload: { caption: '발행 캡션' },
      })

      const attempt = await CanonicalActionLedgerService.startAttempt({
        workspaceId: WORKSPACE_ID,
        actionRequestId: request.requestId,
        attemptNumber: 1,
      })

      expect(attempt.attemptId).toBeDefined()
      expect(attempt.status).toBe('submitted')

      // Verify request status transitioned to executing
      const reqRow = mockDb.external_action_requests.find(r => r.id === request.requestId)
      expect(reqRow.status).toBe('executing')
      expect(mockDb.external_action_attempts).toHaveLength(1)
    })

    it('records verified receipt and marks attempt and request as succeeded', async () => {
      const request = await CanonicalActionLedgerService.createActionRequest({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        targetExternalId: '17841400000000000',
        targetLabel: '@studio_by.reum',
        exactPayload: { caption: '발행 캡션' },
      })

      const attempt = await CanonicalActionLedgerService.startAttempt({
        workspaceId: WORKSPACE_ID,
        actionRequestId: request.requestId,
      })

      const receipt = await CanonicalActionLedgerService.recordReceiptAndVerify({
        workspaceId: WORKSPACE_ID,
        actionRequestId: request.requestId,
        attemptId: attempt.attemptId,
        providerReference: 'ig_post_17999999999999999',
        resultUrl: 'https://www.instagram.com/p/C-xyz123/',
        observedPayload: { isLive: true, postId: 'ig_post_17999999999999999' },
      })

      expect(receipt.receiptId).toBeDefined()
      expect(receipt.status).toBe('succeeded')
      expect(receipt.resultUrl).toBe('https://www.instagram.com/p/C-xyz123/')

      // Verify DB status transitions
      expect(mockDb.external_action_receipts).toHaveLength(1)
      const attemptRow = mockDb.external_action_attempts.find(a => a.id === attempt.attemptId)
      expect(attemptRow.status).toBe('succeeded')
      expect(attemptRow.provider_reference).toBe('ig_post_17999999999999999')

      const reqRow = mockDb.external_action_requests.find(r => r.id === request.requestId)
      expect(reqRow.status).toBe('succeeded')
    })
  })
})
