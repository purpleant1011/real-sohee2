import { describe, expect, it, vi } from 'vitest'
import { LearningError } from './contracts'
import { createLearningRepository } from './repository'
import {
  createInMemoryLearningRepository,
  TENANT_A_SOURCE_ID,
  TENANT_A_USER_ID,
  TENANT_A_WORKSPACE_ID,
  TENANT_B_WORKSPACE_ID,
  tenantACandidate,
  tenantADocument,
} from './test-fixtures'

// Any query-builder method chain resolves to `result` (select/eq/in/is/gt/order/limit/maybeSingle...).
const queryChain = (result: unknown): any =>
  new Proxy(function noop() {}, {
    get: (_target, prop) => (prop === 'then' ? (resolve: (value: unknown) => void) => resolve(result) : () => queryChain(result)),
  })

const sourceRow = (overrides: Record<string, unknown> = {}) => ({
  id: TENANT_A_SOURCE_ID,
  workspace_id: TENANT_A_WORKSPACE_ID,
  lifecycle_revision: 1,
  channel_type: 'instagram',
  uri: 'https://instagram.com/biz',
  display_name: 'biz',
  status: 'registered',
  learning_verification_status: 'verified',
  learning_collection_status: 'review_required',
  evidence_revision: 3,
  consent_text: true,
  consent_images: false,
  consent_revision: 1,
  deleted_at: null,
  created_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})
const leaseRow = (overrides: Record<string, unknown> = {}) => ({
  workspace_id: TENANT_A_WORKSPACE_ID,
  knowledge_source_id: TENANT_A_SOURCE_ID,
  evidence_revision: 3,
  provider_account_id: 'act_prev',
  method: 'oauth',
  verified_at: '2020-01-01T00:00:00.000Z',
  expires_at: '2020-01-02T00:00:00.000Z',
  revoked_at: null,
  ...overrides,
})

