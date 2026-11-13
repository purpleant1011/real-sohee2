import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LearningError,
  type LearningCandidate,
  type LearningDocument,
  type LearningSource,
  type SourceRef,
} from './contracts'
import {
  createProductionLearningRunner,
  type LearningQueueEnvelope,
  type ProductionLearningRunnerOptions,
} from './runtime-runner'
import type { DurableJobRecord, LearningRepository } from './repository'

const workspaceId = '11111111-1111-1111-1111-111111111111'
const sourceRef: SourceRef = {
  workspaceId,
  sourceId: '22222222-2222-2222-2222-222222222222',
  revision: 1,
}

const activeSource: LearningSource = {
  ...sourceRef,
  platform: 'instagram',
  canonicalUrl: 'https://instagram.com/shop',
  canonicalIdentity: 'shop',
  verification: 'verified',
  collection: 'queued',
  lease: {
    ...sourceRef,
    providerAccountId: 'act-1',
    method: 'oauth',
    verifiedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-20T00:00:00.000Z',
    revokedAt: null,
    evidenceRevision: 1,
  },
  consent: {
    text: true,
    images: true,
    revision: 1,
  },
  deletedAt: null,
}

function createMockRepository(initialJob?: Partial<DurableJobRecord>): {
  repo: LearningRepository
  jobs: Map<string, DurableJobRecord>
  savedDocs: LearningDocument[]
  savedCandidates: LearningCandidate[]
  setCurrentSource: (s: LearningSource) => void
} {
  const jobs = new Map<string, DurableJobRecord>()
  const savedDocs: LearningDocument[] = []
  const savedCandidates: LearningCandidate[] = []
  let currentSource: LearningSource = activeSource

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
    persistDocuments: async (_ws, _src, docs) => {
      savedDocs.push(...docs)
    },
    persistCandidates: async (_ws, _src, candidates) => {
      savedCandidates.push(...candidates)
    },
    loadCandidates: async () => savedCandidates,
    updateVerificationLease: async ({ lease }) => ({
      ...sourceRef,
      ...lease,
    }),
    reviewCandidates: async () => {},
    revokeSource: async () => {},
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
    getJob: async (_ws, id) => jobs.get(id) ?? null,
    claimJob: async (_ws, id, workerId) => {
      const job = jobs.get(id)
      if (!job || job.status !== 'queued') return null
      const claimed: DurableJobRecord = { ...job, status: 'running', attempt: job.attempt + 1, leaseOwner: workerId }
      jobs.set(id, claimed)
      return claimed
    },
    updateJobStatus: async (_ws, id, status, details) => {
      const existing = jobs.get(id)
      if (existing) {
        jobs.set(id, {
          ...existing,
          status,
          checkpoint: { ...existing.checkpoint, ...details?.checkpoint },
          attempt: status === 'running' ? existing.attempt + 1 : existing.attempt,
          updatedAt: new Date().toISOString(),
        })
      }
    },
    markSourceDeleted: async () => ({ deletionJobId: 'del-job', status: 'pending' }),
    queryApprovedContext: async () => ({ items: [], epoch: 1, dependencies: [] }),
    validateResult: async () => true,
  }

  return {
    repo,
    jobs,
    savedDocs,
    savedCandidates,
    setCurrentSource: (s: LearningSource) => {
      currentSource = s
    },
  }
}

