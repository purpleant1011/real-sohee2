import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'
import { ProofChainService } from '@/lib/evidence/proof-chain-service'
import {
  getPostReadback,
  setInstagramReadbackFetcher,
  resetInstagramReadbackFetcher,
} from '@/lib/providers/instagram-provider'
import type { MetaFetch } from '@/lib/providers/meta-api'
import { MetaProviderError } from '@/lib/providers/meta-api'
import crypto from 'crypto'

const mockInsert = vi.fn((data: any) => ({
  select: vi.fn(() => ({
    single: vi.fn(async () => ({ data: { id: data?.id || 'rcpt_123' }, error: null })),
  })),
  then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
}))

const createMockQueryBuilder = (table?: string) => {
  if (table === 'external_action_receipts') {
    const qb: any = {
      select: vi.fn(() => qb),
      eq: vi.fn(() => qb),
      in: vi.fn(() => qb),
      order: vi.fn(() => qb),
      limit: vi.fn(() => qb),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
      insert: mockInsert,
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn(() => qb),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return qb
  }

  const qb: any = {
    select: vi.fn(() => qb),
    eq: vi.fn(() => qb),
    in: vi.fn(() => qb),
    order: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({
      data: {
        id: 'mock_ledger_id_123',
        status: 'prepared',
        idempotency_key: 'mock_idem_key',
        attempt_number: 1,
      },
      error: null,
    })),
    insert: vi.fn((data: any) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: {
            id: data?.id || 'mock_ledger_id_123',
            status: data?.status || 'prepared',
            idempotency_key: data?.idempotency_key || 'mock_idem_key',
            attempt_number: data?.attempt_number || 1,
          },
          error: null,
        })),
      })),
      then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
    })),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn(() => qb),
    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return qb
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((table: string) => createMockQueryBuilder(table)),
  })),
}))

vi.mock('@/features/channels/execution-admission-gate', () => ({
  ExecutionAdmissionGate: {
    evaluate: vi.fn().mockResolvedValue({ admitted: true }),
  },
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({ blocked: false })),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async () => ({
    accessToken: 'EAAB_test_access_token_secret_12345',
    externalAccountId: 'ig_scoped_user_99999',
  })),
}))

const mockIgPublish = vi.fn()
const mockThreadsPublish = vi.fn()

vi.mock('@/lib/providers/meta-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers/meta-api')>()
  return {
    ...actual,
    createInstagramProvider: vi.fn(() => ({
      publish: mockIgPublish,
    })),
    createThreadsProvider: vi.fn(() => ({
      publish: mockThreadsPublish,
    })),
  }
})

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  })
}