describe('repository - production client adapter', () => {
  it('loadSource/listSources keep the latest (even expired) lease metadata and derive verification=expired so re-verification can use evidenceRevision+1', async () => {
    const make = (table: string, lease: unknown, source: unknown) =>
      table === 'knowledge_sources' ? queryChain({ data: source, error: null }) : queryChain({ data: lease, error: null })

    const loadRepo = createLearningRepository({
      from: vi.fn((table: string) => make(table, leaseRow(), sourceRow())),
      rpc: vi.fn(),
    })
    const loaded = await loadRepo.loadSource(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID)
    expect(loaded?.verification).toBe('expired')
    expect(loaded?.lease).toMatchObject({ evidenceRevision: 3, providerAccountId: 'act_prev', expiresAt: '2020-01-02T00:00:00.000Z' })

    const listRepo = createLearningRepository({
      from: vi.fn((table: string) => make(table, [leaseRow()], [sourceRow()])),
      rpc: vi.fn(),
    })
    const [listed] = await listRepo.listSources(TENANT_A_WORKSPACE_ID)
    expect(listed?.verification).toBe('expired')
    expect(listed?.lease?.evidenceRevision).toBe(3)

    // A still-valid lease stays verified; a revoked lease derives revoked; a verified source with no lease is not trusted.
    const fresh = createLearningRepository({
      from: vi.fn((table: string) => make(table, leaseRow({ expires_at: '2999-01-01T00:00:00.000Z' }), sourceRow())),
      rpc: vi.fn(),
    })
    expect((await fresh.loadSource(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID))?.verification).toBe('verified')
    const revoked = createLearningRepository({
      from: vi.fn((table: string) => make(table, leaseRow({ expires_at: '2999-01-01T00:00:00.000Z', revoked_at: '2026-11-10T00:00:00.000Z' }), sourceRow())),
      rpc: vi.fn(),
    })
    expect((await revoked.loadSource(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID))?.verification).toBe('revoked')
    const noLease = createLearningRepository({
      from: vi.fn((table: string) => make(table, null, sourceRow())),
      rpc: vi.fn(),
    })
    const unproven = await noLease.loadSource(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID)
    expect(unproven?.verification).toBe('expired')
    expect(unproven?.lease).toBeNull()
  })

  it('throws when created without a valid Supabase client', () => {
    expect(() => createLearningRepository(undefined as any)).toThrow(
      'Valid Supabase client is required',
    )
    expect(() => createLearningRepository({} as any)).toThrow(
      'Valid Supabase client is required',
    )
  })

  it('loadSource performs active lease lookup and handles fail-closed error', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'knowledge_sources') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: TENANT_A_SOURCE_ID,
                        workspace_id: TENANT_A_WORKSPACE_ID,
                        lifecycle_revision: 2,
                        channel_type: 'instagram',
                        uri: 'https://instagram.com/biz',
                        display_name: 'biz',
                        status: 'registered',
                        learning_verification_status: 'verified',
                        learning_collection_status: 'review_required',
                        evidence_revision: 2,
                        consent_text: true,
                        consent_images: false,
                        consent_revision: 1,
                        deleted_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'learning_evidence_leases') {
        return queryChain({
          data: {
            workspace_id: TENANT_A_WORKSPACE_ID,
            knowledge_source_id: TENANT_A_SOURCE_ID,
            evidence_revision: 2,
            provider_account_id: 'act_123',
            method: 'oauth',
            verified_at: '2026-11-10T10:00:00.000Z',
            expires_at: '2999-11-11T10:00:00.000Z',
            revoked_at: null,
          },
          error: null,
        })
      }
      return {}
    })

    const repo = createLearningRepository({ from: mockFrom, rpc: vi.fn() })
    const source = await repo.loadSource(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID)

    expect(source).not.toBeNull()
    expect(source?.revision).toBe(2)
    expect(source?.verification).toBe('verified')
    expect(source?.lease?.evidenceRevision).toBe(2)
    expect(source?.lease?.providerAccountId).toBe('act_123')

    // Error test: database failure throws LearningError (never swallows)
    const failingFrom = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({ data: null, error: { message: 'db connection failed' } }),
              }),
            }),
          }),
        }),
      }),
    }))
    const failingRepo = createLearningRepository({ from: failingFrom, rpc: vi.fn() })
    await expect(failingRepo.loadSource(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID)).rejects.toThrow(
      LearningError,
    )
  })

  it('registerSource stores connection_required and is_learning_source to satisfy legacy check constraints and prevent worker bypass', async () => {
    let insertedPayload: any = null
    const mockFrom = vi.fn(() => ({
      insert: (payload: any) => {
        insertedPayload = payload
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: TENANT_A_SOURCE_ID,
                workspace_id: TENANT_A_WORKSPACE_ID,
                lifecycle_revision: 1,
                channel_type: 'instagram',
                uri: 'https://instagram.com/biz',
                display_name: 'biz',
                status: 'registered',
                is_learning_source: true,
                learning_verification_status: 'pending',
                learning_collection_status: 'queued',
                consent_text: true,
                consent_images: false,
                consent_revision: 1,
              },
              error: null,
            }),
          }),
        }
      },
    }))

    const repo = createLearningRepository({ from: mockFrom, rpc: vi.fn() })
    const result = await repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://instagram.com/biz',
      canonicalIdentity: 'biz',
      consent: { text: true, images: false },
    })

    expect(result.verification).toBe('pending')
    expect(result.collection).toBe('queued')
    expect(insertedPayload.is_learning_source).toBe(true)
    expect(insertedPayload.refresh_policy.collectionState).toBe('connection_required')
    expect(insertedPayload.learning_verification_status).toBe('pending')
    expect(insertedPayload.learning_collection_status).toBe('queued')
  })

  it('persistCandidates and persistDocuments delegate to atomic RPCs preventing TOCTOU', async () => {
    const mockRpc = vi.fn(async () => ({ error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc: mockRpc })

    await repo.persistDocuments(
      TENANT_A_WORKSPACE_ID,
      { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 },
      [tenantADocument],
    )
    expect(mockRpc).toHaveBeenCalledWith('persist_learning_documents_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID,
      p_source_id: TENANT_A_SOURCE_ID,
      p_expected_revision: 1,
      p_documents: [tenantADocument],
      p_actor_user_id: null,
    })

    await repo.persistCandidates(
      TENANT_A_WORKSPACE_ID,
      { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 },
      [tenantACandidate],
      TENANT_A_USER_ID,
    )
    expect(mockRpc).toHaveBeenCalledWith('persist_learning_candidates_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID,
      p_source_id: TENANT_A_SOURCE_ID,
      p_expected_revision: 1,
      p_candidates: [tenantACandidate],
      p_actor_user_id: TENANT_A_USER_ID,
    })
  })

  it('updateVerificationLease delegates to atomic RPC without orphan/retry issues', async () => {
    const mockRpc = vi.fn(async () => ({ error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc: mockRpc })

    await repo.updateVerificationLease({
      source: { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 },
      lease: {
        providerAccountId: 'act_123',
        method: 'oauth',
        verifiedAt: '2026-11-10T10:00:00.000Z',
        expiresAt: '2026-11-11T10:00:00.000Z',
        revokedAt: null,
        evidenceRevision: 1,
      },
    })

    expect(mockRpc).toHaveBeenCalledWith('update_learning_verification_lease_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID,
      p_source_id: TENANT_A_SOURCE_ID,
      p_expected_source_revision: 1,
      p_evidence_revision: 1,
      p_provider_account_id: 'act_123',
      p_method: 'oauth',
      p_verified_at: '2026-11-10T10:00:00.000Z',
      p_expires_at: '2026-11-11T10:00:00.000Z',
      p_actor_user_id: null,
    })
  })

  it('createJob goes through the atomic RPC and maps idempotency/stale/paused rejections to LearningError codes', async () => {
    const row = {
      id: 'job_1', workspace_id: TENANT_A_WORKSPACE_ID, knowledge_source_id: TENANT_A_SOURCE_ID, source_revision: 1,
      job_kind: 'collect', idempotency_key: 'key_1', status: 'queued', attempt: 0, checkpoint: {},
      lease_owner: null, lease_expires_at: null, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z',
    }
    const rpc = vi.fn(async () => ({ data: [row], error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc })
    const input = { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, sourceRevision: 1, kind: 'collect' as const, idempotencyKey: 'key_1' }
    const created = await repo.createJob(input)
    expect(created).toMatchObject({ id: 'job_1', status: 'queued', leaseOwner: null, kind: 'collect' })
    expect(rpc).toHaveBeenCalledWith('create_learning_job_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID, p_source_id: TENANT_A_SOURCE_ID, p_source_revision: 1,
      p_job_kind: 'collect', p_idempotency_key: 'key_1',
    })

    for (const code of ['IDEMPOTENCY_CONFLICT', 'STALE_SOURCE_REVISION', 'SOURCE_PAUSED', 'SOURCE_NOT_FOUND']) {
      const failing = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: { message: `${code}` } })) })
      await expect(failing.createJob(input)).rejects.toMatchObject({ code })
    }
    const empty = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: [], error: null })) })
    await expect(empty.createJob(input)).rejects.toThrow(LearningError)
  })

  it('claimJob claims via atomic RPC with worker id and returns null when another worker holds the lease', async () => {
    const row = {
      id: 'job_1', workspace_id: TENANT_A_WORKSPACE_ID, knowledge_source_id: TENANT_A_SOURCE_ID, source_revision: 1,
      job_kind: 'collect', idempotency_key: 'key_1', status: 'running', attempt: 1, checkpoint: {},
      lease_owner: 'worker-1', lease_expires_at: '2026-11-10T00:05:00.000Z', created_at: 'c', updated_at: 'u',
    }
    const rpc = vi.fn(async () => ({ data: [row], error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc })
    const claimed = await repo.claimJob(TENANT_A_WORKSPACE_ID, 'job_1', 'worker-1')
    expect(claimed).toMatchObject({ status: 'running', attempt: 1, leaseOwner: 'worker-1', leaseExpiresAt: '2026-11-10T00:05:00.000Z' })
    expect(rpc).toHaveBeenCalledWith('claim_learning_job_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID, p_job_id: 'job_1', p_worker_id: 'worker-1', p_lease_seconds: 300,
    })

    const lost = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: [], error: null })) })
    expect(await lost.claimJob(TENANT_A_WORKSPACE_ID, 'job_1', 'worker-2')).toBeNull()

    const broken = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) })
    await expect(broken.claimJob(TENANT_A_WORKSPACE_ID, 'job_1', 'worker-2')).rejects.toThrow(LearningError)
  })

  it('updateJobStatus sends lease owner for CAS and surfaces lease/state conflicts instead of swallowing them', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc })
    await repo.updateJobStatus(TENANT_A_WORKSPACE_ID, 'job_1', 'completed', {
      leaseOwner: 'worker-1', checkpoint: { cursor: 'c1' },
    })
    expect(rpc).toHaveBeenCalledWith('update_learning_job_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID, p_job_id: 'job_1', p_status: 'completed', p_lease_owner: 'worker-1',
      p_checkpoint: { cursor: 'c1' }, p_error_code: null, p_error_message: null,
    })

    for (const code of ['JOB_LEASE_MISMATCH', 'JOB_STATE_CONFLICT', 'JOB_LEASE_REQUIRED']) {
      const failing = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: { message: code } })) })
      await expect(failing.updateJobStatus(TENANT_A_WORKSPACE_ID, 'job_1', 'completed', { leaseOwner: 'w' })).rejects.toMatchObject({ code })
    }
  })

  it('persistDocuments/persistCandidates forward the explicit actor and surface server-side evidence rejections', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc })
    const source = { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 }
    await repo.persistDocuments(TENANT_A_WORKSPACE_ID, source, [tenantADocument], TENANT_A_USER_ID)
    expect(rpc).toHaveBeenCalledWith('persist_learning_documents_atomic', expect.objectContaining({ p_actor_user_id: TENANT_A_USER_ID }))

    for (const code of ['DOCUMENT_ID_MISMATCH', 'DOCUMENT_VERSION_CONFLICT', 'DOCUMENT_AUTHOR_MISMATCH', 'VALID_LEASE_REQUIRED', 'CONSENT_REQUIRED', 'FORBIDDEN_WORKSPACE_MEMBER']) {
      const failing = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ error: { message: code } })) })
      await expect(failing.persistDocuments(TENANT_A_WORKSPACE_ID, source, [tenantADocument])).rejects.toThrow(LearningError)
    }
    for (const code of ['CANDIDATE_SOURCE_MISMATCH', 'EVIDENCE_QUOTE_NOT_IN_DOCUMENT', 'INVALID_DOCUMENT_EVIDENCE']) {
      const failing = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ error: { message: code } })) })
      await expect(failing.persistCandidates(TENANT_A_WORKSPACE_ID, source, [tenantACandidate], TENANT_A_USER_ID)).rejects.toThrow(LearningError)
    }
  })

  it('updateVerificationLease forwards explicit actor when provided', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc })
    await repo.updateVerificationLease({
      source: { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 },
      actorUserId: TENANT_A_USER_ID,
      lease: { providerAccountId: 'a', method: 'oauth', verifiedAt: '2026-11-10T10:00:00.000Z', expiresAt: '2026-11-11T10:00:00.000Z', revokedAt: null, evidenceRevision: 1 },
    })
    expect(rpc).toHaveBeenCalledWith('update_learning_verification_lease_atomic', expect.objectContaining({ p_actor_user_id: TENANT_A_USER_ID }))
  })

  it('queryApprovedContext returns every leaf dependency of multi-leaf facts, deduped, and fails closed on bad data', async () => {
    const leafA = '20000000-0000-4000-8000-0000000000aa'
    const leafB = '20000000-0000-4000-8000-0000000000bb'
    const rows = [
      { id: 'f1', category: 'hours', content: 'c1', source_type: 'channel', source_id: leafA, source_revision: 2, epoch: 7,
        dependencies: [{ sourceId: leafA, revision: 2 }, { sourceId: leafB, revision: 3 }] },
      { id: 'f2', category: 'price', content: 'c2', source_type: 'channel', source_id: leafB, source_revision: 3, epoch: 7,
        dependencies: [{ sourceId: leafB, revision: 3 }] },
      { id: 'f3', category: 'policy', content: 'manual', source_type: 'manual', source_id: null, source_revision: null, epoch: 7, dependencies: [] },
    ]
    const mockRpc = vi.fn(async () => ({ data: rows, error: null }))
    const repo = createLearningRepository({ from: vi.fn(), rpc: mockRpc })
    const result = await repo.queryApprovedContext({ workspaceId: TENANT_A_WORKSPACE_ID, purpose: 'conversation', query: 'price search' })
    expect(mockRpc).toHaveBeenCalledWith('get_approved_learning_context', {
      p_workspace_id: TENANT_A_WORKSPACE_ID,
      p_purpose: 'conversation',
      p_max_facts: 32,
      p_query: 'price search',
    })
    expect(result.epoch).toBe(7)
    expect(result.dependencies).toEqual([
      { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: leafA, revision: 2 },
      { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: leafB, revision: 3 },
    ])

    const notArray = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: null })) })
    await expect(notArray.queryApprovedContext({ workspaceId: TENANT_A_WORKSPACE_ID, purpose: 'conversation' })).rejects.toThrow(LearningError)
    const failing = createLearningRepository({ from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: { message: 'db down' } })) })
    await expect(failing.queryApprovedContext({ workspaceId: TENANT_A_WORKSPACE_ID, purpose: 'conversation' })).rejects.toThrow(LearningError)
  })

  it('listSources and loadCandidates never turn a database failure or malformed result into an empty list', async () => {
    const chain = (result: unknown): any => new Proxy(function noop() {}, {
      get: (_target, prop) => (prop === 'then' ? (resolve: (value: unknown) => void) => resolve(result) : () => chain(result)),
    })
    const failing = createLearningRepository({ from: vi.fn(() => chain({ data: null, error: { message: 'db down' } })), rpc: vi.fn() })
    await expect(failing.listSources(TENANT_A_WORKSPACE_ID)).rejects.toThrow(LearningError)
    await expect(failing.loadCandidates(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID)).rejects.toThrow(LearningError)

    const malformed = createLearningRepository({ from: vi.fn(() => chain({ data: null, error: null })), rpc: vi.fn() })
    await expect(malformed.listSources(TENANT_A_WORKSPACE_ID)).rejects.toThrow(LearningError)

    // A legacy (non-learning) source id yields no learning source row: candidates are refused, not leaked.
    const legacy = createLearningRepository({ from: vi.fn(() => chain({ data: null, error: null })), rpc: vi.fn() })
    await expect(legacy.loadCandidates(TENANT_A_WORKSPACE_ID, TENANT_A_SOURCE_ID)).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
  })

  it('markSourceDeleted delegates to atomic single-revision delete RPC', async () => {
    const mockRpc = vi.fn(async () => ({
      data: [{ deletion_job_id: 'delete_job_123', new_revision: 2 }],
      error: null,
    }))

    const repo = createLearningRepository({ from: vi.fn(), rpc: mockRpc })
    const result = await repo.markSourceDeleted(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 },
    )

    expect(result.status).toBe('pending')
    expect(result.deletionJobId).toBe('delete_job_123')
    expect(mockRpc).toHaveBeenCalledWith('delete_learning_source_atomic', {
      p_workspace_id: TENANT_A_WORKSPACE_ID,
      p_source_id: TENANT_A_SOURCE_ID,
      p_expected_revision: 1,
      p_actor_user_id: TENANT_A_USER_ID,
      p_idempotency_key: `delete:${TENANT_A_SOURCE_ID}:2`,
    })
  })

  it('validateResult delegates to validate_learning_result RPC with purpose', async () => {
    const mockRpc = vi.fn(async () => ({
      data: true,
      error: null,
    }))

    const repo = createLearningRepository({ from: vi.fn(), rpc: mockRpc })
    const ok = await repo.validateResult({
      workspaceId: TENANT_A_WORKSPACE_ID,
      expectedEpoch: 3,
      dependencies: [{ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 }],
      purpose: 'image',
    })

    expect(ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('validate_learning_result', {
      p_workspace_id: TENANT_A_WORKSPACE_ID,
      p_expected_epoch: 3,
      p_dependencies: [{ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: TENANT_A_SOURCE_ID, revision: 1 }],
      p_purpose: 'image',
    })
  })
})