describe('runtime runner integration', () => {
  it('executes knowledge_collect successfully through collection, analysis, persistence and updates source collection status', async () => {
    const { repo, jobs, savedDocs, savedCandidates } = createMockRepository({
      id: 'job-1',
      kind: 'collect',
      status: 'queued',
    })

    const sourceStatuses: string[] = []
    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => {
        const j = jobs.get(jobId)
        if (!j || j.status !== 'queued') return null
        const claimed: DurableJobRecord = { ...j, status: 'running', attempt: j.attempt + 1 }
        jobs.set(jobId, claimed)
        return claimed
      },
      updateSourceCollectionStatus: async (_ws, _srcId, status) => {
        sourceStatuses.push(status)
      },
      getCredential: async () => ({
        accessToken: 'valid-meta-token',
        scopes: ['instagram_basic'],
        providerAccountId: 'act-1',
      }),
      providerFetch: async () => ({
        data: [
          {
            id: 'post-100',
            author_id: 'act-1',
            caption: '핸드드립 전문점 5000원',
            timestamp: '2026-11-05T00:00:00.000Z',
          },
        ],
      }),
      billingGateway: {
        quote: async () => ({ allowed: true, quoteId: 'q-1' }),
        reserve: async () => ({ reservationId: 'res-1' }),
        settle: async () => {},
        release: async () => {},
      },
      aiExtractor: {
        extractFacts: async () => [
          {
            category: 'price',
            content: '핸드드립 전문점 5000원',
            excerpt: '핸드드립 전문점 5000원',
            evidenceState: 'observed',
          },
        ],
      },
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_collect',
      workspaceId,
      jobId: 'job-1',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('completed')
    expect(jobs.get('job-1')?.status).toBe('completed')
    expect(savedDocs).toHaveLength(1)
    expect(savedCandidates).toHaveLength(1)
    expect(savedCandidates[0].content).toBe('핸드드립 전문점 5000원')
    // Source collection status progressed from collecting to review_required
    expect(sourceStatuses).toEqual(['collecting', 'review_required'])
  })

  it('blocks job execution when claimJobCAS is unavailable or fails CAS condition', async () => {
    const { repo } = createMockRepository({
      id: 'job-nocas',
      kind: 'collect',
      status: 'queued',
    })

    // No claimJobCAS provided -> must return blocked, no fake claim!
    const runner = createProductionLearningRunner(null, { repository: repo })
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_collect',
      workspaceId,
      jobId: 'job-nocas',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('blocked')
    expect(result.details?.reason).toBe('JOB_CLAIM_CAS_RPC_REQUIRED')
  })

  it('rejects envelope when workspaceId or kind does not match job record', async () => {
    const { repo } = createMockRepository({
      id: 'job-mismatch',
      kind: 'collect',
      status: 'queued',
      workspaceId: 'other-ws-999',
    })

    const runner = createProductionLearningRunner(null, { repository: repo })

    // Tenant mismatch
    await expect(
      runner({ schemaVersion: 2, kind: 'knowledge_collect', workspaceId: 'my-ws', jobId: 'job-mismatch' }),
    ).rejects.toThrow(LearningError)

    // Kind mismatch (collect job called with verify envelope)
    await expect(
      runner({ schemaVersion: 2, kind: 'knowledge_verify', workspaceId: 'other-ws-999', jobId: 'job-mismatch' }),
    ).rejects.toThrow(LearningError)
  })

  it('refuses to coerce non-Meta platform to instagram and marks job blocked', async () => {
    const { repo, jobs, setCurrentSource } = createMockRepository({
      id: 'job-naver',
      kind: 'collect',
      status: 'queued',
    })

    setCurrentSource({
      ...activeSource,
      platform: 'naver_blog', // non-Meta platform!
    })

    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => jobs.get(jobId) ?? null,
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_collect',
      workspaceId,
      jobId: 'job-naver',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('blocked')
    expect(result.details?.reason).toContain('PLATFORM_OFFICIAL_API_UNSUPPORTED_naver_blog')
    expect(jobs.get('job-naver')?.status).toBe('failed')
  })

  it('marks job blocked when credentials or billing are missing without fake fallback', async () => {
    const { repo, jobs } = createMockRepository({
      id: 'job-nobilling',
      kind: 'collect',
      status: 'queued',
    })

    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => jobs.get(jobId) ?? null,
      getCredential: async () => null, // missing credential!
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_collect',
      workspaceId,
      jobId: 'job-nobilling',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('blocked')
    expect(jobs.get('job-nobilling')?.status).toBe('failed')
  })

  it('cancels job when source revision changed between claim and collection', async () => {
    const { repo, jobs, setCurrentSource } = createMockRepository({
      id: 'job-stale',
      kind: 'collect',
      status: 'queued',
      sourceRevision: 1,
    })

    // Source in repository already bumped to revision 2!
    setCurrentSource({
      ...activeSource,
      revision: 2,
    })

    const runner = createProductionLearningRunner(null, {
      repository: repo,
      claimJobCAS: async ({ jobId }) => jobs.get(jobId) ?? null,
    })
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_collect',
      workspaceId,
      jobId: 'job-stale',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('cancelled')
    expect(jobs.get('job-stale')?.status).toBe('cancelled')
  })

  it('executes knowledge_verify renewal when lease is due for renewal', async () => {
    const { repo, jobs } = createMockRepository({
      id: 'job-verify-1',
      kind: 'verify',
      status: 'queued',
    })

    let renewed = false
    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => jobs.get(jobId) ?? null,
      verificationRenewal: async () => {
        renewed = true
        return { state: 'renewed' }
      },
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_verify',
      workspaceId,
      jobId: 'job-verify-1',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('completed')
    expect(renewed).toBe(true)
    expect(jobs.get('job-verify-1')?.status).toBe('completed')
  })

  it('blocks knowledge_verify if no renewal adapter is provided (refuses fake completed)', async () => {
    const { repo, jobs } = createMockRepository({
      id: 'job-verify-noadapter',
      kind: 'verify',
      status: 'queued',
    })

    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => jobs.get(jobId) ?? null,
      // verificationRenewal is intentionally undefined!
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_verify',
      workspaceId,
      jobId: 'job-verify-noadapter',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('blocked')
    expect(result.details?.reason).toBe('VERIFICATION_RENEWAL_ADAPTER_REQUIRED')
  })

  it('executes knowledge_delete by purging documents and artifacts', async () => {
    const { repo, jobs } = createMockRepository({
      id: 'job-del-1',
      kind: 'delete',
      status: 'queued',
    })

    let deleteArtifactsCalled = false
    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => jobs.get(jobId) ?? null,
      retentionDeps: {
        deleteSourceArtifacts: async () => {
          deleteArtifactsCalled = true
          return { purgedDocuments: 10, purgedMedia: 2, purgedCandidates: 5 }
        },
      },
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_delete',
      workspaceId,
      jobId: 'job-del-1',
    }

    const result = await runner(envelope)
    expect(result.state).toBe('completed')
    expect(deleteArtifactsCalled).toBe(true)
    expect(jobs.get('job-del-1')?.status).toBe('completed')
  })

  it('F3: transient delete error reverts to queued via CAS, and succeeds on retry', async () => {
    let currentAttempt = 0
    const { repo, jobs } = createMockRepository({
      id: 'job-del-retry',
      kind: 'delete',
      status: 'queued',
      attempt: 0,
    })

    let deleteAttempts = 0
    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => {
        const j = jobs.get(jobId)
        if (!j || j.status !== 'queued') return null
        currentAttempt++
        const claimed = { ...j, status: 'running' as const, attempt: currentAttempt }
        jobs.set(jobId, claimed)
        return claimed
      },
      retentionDeps: {
        deleteSourceArtifacts: async () => {
          deleteAttempts++
          if (deleteAttempts === 1) {
            throw new Error('RPC transient network timeout')
          }
          return { purgedDocuments: 10, purgedMedia: 0, purgedCandidates: 5 }
        },
      },
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_delete',
      workspaceId,
      jobId: 'job-del-retry',
    }

    // 1st execution: transient throw -> reverts to queued with retry state
    const firstResult = await runner(envelope)
    expect(firstResult.state).toBe('retry')
    expect(firstResult.details.attempt).toBe(1)
    expect(jobs.get('job-del-retry')?.status).toBe('queued')

    // 2nd execution: re-claimed -> succeeds and transitions to completed
    const secondResult = await runner(envelope)
    expect(secondResult.state).toBe('completed')
    expect(jobs.get('job-del-retry')?.status).toBe('completed')
    expect(deleteAttempts).toBe(2)
  })

  it('F3: reaching max attempt (5) transitions delete job to operator-visible failed', async () => {
    const { repo, jobs } = createMockRepository({
      id: 'job-del-max-fail',
      kind: 'delete',
      status: 'queued',
      attempt: 5,
    })

    const options: ProductionLearningRunnerOptions = {
      repository: repo,
      claimJobCAS: async ({ jobId }) => {
        const j = jobs.get(jobId)
        if (!j) return null
        const claimed = { ...j, status: 'running' as const, attempt: 5 }
        jobs.set(jobId, claimed)
        return claimed
      },
      retentionDeps: {
        deleteSourceArtifacts: async () => {
          throw new Error('Permanent database corruption')
        },
      },
    }

    const runner = createProductionLearningRunner(null, options)
    const envelope: LearningQueueEnvelope = {
      schemaVersion: 2,
      kind: 'knowledge_delete',
      workspaceId,
      jobId: 'job-del-max-fail',
    }

    await expect(runner(envelope)).rejects.toThrow('Permanent database corruption')
    expect(jobs.get('job-del-max-fail')?.status).toBe('failed')
  })

  it('rejects envelope with invalid kind or missing parameters', async () => {
    const { repo } = createMockRepository()
    const runner = createProductionLearningRunner(null, { repository: repo })

    await expect(
      runner({ kind: 'invalid_kind' as any, workspaceId, jobId: 'job-1' }),
    ).rejects.toThrow(LearningError)
  })
})
