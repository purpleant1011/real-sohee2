import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { filteredTableUpdate } from '../helpers/filtered-table-update'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import { createInstagramProvider, createThreadsProvider } from '@/lib/providers/meta-api'
import { getPostReadback } from '@/lib/providers/instagram-provider'

const WORKSPACE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const ACTOR_ID = 'tester-bbbbbbbb-2222-4222-8222-222222222222'

// In-memory mock database
let mockDb: Record<string, any[]> = {}

function createMockQueryBuilder(tableName: string) {
  mockDb[tableName] = mockDb[tableName] || []

  let filters: Array<{ col: string; val: any }> = []

  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: any) => {
      filters.push({ col, val })
      return builder
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      const row = mockDb[tableName]?.find(r => 
        filters.every(f => r[f.col] === f.val)
      )
      return { data: row ? { ...row } : null, error: null }
    }),
    single: vi.fn(async () => {
      const row = mockDb[tableName]?.find(r => 
        filters.every(f => r[f.col] === f.val)
      )
      return { data: row ? { ...row } : null, error: null }
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
      const existingIdx = mockDb[tableName].findIndex(
        r => (record.id && r.id === record.id) ||
             (record.workspace_id && record.idempotency_key && r.workspace_id === record.workspace_id && r.idempotency_key === record.idempotency_key)
      )
      if (existingIdx >= 0) {
        const existing = mockDb[tableName][existingIdx]
        const updated = { ...existing, ...record, id: existing.id }
        mockDb[tableName][existingIdx] = updated
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { ...updated }, error: null })),
          })),
          then: (resolve: any) => resolve({ data: { ...updated }, error: null }),
        }
      }
      const row = { id: record.id || crypto.randomUUID(), ...record }
      mockDb[tableName].push(row)
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { ...row }, error: null })),
        })),
        then: (resolve: any) => resolve({ data: { ...row }, error: null }),
      }
    }),
    update: vi.fn((patch: any) => filteredTableUpdate(mockDb[tableName], patch)),
  }

  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => createMockQueryBuilder(tableName)),
  })),
}))

// Mock credential repository to return verified Meta tokens
vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async (_wsId: string, channel: string) => ({
    accessToken: `EAAB_MOCK_TOKEN_FOR_${channel.toUpperCase()}`,
    externalAccountId: `meta_acc_${channel}_12345`,
  })),
}))

// Mock kill switch to allow execution
vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({
    blocked: false,
    reason: null,
  })),
}))

// Mock Meta Providers
const mockIgPublish = vi.fn(async () => ({
  providerPostId: '17999888777666555',
  destinationUrl: 'https://www.instagram.com/p/C9_TEST_POST/',
}))

const mockThPublish = vi.fn(async () => ({
  providerPostId: '17888777666555444',
  destinationUrl: 'https://www.threads.net/post/T9_TEST_POST',
}))

vi.mock('@/lib/providers/meta-api', () => ({
  createInstagramProvider: vi.fn(() => ({
    publish: mockIgPublish,
  })),
  createThreadsProvider: vi.fn(() => ({
    publish: mockThPublish,
  })),
  getPublishedMetaPostPermalink: vi.fn(async () => 'https://www.instagram.com/p/C9_TEST_POST/'),
}))

vi.mock('@/lib/providers/instagram-provider', () => ({
  getPostReadback: vi.fn(async (postId: string, _token: string, options: any) => ({
    isLive: true,
    postId,
    permalink: options?.channel === 'threads'
      ? 'https://www.threads.net/post/T9_TEST_POST'
      : 'https://www.instagram.com/p/C9_TEST_POST/',
    caption: 'Verified live caption',
    readbackRequestId: 'rb_req_123456',
    observedAt: new Date().toISOString(),
    captionDigest: 'sha256_mock_digest',
  })),
}))

