import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  type LearningSource,
  type SourceRef,
} from './contracts'
import type { DurableJobRecord, LearningRepository, SupabaseQueryClient } from './repository'
import { runConfiguredLearningJob } from './configured-runner'
import { fetchLearningProvider } from './provider-fetch'
import type { CreditRateCatalog } from '@/features/credits/types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const creatorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const sourceRef: SourceRef = {
  workspaceId,
  sourceId: '22222222-2222-4222-8222-222222222222',
  revision: 1,
}

const mockCatalog: CreditRateCatalog = {
  catalogVersion: 1,
  rates: {
    source_analysis: {
      baseCredits: 0,
      perUnit: {
        chatTurns: 0,
        textGenerations: 0,
        imageGenerations: 0,
        sourceAnalyses: 2,
        externalActions: 0,
      },
    },
  },
}

function createTestSource(overrides: Partial<LearningSource> = {}): LearningSource {
  return {
    ...sourceRef,
    platform: 'instagram',
    canonicalUrl: 'https://instagram.com/my_store',
    canonicalIdentity: 'my_store',
    verification: 'verified',
    collection: 'queued',
    lease: {
      ...sourceRef,
      providerAccountId: 'meta-user-123',
      method: 'oauth',
      verifiedAt: new Date(Date.now() - 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      revokedAt: null,
      evidenceRevision: 1,
    },
    consent: {
      text: true,
      images: true,
      revision: 1,
    },
    deletedAt: null,
    ...overrides,
  }
}

function createMockHarness(initialJob?: Partial<DurableJobRecord>, initialSource?: LearningSource) {
  const jobs = new Map<string, DurableJobRecord>()
  let currentSource = initialSource ?? createTestSource()
  const statusUpdates: Array<{ status: string; leaseOwner?: string; checkpoint?: any }> = []
  const leasesSaved: any[] = []
  const revokedSources: any[] = []
  const rpcCalls: Array<{ fn: string; args: any }> = []

  if (initialJob && initialJob.id) {
    jobs.set(initialJob.id, {
      id: initialJob.id,
      workspaceId,
      sourceId: sourceRef.sourceId,
      sourceRevision: sourceRef.revision,
      kind: 'collect',
      idempotencyKey: 'key-1',
      status: 'queued',
      attempt: 0,
      checkpoint: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...initialJob,
    })
  }

  const repo: LearningRepository = {
    loadSource: async () => currentSource,
    listSources: async () => [currentSource],
    registerSource: async () => currentSource,
    persistDocuments: async () => {},
    persistCandidates: async () => {},
    loadCandidates: async () => [],
    updateVerificationLease: async ({ lease }) => {
      leasesSaved.push(lease)
      return { ...sourceRef, ...lease }
    },
    reviewCandidates: async () => {},
    revokeSource: async (actor, src) => {
      revokedSources.push({ actor, src })
    },
    createJob: async (input) => {
      const job: DurableJobRecord = {
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
        sourceRevision: input.sourceRevision,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        status: 'queued',
        attempt: 0,
        checkpoint: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      jobs.set(job.id, job)
      return job
    },
    getJob: async (_ws, jId) => jobs.get(jId) ?? null,
    claimJob: async (_ws, jId, workerId) => {
      const j = jobs.get(jId)
      if (!j || j.status !== 'queued') return null
      const updated: DurableJobRecord = { ...j, status: 'running', leaseOwner: workerId, attempt: (j.attempt ?? 0) + 1 }
      jobs.set(jId, updated)
      return updated
    },
    updateJobStatus: async (_ws, jId, status, details) => {
      const j = jobs.get(jId)
      if (j) {
        const updated: DurableJobRecord = {
          ...j,
          status,
          leaseOwner: details?.leaseOwner,
          checkpoint: details?.checkpoint ? { ...j.checkpoint, ...details.checkpoint } : j.checkpoint,
        }
        jobs.set(jId, updated)
        statusUpdates.push({ status, leaseOwner: details?.leaseOwner, checkpoint: details?.checkpoint })
      }
    },
    markSourceDeleted: async () => ({ deletionJobId: 'del-1', status: 'pending' }),
    queryApprovedContext: async () => ({ items: [], epoch: 1, dependencies: [] }),
    validateResult: async () => true,
  }

  const mockAdmin: SupabaseQueryClient = {
    from: vi.fn((table: string) => {
      if (table === 'knowledge_sources') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue({ data: [{ id: sourceRef.sourceId }], error: null }),
                })),
              })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { created_by_user_id: creatorUserId },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }
      return {
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      }
    }),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'record_learning_provider_receipt') {
        return Promise.resolve({ data: 'receipt-1234', error: null })
      }
      if (fn === 'reserve_workspace_credits') {
        return Promise.resolve({ data: { state: 'reserved', reservationId: args.p_reservation_id }, error: null })
      }
      if (fn === 'settle_credit_reservation') {
        return Promise.resolve({ data: { state: 'settled', reservationId: args.p_reservation_id }, error: null })
      }
      if (fn === 'purge_expired_learning_payloads') {
        return Promise.resolve({ data: { purged_count: 5, failed_count: 0 }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }),
  }

  return {
    repo,
    jobs,
    mockAdmin,
    statusUpdates,
    leasesSaved,
    revokedSources,
    rpcCalls,
    setCurrentSource: (s: LearningSource) => {
      currentSource = s
    },
  }
}