describe('repository - in-memory behavior & isolation verification', () => {
  it('registers source, persists documents and candidates, and enforces tenant isolation', async () => {
    const repo = createInMemoryLearningRepository()

    const source = await repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
      canonicalIdentity: 'tenant_a_biz',
      consent: { text: true, images: false },
    })

    expect(source.workspaceId).toBe(TENANT_A_WORKSPACE_ID)
    expect(source.verification).toBe('pending')
    expect(source.revision).toBe(1)

    // Foreign tenant cannot load tenant A's source
    const foreignLoaded = await repo.loadSource(TENANT_B_WORKSPACE_ID, source.sourceId)
    expect(foreignLoaded).toBeNull()

    // Tenant A loads own source
    const loaded = await repo.loadSource(TENANT_A_WORKSPACE_ID, source.sourceId)
    expect(loaded?.sourceId).toBe(source.sourceId)

    // Persist documents & candidates
    await repo.persistDocuments(TENANT_A_WORKSPACE_ID, source, [
      { ...tenantADocument, source },
    ])
    await repo.persistCandidates(TENANT_A_WORKSPACE_ID, source, [
      { ...tenantACandidate, source },
    ])

    const candidates = await repo.loadCandidates(TENANT_A_WORKSPACE_ID, source.sourceId)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.id).toBe(tenantACandidate.id)
  })

  it('rejects candidate review with stale source revision CAS mismatch', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
      canonicalIdentity: 'tenant_a_biz',
      consent: { text: true, images: true },
    })

    await repo.updateVerificationLease({
      source,
      lease: {
        providerAccountId: 'act_123',
        method: 'oauth',
        verifiedAt: '2026-11-10T09:00:00.000Z',
        expiresAt: '2026-11-11T09:00:00.000Z',
        revokedAt: null,
        evidenceRevision: 1,
      },
    })

    await repo.persistCandidates(TENANT_A_WORKSPACE_ID, source, [
      { ...tenantACandidate, source },
    ])

    // Revoke bumps revision from 1 to 2
    await repo.revokeSource(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      source,
    )

    // Caller attempts review with old source revision 1
    await expect(
      repo.reviewCandidates(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
        {
          source: { ...source, revision: 1 },
          evidenceRevision: 1,
          decisions: [
            { candidateId: tenantACandidate.id, version: 1, decision: 'approved' },
          ],
        },
      ),
    ).rejects.toThrow(LearningError)
  })

  it('rejects candidate review with stale candidate version CAS mismatch', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
      canonicalIdentity: 'tenant_a_biz',
      consent: { text: true, images: true },
    })

    await repo.updateVerificationLease({
      source,
      lease: {
        providerAccountId: 'act_123',
        method: 'oauth',
        verifiedAt: '2026-11-10T09:00:00.000Z',
        expiresAt: '2026-11-11T09:00:00.000Z',
        revokedAt: null,
        evidenceRevision: 1,
      },
    })

    await repo.persistCandidates(TENANT_A_WORKSPACE_ID, source, [
      { ...tenantACandidate, source, version: 2 },
    ])

    // Caller attempts review specifying version 1
    await expect(
      repo.reviewCandidates(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
        {
          source,
          evidenceRevision: 1,
          decisions: [
            { candidateId: tenantACandidate.id, version: 1, decision: 'approved' },
          ],
        },
      ),
    ).rejects.toThrow(LearningError)
  })

  it('blocks unreviewed candidate conflict approval without explicit edited content', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
      canonicalIdentity: 'tenant_a_biz',
      consent: { text: true, images: true },
    })

    await repo.updateVerificationLease({
      source,
      lease: {
        providerAccountId: 'act_123',
        method: 'oauth',
        verifiedAt: '2026-11-10T09:00:00.000Z',
        expiresAt: '2026-11-11T09:00:00.000Z',
        revokedAt: null,
        evidenceRevision: 1,
      },
    })

    // Conflict candidate with existing fact
    const conflictCandidate = {
      ...tenantACandidate,
      status: 'conflict' as const,
      conflictsWithFactId: '30000000-0000-4000-8000-000000000099',
    }
    await repo.persistCandidates(TENANT_A_WORKSPACE_ID, source, [conflictCandidate])

    // Approval without editedContent must be blocked!
    await expect(
      repo.reviewCandidates(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
        {
          source,
          evidenceRevision: 1,
          decisions: [
            { candidateId: conflictCandidate.id, version: 1, decision: 'approved' },
          ],
        },
      ),
    ).rejects.toThrow(LearningError)

    // Approval with explicit editedContent succeeds
    await repo.reviewCandidates(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      {
        source,
        evidenceRevision: 1,
        decisions: [
          {
            candidateId: conflictCandidate.id,
            version: 1,
            decision: 'approved',
            editedContent: '수정 확인된 영업시간 10:00 - 19:00',
          },
        ],
      },
    )
  })

  it('ensures manual facts survive source revocation and deletion', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
      canonicalIdentity: 'tenant_a_biz',
      consent: { text: true, images: true },
    })

    await repo.updateVerificationLease({
      source,
      lease: {
        providerAccountId: 'act_123',
        method: 'oauth',
        verifiedAt: '2026-11-10T09:00:00.000Z',
        expiresAt: '2026-11-11T09:00:00.000Z',
        revokedAt: null,
        evidenceRevision: 1,
      },
    })

    await repo.persistCandidates(TENANT_A_WORKSPACE_ID, source, [
      { ...tenantACandidate, source },
    ])

    await repo.reviewCandidates(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      {
        source,
        evidenceRevision: 1,
        decisions: [
          { candidateId: tenantACandidate.id, version: 1, decision: 'approved' },
        ],
      },
    )

    const initialContext = await repo.queryApprovedContext({
      workspaceId: TENANT_A_WORKSPACE_ID,
      purpose: 'conversation',
    })
    expect(initialContext.items.some((item) => item.sourceType === 'channel')).toBe(true)

    // Now delete the channel source
    await repo.markSourceDeleted(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      source,
    )

    // Channel-derived facts must be excluded, manual facts survive!
    const contextAfterDelete = await repo.queryApprovedContext({
      workspaceId: TENANT_A_WORKSPACE_ID,
      purpose: 'conversation',
    })
    expect(contextAfterDelete.items.filter((item) => item.sourceType === 'channel')).toHaveLength(0)
    expect(contextAfterDelete.items.some((item) => item.sourceType === 'manual')).toBe(true)
  })

  const registerSample = async (repo: ReturnType<typeof createInMemoryLearningRepository>) =>
    repo.registerSource({
      workspaceId: TENANT_A_WORKSPACE_ID,
      actorUserId: TENANT_A_USER_ID,
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
      canonicalIdentity: 'tenant_a_biz',
      consent: { text: true, images: true },
    })
  const actorA = { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID }

  it('durable job creation is idempotent and deduplicated', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await registerSample(repo)
    const spec = { workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 1, kind: 'collect' as const, idempotencyKey: 'idemp_key_123' }
    const job1 = await repo.createJob(spec)
    const job2 = await repo.createJob(spec)

    expect(job1.id).toBe(job2.id)

    // Conflicting reuse of same idempotency key for different sourceId throws
    await expect(repo.createJob({ ...spec, sourceId: TENANT_A_SOURCE_ID })).rejects.toThrow(LearningError)
  })

  it('claimJob is exclusive and result transitions are CAS on lease owner and current state', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await registerSample(repo)
    const job = await repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 1, kind: 'collect', idempotencyKey: 'k1' })

    const [first, second] = await Promise.all([
      repo.claimJob(TENANT_A_WORKSPACE_ID, job.id, 'worker-1'),
      repo.claimJob(TENANT_A_WORKSPACE_ID, job.id, 'worker-2'),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    const winner = (first ?? second)!
    expect(winner).toMatchObject({ status: 'running', attempt: 1 })

    await expect(
      repo.updateJobStatus(TENANT_A_WORKSPACE_ID, job.id, 'completed', { leaseOwner: first ? 'worker-2' : 'worker-1' }),
    ).rejects.toMatchObject({ code: 'JOB_LEASE_MISMATCH' })
    await expect(repo.updateJobStatus(TENANT_A_WORKSPACE_ID, job.id, 'completed')).rejects.toMatchObject({ code: 'JOB_LEASE_REQUIRED' })
    await repo.updateJobStatus(TENANT_A_WORKSPACE_ID, job.id, 'completed', { leaseOwner: winner.leaseOwner ?? undefined, checkpoint: { cursor: 'c1' } })
    expect((await repo.getJob(TENANT_A_WORKSPACE_ID, job.id))?.status).toBe('completed')
    await expect(
      repo.updateJobStatus(TENANT_A_WORKSPACE_ID, job.id, 'failed', { leaseOwner: winner.leaseOwner ?? undefined }),
    ).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
  })

  it('revoke and delete cancel open collect/verify jobs and block new collect/verify jobs; delete jobs stay allowed', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await registerSample(repo)
    const queued = await repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 1, kind: 'collect', idempotencyKey: 'q' })
    const running = await repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 1, kind: 'verify', idempotencyKey: 'r' })
    const claimed = await repo.claimJob(TENANT_A_WORKSPACE_ID, running.id, 'w1')
    expect(claimed?.status).toBe('running')

    await repo.revokeSource(actorA, source)

    expect((await repo.getJob(TENANT_A_WORKSPACE_ID, queued.id))?.status).toBe('cancelled')
    expect((await repo.getJob(TENANT_A_WORKSPACE_ID, running.id))?.status).toBe('cancelled')
    expect(await repo.claimJob(TENANT_A_WORKSPACE_ID, queued.id, 'w2')).toBeNull()
    await expect(
      repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 2, kind: 'collect', idempotencyKey: 'late' }),
    ).rejects.toMatchObject({ code: 'SOURCE_PAUSED' })
    await expect(
      repo.updateJobStatus(TENANT_A_WORKSPACE_ID, running.id, 'completed', { leaseOwner: 'w1' }),
    ).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
    const deleteJob = await repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 2, kind: 'delete', idempotencyKey: 'del' })
    expect(deleteJob.kind).toBe('delete')

    const other = await registerSample(repo)
    const open = await repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: other.sourceId, sourceRevision: 1, kind: 'collect', idempotencyKey: 'o' })
    await repo.markSourceDeleted(actorA, other)
    expect((await repo.getJob(TENANT_A_WORKSPACE_ID, open.id))?.status).toBe('cancelled')
    await expect(
      repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: other.sourceId, sourceRevision: 2, kind: 'collect', idempotencyKey: 'late2' }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
  })

  it('claimJob refuses and cancels a job whose source revision went stale', async () => {
    const repo = createInMemoryLearningRepository()
    const source = await registerSample(repo)
    const job = await repo.createJob({ workspaceId: TENANT_A_WORKSPACE_ID, sourceId: source.sourceId, sourceRevision: 1, kind: 'collect', idempotencyKey: 'stale' })
    await repo.revokeSource(actorA, source)
    expect(await repo.claimJob(TENANT_A_WORKSPACE_ID, job.id, 'w')).toBeNull()
  })
})