describe('Wave 4: Instagram & Threads Supervised Golden Journey (ANI-1045, ANI-1046, ANI-1047)', () => {
  beforeEach(() => {
    vi.stubEnv('META_DATA_DELETION_CALLBACK_ENABLED', 'true')
    vi.stubEnv('META_APP_MODE', 'development')
    vi.stubEnv('META_APP_REVIEW_STATUS', 'unsubmitted')
    vi.stubEnv('META_ACCESS_TIER', 'standard')
    mockDb = {
      channel_connections: [
        { workspace_id: WORKSPACE_ID, channel: 'instagram', status: 'connected', webhook_status: 'healthy', last_webhook_at: new Date().toISOString() },
        { workspace_id: WORKSPACE_ID, channel: 'threads', status: 'connected', webhook_status: 'healthy', last_webhook_at: new Date().toISOString() },
      ],
      content_items: [],
      content_versions: [],
      approvals: [],
      content_drafts: [],
      external_action_requests: [],
      external_action_attempts: [],
      external_action_receipts: [],
      proof_chains: [],
      evidence_ledger: [],
    }
    vi.clearAllMocks()
  })

  afterEach(() => vi.unstubAllEnvs())

  describe('Instagram Supervised Vertical Chain (ANI-1046)', () => {
    it('executes full end-to-end chain: User Command -> v1 Draft -> User Edit (v2) -> Exact Approval -> Publish -> Independent Readback -> Receipt', async () => {
      const v1Caption = '자연스러운 한 올 한 올 결 브로우 시술 안내입니다 ✨ #청라눈썹 #소희AI'
      const v2Caption = '대표 원장 1:1 맞춤 자연결 엠보 브로우 디자인 가이드입니다 ✨ #청라눈썹 #소희AI'
      const imageUrl = 'https://images.example.com/lookbook-verified-01.jpg'

      // Step 1: User Command generates Canonical Content & Version (v1)
      const content = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '인스타그램 봄맞이 룩북 피드',
        caption: v1Caption,
        hashtags: ['#청라눈썹', '#소희AI'],
        mediaUrls: [imageUrl],
        createdBy: ACTOR_ID,
      })

      expect(content.contentId).toBeDefined()
      expect(content.versionId).toBeDefined()
      expect(content.versionNumber).toBe(1)
      expect(content.fingerprint).toMatch(/^[a-f0-9]{64}$/)

      // Invariant: Before approval, provider write calls must be 0
      expect(mockIgPublish).toHaveBeenCalledTimes(0)

      // Step 2: User Edit generates immutable v2
      const revised = await CanonicalContentLifecycleService.reviseContent({
        workspaceId: WORKSPACE_ID,
        contentId: content.contentId,
        expectedVersionId: content.versionId,
        caption: v2Caption,
        mediaUrls: [imageUrl],
        revisedBy: ACTOR_ID,
        revisionReason: '대표 원장 직접 문구 수정',
      })

      expect(revised.versionNumber).toBe(2)
      expect(revised.versionId).not.toBe(content.versionId)
      expect(revised.fingerprint).not.toBe(content.fingerprint)

      // Step 3: User Approval Gate on v2 (Immutable write to approvals)
      const approval = await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: content.contentId,
        versionId: revised.versionId,
        fingerprint: revised.fingerprint,
        decidedBy: ACTOR_ID,
        reason: '수정된 v2 최종본 승인',
      })

      expect(approval.status).toBe('approved')
      expect(approval.fingerprint).toBe(revised.fingerprint)
      expect(mockDb.approvals).toHaveLength(1)

      // Step 4: Supervised Publishing via PublishingExecutor
      const result = await PublishingExecutor.executePublish({
        workspaceId: WORKSPACE_ID,
        channel: 'INSTAGRAM',
        caption: v2Caption,
        imageUrl,
        contentVersionId: revised.versionId,
        expectedFingerprint: revised.fingerprint,
        actorUserId: ACTOR_ID,
      })

      // Verification of result
      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)
      expect(result.stage).toBe('EXTERNAL_VERIFIED')
      expect(result.publishedUrl).toBe('https://www.instagram.com/p/C9_TEST_POST/')
      expect(result.externalPostId).toBe('17999888777666555')
      expect(result.receiptId).toBeDefined()

      // Step 5: Lineage Verification in DB
      // 1) external_action_requests exists with valid schema (channel=instagram, action_kind=feed_publish)
      expect(mockDb.external_action_requests).toHaveLength(1)
      const req = mockDb.external_action_requests[0]
      expect(req.channel).toBe('instagram')
      expect(req.action_kind).toBe('feed_publish')
      expect(req.status).toBe('succeeded')
      expect(req.content_version_id).toBe(revised.versionId)

      // 2) external_action_attempts exists with FK matching request
      expect(mockDb.external_action_attempts).toHaveLength(1)
      const attempt = mockDb.external_action_attempts[0]
      expect(attempt.action_request_id).toBe(req.id)
      expect(attempt.status).toBe('succeeded')

      // 3) external_action_receipts exists with verified result_url and observed_payload
      expect(mockDb.external_action_receipts).toHaveLength(1)
      const receipt = mockDb.external_action_receipts[0]
      expect(receipt.action_request_id).toBe(req.id)
      expect(receipt.attempt_id).toBe(attempt.id)
      expect(receipt.receipt_kind).toBe('observed_result')
      expect(receipt.result_url).toBe('https://www.instagram.com/p/C9_TEST_POST/')
      expect(receipt.provider_reference).toBe('17999888777666555')

      // Step 6: Cross-Reboot / F5 Persistence (Reading back verified receipt from DB)
      const persistedReceipt = mockDb.external_action_receipts.find(
        r => r.action_request_id === req.id
      )
      expect(persistedReceipt).toBeDefined()
      expect(persistedReceipt.result_url).toBe('https://www.instagram.com/p/C9_TEST_POST/')
      expect(persistedReceipt.provider_reference).toBe('17999888777666555')
    })

    it('blocks publishing when media asset is missing or placeholder (zero fake stock invariant)', async () => {
      const result = await PublishingExecutor.executePublish({
        workspaceId: WORKSPACE_ID,
        channel: 'INSTAGRAM',
        caption: '플레이스홀더 테스트',
        imageUrl: 'https://images.unsplash.com/photo-fake-stock.jpg',
      })

      expect(result.success).toBe(false)
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('MISSING_APPROVED_ASSET')
      expect(mockIgPublish).toHaveBeenCalledTimes(0)
    })
  })

  describe('Threads Independent Supervised Chain (ANI-1047)', () => {
    it('executes full Threads chain independently without reusing Instagram objects', async () => {
      const threadsText = '🧵 오늘 우리 매장 비하인드 스토리 스레드입니다.\n\n정성스런 1:1 상담부터 디자인까지.'
      const imageUrl = 'https://images.example.com/threads-media-01.jpg'

      // Step 1: Create Threads Canonical Content
      const content = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'threads',
        title: '스레드 비하인드 스토리',
        caption: threadsText,
        hashtags: ['#비하인드', '#매장스토리'],
        mediaUrls: [imageUrl],
        createdBy: ACTOR_ID,
      })

      // Step 2: Approve
      const approval = await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: content.contentId,
        versionId: content.versionId,
        fingerprint: content.fingerprint,
      })

      // Step 3: Publish Threads
      const result = await PublishingExecutor.executePublish({
        workspaceId: WORKSPACE_ID,
        channel: 'THREADS',
        caption: threadsText,
        imageUrl,
        contentVersionId: content.versionId,
        expectedFingerprint: content.fingerprint,
        actorUserId: ACTOR_ID,
      })

      expect(result.success).toBe(true)
      expect(result.verified).toBe(true)
      expect(result.channel).toBe('THREADS')
      expect(result.publishedUrl).toBe('https://www.threads.net/post/T9_TEST_POST')
      expect(result.externalPostId).toBe('17888777666555444')

      // Invariant: channel must be 'threads', action_kind must be 'thread_publish'
      const req = mockDb.external_action_requests.find(r => r.channel === 'threads')
      expect(req).toBeDefined()
      expect(req.action_kind).toBe('thread_publish')
      expect(req.status).toBe('succeeded')

      // Invariant: Distinct provider call from Instagram
      expect(mockThPublish).toHaveBeenCalledTimes(1)
      expect(mockIgPublish).toHaveBeenCalledTimes(0)
    })

    it('fails closed when provider readback fails (Provider Accepted != Verified)', async () => {
      vi.mocked(getPostReadback).mockRejectedValueOnce(new Error('Post pending provider moderation or deleted'))

      const threadsText = '검증 실패 테스트 원고'
      const imageUrl = 'https://images.example.com/threads-media-fail.jpg'

      const content = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'threads',
        title: '스레드 검증 실패 테스트',
        caption: threadsText,
        mediaUrls: [imageUrl],
        createdBy: ACTOR_ID,
      })

      await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: content.contentId,
        versionId: content.versionId,
        fingerprint: content.fingerprint,
      })

      const result = await PublishingExecutor.executePublish({
        workspaceId: WORKSPACE_ID,
        channel: 'THREADS',
        caption: threadsText,
        imageUrl,
        contentVersionId: content.versionId,
        expectedFingerprint: content.fingerprint,
        actorUserId: ACTOR_ID,
      })

      // Invariant: Must NOT declare verified if readback failed
      expect(result.success).toBe(false)
      expect(result.verified).toBe(false)
      expect(result.stage).toBe('RESULT_UNKNOWN')
      expect(result.errorCode).toBe('READBACK_FAILED')
    })
  })

  describe('External Action Idempotency & Reconcile (ANI-1045)', () => {
    it('prevents duplicate provider writes when same approved content is published twice', async () => {
      const caption = '중복 게시 방지 검증 원고입니다.'
      const imageUrl = 'https://images.example.com/idempotent-01.jpg'

      const content = await CanonicalContentLifecycleService.createContent({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        title: '중복 방지 원고',
        caption,
        mediaUrls: [imageUrl],
        createdBy: ACTOR_ID,
      })

      await CanonicalContentLifecycleService.approveContentVersion({
        workspaceId: WORKSPACE_ID,
        contentId: content.contentId,
        versionId: content.versionId,
        fingerprint: content.fingerprint,
      })

      const input = {
        workspaceId: WORKSPACE_ID,
        channel: 'INSTAGRAM' as const,
        caption,
        imageUrl,
        contentVersionId: content.versionId,
        expectedFingerprint: content.fingerprint,
        actorUserId: ACTOR_ID,
      }

      // First submit
      const res1 = await PublishingExecutor.executePublish(input)
      expect(res1.success).toBe(true)
      expect(res1.verified).toBe(true)
      expect(mockIgPublish).toHaveBeenCalledTimes(1)

      // Double submit / Retry
      const res2 = await PublishingExecutor.executePublish(input)
      expect(res2.success).toBe(true)
      expect(res2.verified).toBe(true)
      expect(res2.publishedUrl).toBe(res1.publishedUrl)
      expect(res2.receiptId).toBe(res1.receiptId)

      // Invariant: Provider publish must be called only ONCE!
      expect(mockIgPublish).toHaveBeenCalledTimes(1)
    })
  })
})