describe('runConfiguredLearningJob', () => {
  it('rejects envelope with missing or mismatched properties', async () => {
    const harness = createMockHarness()
    await expect(
      runConfiguredLearningJob(
        { schemaVersion: 2, kind: 'knowledge_collect', workspaceId: '', jobId: '123' },
        {},
        { repository: harness.repo, adminClient: harness.mockAdmin },
      ),
    ).rejects.toThrow()
  })

  it('returns terminal state immediately without provider calls if job is already completed', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'completed' })
    const providerFetch = vi.fn()

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '1' },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        fetchLearningProvider: providerFetch,
      },
    )

    expect(result).toEqual({ state: 'completed' })
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('blocks collection when SOHEE_CHANNEL_LEARNING_ENABLED is not 1', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '0' },
      { repository: harness.repo, adminClient: harness.mockAdmin },
    )

    expect(result.state).toBe('blocked')
    expect(result.details?.reason).toBe('CAPABILITY_BLOCKED')
  })

  it('blocks collection when rate catalog is not configured', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '1' }, // rate catalog missing
      { repository: harness.repo, adminClient: harness.mockAdmin },
    )

    expect(result.state).toBe('blocked')
    expect(result.details?.reason).toBe('FINOPS_RATE_NOT_CONFIGURED')
  })

  it('blocks collection when GEMINI_API_KEY is missing', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      {
        SOHEE_CHANNEL_LEARNING_ENABLED: '1',
        SOHEE_SOURCE_ANALYSIS_RATE_CATALOG: JSON.stringify(mockCatalog),
      },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        rateCatalog: mockCatalog,
      },
    )

    expect(result.state).toBe('blocked')
    expect(result.details?.reason).toBe('AI_PIPELINE_BLOCKED')
  })

  it('blocks collection when platform is not Instagram or Threads', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness(
      { id: jobId, status: 'queued', kind: 'collect' },
      createTestSource({ platform: 'naver_blog' }),
    )

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      {
        SOHEE_CHANNEL_LEARNING_ENABLED: '1',
        SOHEE_SOURCE_ANALYSIS_RATE_CATALOG: JSON.stringify(mockCatalog),
        GEMINI_API_KEY: 'test-key',
      },
      { repository: harness.repo, adminClient: harness.mockAdmin },
    )

    expect(result.state).toBe('blocked')
  })

  it('fails closed when fresh /me verification detects token/subject mismatch before collection', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      {
        SOHEE_CHANNEL_LEARNING_ENABLED: '1',
        SOHEE_SOURCE_ANALYSIS_RATE_CATALOG: JSON.stringify(mockCatalog),
        GEMINI_API_KEY: 'test-key',
      },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => ({
          accessToken: 'valid-token',
          scopes: ['instagram_basic'],
          providerAccountId: 'meta-user-123',
        }),
        fetchProviderMe: async () => ({
          id: 'impostor-account-999', // mismatch!
          username: 'my_store',
        }),
      },
    )

    expect(result.state).toBe('failed')
  })

  it('successfully collects Instagram media, records receipts, bills, and completes with scoped worker lease', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const providerFetch = vi.fn().mockImplementation(async (req: any) => {
      if (req.path === '/me/media') {
        return {
          data: [
            {
              id: 'post-1',
              author_id: 'meta-user-123',
              caption: '아메리카노 4500원 매일 09시부터 21시까지 영업합니다.',
              timestamp: '2026-11-09T10:00:00Z',
              media_type: 'IMAGE',
              media_url: 'https://cdn.instagram.com/p1.jpg',
            },
          ],
          paging: {},
        }
      }
      return { data: [] }
    })

    const aiExtractor = {
      extractFacts: vi.fn().mockResolvedValue([
        { category: 'price', content: '아메리카노 4,500원', excerpt: '아메리카노 4500원' },
        { category: 'hours', content: '영업시간 매일 09:00 - 21:00', excerpt: '09시부터 21시까지 영업' },
      ]),
      analyzeVision: vi.fn().mockResolvedValue([]),
    }

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      {
        SOHEE_CHANNEL_LEARNING_ENABLED: '1',
        SOHEE_SOURCE_ANALYSIS_RATE_CATALOG: JSON.stringify(mockCatalog),
        GEMINI_API_KEY: 'test-key',
      },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => ({
          accessToken: 'valid-token',
          scopes: ['instagram_basic', 'instagram_business_basic'],
          providerAccountId: 'meta-user-123',
        }),
        fetchProviderMe: async () => ({
          id: 'meta-user-123',
          username: 'my_store',
        }),
        fetchLearningProvider: providerFetch,
        aiExtractor,
      },
    )

    expect(result.state).toBe('completed')
    expect(result.details?.documentCount).toBe(1)
    expect(result.details?.candidateCount).toBe(2)

    // Check CAS lease owner was passed on status transitions
    const runningOrTerminalUpdates = harness.statusUpdates.filter((u) => u.status === 'completed')
    expect(runningOrTerminalUpdates.length).toBeGreaterThan(0)
    expect(runningOrTerminalUpdates[0].leaseOwner).toBeDefined()
  })

  it('runs knowledge_verify independently of SOHEE_CHANNEL_LEARNING_ENABLED and saves fresh lease on renewal', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'verify' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_verify', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '0' }, // Independent of collection flag!
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => ({
          accessToken: 'valid-token',
          scopes: ['instagram_basic'],
          providerAccountId: 'meta-user-123',
          expiresAt: '2026-11-20T00:00:00Z',
        }),
        fetchProviderMe: async () => ({
          id: 'meta-user-123',
          username: 'my_store',
        }),
      },
    )

    expect(result.state).toBe('completed')
    expect(harness.leasesSaved.length).toBe(1)
    expect(harness.leasesSaved[0].providerAccountId).toBe('meta-user-123')
  })

  it('revokes source with creator as actor when knowledge_verify encounters explicit token/identity loss', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'verify' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_verify', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '1' },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => null, // Token removed!
      },
    )

    expect(result.state).toBe('revoked')
    expect(harness.revokedSources.length).toBe(1)
    expect(harness.revokedSources[0].actor.userId).toBe(creatorUserId)
  })

  it('runs knowledge_delete independently and purges payloads', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'delete' })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_delete', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '0' },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        retentionDeps: {
          deleteSourceArtifacts: vi.fn().mockResolvedValue({
            purgedDocuments: 3,
            purgedMedia: 0,
            purgedCandidates: 4,
          }),
        },
      },
    )

    expect(result.state).toBe('completed')
  })

  it('F3: runs knowledge_delete with transient failure reverting to queued and completing on second execution', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'delete', attempt: 0 })

    let attempts = 0
    const retentionDeps = {
      deleteSourceArtifacts: vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts === 1) {
          throw new Error('Transient network timeout during delete purge')
        }
        return {
          purgedDocuments: 3,
          purgedMedia: 0,
          purgedCandidates: 4,
        }
      }),
    }

    // 1st run: fails with transient error -> returns to queued
    const firstResult = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_delete', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '0' },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        retentionDeps,
      },
    )

    expect(firstResult.state).toBe('retry')
    expect(harness.jobs.get(jobId)?.status).toBe('queued')

    // 2nd run: claimed again -> succeeds and completes
    const secondResult = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_delete', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '0' },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        retentionDeps,
      },
    )

    expect(secondResult.state).toBe('completed')
    expect(harness.jobs.get(jobId)?.status).toBe('completed')
    expect(attempts).toBe(2)
  })

  it('preflight blocked failure does not pass leaseOwner on unclaimed queued job', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '0' }, // preflight blocked!
      { repository: harness.repo, adminClient: harness.mockAdmin },
    )

    // Ensure leaseOwner was undefined for preflight transition on queued job
    const failedUpdate = harness.statusUpdates.find((u) => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate?.leaseOwner).toBeUndefined()
  })

  it('handles transient provider errors in verifyFreshSubject by keeping job queued for retry (via real fetchLearningProvider with HTTP 429)', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const mockFetch429 = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ error: { message: 'rate limit' } })),
    })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      {
        SOHEE_CHANNEL_LEARNING_ENABLED: '1',
        SOHEE_SOURCE_ANALYSIS_RATE_CATALOG: JSON.stringify(mockCatalog),
        GEMINI_API_KEY: 'test-key',
      },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => ({
          accessToken: 'valid-token',
          scopes: ['instagram_basic'],
          providerAccountId: 'meta-user-123',
        }),
        fetchLearningProvider: (input) =>
          fetchLearningProvider(input, { fetch: mockFetch429, sleep: vi.fn() }),
      },
    )

    expect(result.state).toBe('retry')
    expect(harness.revokedSources.length).toBe(0) // Not revoked!
  })

  it('immediately revokes source when verifyFreshSubject encounters auth lost (via real fetchLearningProvider with HTTP 401)', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'collect' })

    const mockFetch401 = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ error: { message: 'invalid_token' } })),
    })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_collect', workspaceId, jobId },
      {
        SOHEE_CHANNEL_LEARNING_ENABLED: '1',
        SOHEE_SOURCE_ANALYSIS_RATE_CATALOG: JSON.stringify(mockCatalog),
        GEMINI_API_KEY: 'test-key',
      },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => ({
          accessToken: 'revoked-token',
          scopes: ['instagram_basic'],
          providerAccountId: 'meta-user-123',
        }),
        fetchLearningProvider: (input) =>
          fetchLearningProvider(input, { fetch: mockFetch401, sleep: vi.fn() }),
      },
    )

    expect(result.state).toBe('failed')
    expect(harness.revokedSources.length).toBe(1)
    expect(harness.revokedSources[0].actor.userId).toBe(creatorUserId)
  })

  it('revokes source during renewal when real fetchLearningProvider returns HTTP 401 response', async () => {
    const jobId = crypto.randomUUID()
    const harness = createMockHarness({ id: jobId, status: 'queued', kind: 'verify' })

    const mockFetch401 = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ error: { message: 'token_expired' } })),
    })

    const result = await runConfiguredLearningJob(
      { schemaVersion: 2, kind: 'knowledge_verify', workspaceId, jobId },
      { SOHEE_CHANNEL_LEARNING_ENABLED: '1' },
      {
        repository: harness.repo,
        adminClient: harness.mockAdmin,
        getCredential: async () => ({
          accessToken: 'expired-token',
          scopes: ['instagram_basic'],
          providerAccountId: 'meta-user-123',
        }),
        fetchLearningProvider: (input) =>
          fetchLearningProvider(input, { fetch: mockFetch401, sleep: vi.fn() }),
      },
    )

    expect(result.state).toBe('revoked')
    expect(harness.revokedSources.length).toBe(1)
    expect(harness.revokedSources[0].actor.userId).toBe(creatorUserId)
  })
})