describe('Task 3.1: Meta Publishing True Independent Readback (ANI-950, ANI-956)', () => {
  const workspaceId = 'ws_meta_readback_test'

  beforeEach(() => {
    vi.clearAllMocks()
    ProofChainService._reset()
    resetInstagramReadbackFetcher()
  })

  describe('1. getPostReadback Unit Tests (Isolated Meta Graph GET)', () => {
    it('executes Meta Graph GET API with correct parameters and returns authoritative live details', async () => {
      const mockFetch = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            id: '1789000111222333',
            permalink: 'https://www.instagram.com/p/DB12345XYZ/',
            caption: '여름 시즌 신메뉴 공식 출시!',
            status_code: 'PUBLISHED',
          },
          200,
          { 'x-fb-trace-id': 'fb_trace_live_readback_001' }
        )
      )

      const result = await getPostReadback('1789000111222333', 'EAAB_test_access_token_secret_12345', {
        fetcher: mockFetch,
        channel: 'instagram',
      })

      expect(result.isLive).toBe(true)
      expect(result.postId).toBe('1789000111222333')
      expect(result.permalink).toBe('https://www.instagram.com/p/DB12345XYZ/')
      expect(result.caption).toBe('여름 시즌 신메뉴 공식 출시!')
      expect(result.statusCode).toBe('PUBLISHED')
      expect(result.observedAt).toBeDefined()
      expect(result.readbackRequestId).toContain('fb_trace_live_readback_001')

      // Verifies captionDigest is correct SHA-256
      const expectedDigest = crypto
        .createHash('sha256')
        .update('여름 시즌 신메뉴 공식 출시!', 'utf8')
        .digest('hex')
      expect(result.captionDigest).toBe(expectedDigest)

      // Verifies HTTP call contract
      expect(mockFetch).toHaveBeenCalledOnce()
      const [calledUrl, calledInit] = mockFetch.mock.calls[0]
      expect(calledUrl).toBe(
        'https://graph.instagram.com/v26.0/1789000111222333?fields=id,permalink,caption'
      )
      expect(new Headers(calledInit?.headers).get('authorization')).toBe(
        'Bearer EAAB_test_access_token_secret_12345'
      )
      expect(new Headers(calledInit?.headers).get('cache-control')).toBe('no-store')
    })

    it('returns isLive: false when post is not found (404) or does not exist (400)', async () => {
      const mockFetch404 = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: 'Unsupported get request. Object with ID does not exist.',
              type: 'IGApiException',
              code: 100,
            },
          },
          404,
          { 'x-fb-trace-id': 'trace_not_found' }
        )
      )

      const result = await getPostReadback('non_existent_post_id', 'EAAB_test_access_token_secret_12345', {
        fetcher: mockFetch404,
      })

      expect(result.isLive).toBe(false)
      expect(result.postId).toBe('non_existent_post_id')
      expect(result.error).toContain('Meta Graph GET failed')
      expect(result.readbackRequestId).toBeDefined()
    })

    it('returns isLive: false when container status indicates ERROR or EXPIRED', async () => {
      const mockFetchError = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'container_err_1',
            permalink: 'https://www.instagram.com/p/sample/',
            status_code: 'ERROR',
          },
          200
        )
      )

      const result = await getPostReadback('container_err_1', 'EAAB_test_access_token_secret_12345', {
        fetcher: mockFetchError,
      })

      expect(result.isLive).toBe(false)
      expect(result.statusCode).toBe('ERROR')
      expect(result.error).toContain('Meta container status indicates failure')
    })

    it('throws MetaProviderError TEMPORARY_NETWORK on 5xx or socket timeout', async () => {
      const mockFetch500 = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse({ error: 'Server unavailable' }, 503)
      )

      await expect(
        getPostReadback('post_server_err', 'EAAB_test_access_token_secret_12345', {
          fetcher: mockFetch500,
        })
      ).rejects.toThrow(MetaProviderError)
    })

    it('supports Threads Graph API endpoint', async () => {
      const mockFetchThreads = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'th_item_9999',
            permalink: 'https://www.threads.net/post/th_item_9999',
            text: '스레드 본문 독립 검증',
            status: 'FINISHED',
          },
          200
        )
      )

      const result = await getPostReadback('th_item_9999', 'EAAB_test_access_token_secret_12345', {
        fetcher: mockFetchThreads,
        channel: 'threads',
      })

      expect(result.isLive).toBe(true)
      expect(result.postId).toBe('th_item_9999')
      expect(result.permalink).toBe('https://www.threads.net/post/th_item_9999')
      expect(result.caption).toBe('스레드 본문 독립 검증')
      expect(mockFetchThreads.mock.calls[0][0]).toBe(
        'https://graph.threads.net/v1.0/th_item_9999?fields=id,permalink,text'
      )
    })
  })

  describe('2. PublishingExecutor Independent Readback Integration (Fail-Closed)', () => {
    it('achieves EXTERNAL_VERIFIED only through true GET readback and records distinct receipts', async () => {
      // 1. Write returns preliminary write receipt
      mockIgPublish.mockImplementation(async (input: any) => {
        if (input.onContainerCreated) {
          await input.onContainerCreated('cont_write_receipt_123')
        }
        return {
          providerPostId: 'ig_live_post_888',
          destinationUrl: 'https://www.instagram.com/p/ig_live_post_888/',
        }
      })

      // 2. Readback fetcher returns verified authoritative details
      const mockReadbackFetch = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'ig_live_post_888',
            permalink: 'https://www.instagram.com/p/AUTHORITATIVE_888/',
            caption: '정품 에셋과 정본 텍스트',
            status_code: 'PUBLISHED',
          },
          200,
          { 'x-fb-trace-id': 'fb_trace_readback_receipt_777' }
        )
      )
      setInstagramReadbackFetcher(mockReadbackFetch)

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        caption: '정품 에셋과 정본 텍스트',
        imageUrl: 'https://cdn.sohee.app/workspaces/ws_publish/approved.jpg',
      })

      // Assert external verified status
      expect(res.success).toBe(true)
      expect(res.verified).toBe(true)
      expect(res.stage).toBe('EXTERNAL_VERIFIED')
      expect(res.publishedUrl).toBe('https://www.instagram.com/p/AUTHORITATIVE_888/')
      expect(res.externalPostId).toBe('ig_live_post_888')

      // Assert distinct receipt IDs
      expect(res.providerRequestId).toBeDefined()
      expect(res.readbackRequestId).toBeDefined()
      expect(res.providerRequestId).not.toBe(res.readbackRequestId)
      expect(res.readbackRequestId).toContain('fb_trace_readback_receipt_777')

      // Assert external_action_receipts payload contains separate receipts
      expect(mockInsert).toHaveBeenCalledOnce()
      const insertedReceipt = mockInsert.mock.calls[0][0]
      const extId = insertedReceipt.provider_reference ?? insertedReceipt.external_id
      const extUrl = insertedReceipt.result_url ?? insertedReceipt.external_url
      const payload = insertedReceipt.observed_payload ?? insertedReceipt.payload
      expect(extId).toBe('ig_live_post_888')
      expect(extUrl).toBe('https://www.instagram.com/p/AUTHORITATIVE_888/')
      expect(payload.providerRequestId).toBe(res.providerRequestId)
      expect(payload.readbackRequestId).toBe(res.readbackRequestId)
      expect(payload.captionDigest).toBeDefined()
      expect(payload.observedAt).toBeDefined()

      // Assert Proof Chain cryptographic integrity and block stages
      const proofChain = ProofChainService.getEvidence(res.evidenceId!)
      expect(proofChain).toBeDefined()
      expect(proofChain!.stage).toBe('EXTERNAL_VERIFIED')

      // Blocks verification
      const blocks = proofChain!.blocks
      expect(blocks.length).toBeGreaterThanOrEqual(3)
      const acceptedBlock = blocks.find((b) => b.stage === 'PROVIDER_ACCEPTED')
      const verifiedBlock = blocks.find((b) => b.stage === 'EXTERNAL_VERIFIED')

      expect(acceptedBlock).toBeDefined()
      expect(verifiedBlock).toBeDefined()
      expect((acceptedBlock!.payload as any).providerRequestId).toBe(res.providerRequestId)
      expect((verifiedBlock!.payload as any).readbackRequestId).toBe(res.readbackRequestId)

      const integrity = ProofChainService.verifyChainIntegrity(proofChain!)
      expect(integrity.valid).toBe(true)
    })

    it('blocks EXTERNAL_VERIFIED and returns VERIFYING (READBACK_PENDING) when post is not yet live on GET', async () => {
      mockIgPublish.mockResolvedValueOnce({
        providerPostId: 'ig_pending_post_404',
        destinationUrl: 'https://www.instagram.com/p/ig_pending_post_404/',
      })

      // GET readback reports 404 / not yet visible
      const mockReadbackFetch = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: 'Unsupported get request. Object with ID does not exist.',
              code: 100,
            },
          },
          404
        )
      )
      setInstagramReadbackFetcher(mockReadbackFetch)

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        caption: '미확인 포스트',
        imageUrl: 'https://cdn.sohee.app/workspaces/ws_publish/approved.jpg',
      })

      // Fail-closed guarantee: Never mark verified
      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('VERIFYING')
      expect(res.errorCode).toBe('READBACK_PENDING')
      expect(res.externalPostId).toBe('ig_pending_post_404')
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('blocks EXTERNAL_VERIFIED and returns RESULT_UNKNOWN on network error during GET readback', async () => {
      mockIgPublish.mockResolvedValueOnce({
        providerPostId: 'ig_net_err_post_500',
        destinationUrl: 'https://www.instagram.com/p/ig_net_err_post_500/',
      })

      // GET readback encounters network failure (503)
      const mockReadbackFetch = vi.fn<MetaFetch>().mockResolvedValueOnce(
        jsonResponse({ error: 'Meta gateway timeout' }, 503)
      )
      setInstagramReadbackFetcher(mockReadbackFetch)

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        caption: '네트워크 장애 포스트',
        imageUrl: 'https://cdn.sohee.app/workspaces/ws_publish/approved.jpg',
      })

      // Fail-closed guarantee: isolates to RESULT_UNKNOWN
      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('RESULT_UNKNOWN')
      expect(res.errorCode).toBe('READBACK_FAILED')
      expect(mockInsert).not.toHaveBeenCalled()

      // Proof chain records RESULT_UNKNOWN and QUEUED for reconcile
      const chain = ProofChainService.getEvidence(res.evidenceId!)
      expect(chain).toBeDefined()
      expect(chain!.stage).toBe('RESULT_UNKNOWN')
      expect(chain!.reconcileStatus).toBe('QUEUED')
    })
  })
})
