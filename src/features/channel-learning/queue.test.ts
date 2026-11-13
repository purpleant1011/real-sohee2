import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  type LearningCandidate,
  type LearningDocument,
  type LearningSource,
  type SourceRef,
} from './contracts'
import {
  submitLearningJob,
  runLearningJob,
  type DurableJob,
  type JobRunnerDeps,
  type QueueDeps,
} from './queue'

const sourceRef: SourceRef = {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  sourceId: '22222222-2222-2222-2222-222222222222',
  revision: 1,
}

const mockSource: LearningSource = {
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

const mockDoc: LearningDocument = {
  id: crypto.randomUUID(),
  source: sourceRef,
  providerDocumentId: 'p-1',
  authorAccountId: 'act-1',
  url: 'https://instagram.com/p/1',
  publishedAt: '2026-11-05T00:00:00.000Z',
  collectedAt: '2026-11-10T12:00:00.000Z',
  text: '핸드드립 커피 5,000원',
  contentHash: 'hash-1',
  images: [],
}

describe('queue job execution and idempotency', () => {
  it('submits job idempotently, returning existing active jobId', async () => {
    let existingJob: DurableJob | null = null

    const deps: QueueDeps = {
      getActiveJobBySource: async () => existingJob,
      createJob: async (source) => {
        existingJob = {
          id: 'job-101',
          source,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        return existingJob
      },
    }

    const first = await submitLearningJob(sourceRef, deps)
    expect(first.jobId).toBe('job-101')

    const second = await submitLearningJob(sourceRef, deps)
    expect(second.jobId).toBe('job-101')
  })

  it('runs job successfully through collection and analysis, marking completed', async () => {
    let job: DurableJob = {
      id: 'job-1',
      source: sourceRef,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    let savedCandidates: LearningCandidate[] = []

    const deps: JobRunnerDeps = {
      claimJob: async () => {
        if (job.status !== 'pending') return null
        job = { ...job, status: 'running', attempts: job.attempts + 1 }
        return job
      },
      getJob: async () => job,
      getSource: async () => mockSource,
      collectSource: async () => ({
        jobId: job.id,
        state: 'review_required',
        documentCount: 1,
        partialReason: null,
      }),
      getDocuments: async () => [mockDoc],
      analyzeDocuments: async () => [
        {
          id: crypto.randomUUID(),
          source: sourceRef,
          version: 1,
          category: 'price',
          content: '핸드드립 커피 5,000원',
          evidence: { documentId: mockDoc.id, excerpt: '핸드드립 커피 5,000원', visionReceiptId: null },
          evidenceState: 'observed',
          status: 'review_required',
          conflictsWithFactId: null,
        },
      ],
      saveCandidates: async (_source, candidates) => {
        savedCandidates = [...candidates]
      },
      completeJob: async () => {
        job = { ...job, status: 'completed' }
      },
      failJob: async (_jobId, reason) => {
        job = { ...job, status: 'failed', lastError: reason }
      },
      cancelJob: async (_jobId, reason) => {
        job = { ...job, status: 'cancelled', lastError: reason }
      },
    }

    await runLearningJob('job-1', deps)
    expect(job.status).toBe('completed')
    expect(savedCandidates).toHaveLength(1)
    expect(savedCandidates[0].content).toBe('핸드드립 커피 5,000원')
  })

  it('queries job status when claimJob returns null instead of false ack completion', async () => {
    const runningJob: DurableJob = {
      id: 'job-running-elsewhere',
      source: sourceRef,
      status: 'running',
      attempts: 1,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    let getJobCalled = false
    const deps: JobRunnerDeps = {
      claimJob: async () => null, // already claimed
      getJob: async () => {
        getJobCalled = true
        return runningJob
      },
      getSource: async () => mockSource,
      collectSource: async () => {
        throw new Error('Should not run')
      },
      getDocuments: async () => [],
      analyzeDocuments: async () => [],
      saveCandidates: async () => {},
      completeJob: async () => {},
      failJob: async () => {},
      cancelJob: async () => {},
    }

    await runLearningJob('job-running-elsewhere', deps)
    expect(getJobCalled).toBe(true)
  })

  it('cancels job if source verification is pending or lease expired before collect', async () => {
    let job: DurableJob = {
      id: 'job-unverified',
      source: sourceRef,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const unverifiedSource: LearningSource = {
      ...mockSource,
      verification: 'pending',
    }

    const deps: JobRunnerDeps = {
      claimJob: async () => {
        job = { ...job, status: 'running', attempts: 1 }
        return job
      },
      getJob: async () => job,
      getSource: async () => unverifiedSource,
      collectSource: async () => {
        throw new Error('Should not collect')
      },
      getDocuments: async () => [],
      analyzeDocuments: async () => [],
      saveCandidates: async () => {},
      completeJob: async () => {},
      failJob: async () => {},
      cancelJob: async (_jobId, reason) => {
        job = { ...job, status: 'cancelled', lastError: reason }
      },
    }

    await runLearningJob('job-unverified', deps)
    expect(job.status).toBe('cancelled')
    expect(job.lastError).toContain('SOURCE_NOT_VERIFIED_pending')
  })

  it('does NOT mark job complete if collection failed or blocked', async () => {
    let job: DurableJob = {
      id: 'job-blocked-collect',
      source: sourceRef,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const deps: JobRunnerDeps = {
      claimJob: async () => {
        job = { ...job, status: 'running', attempts: 1 }
        return job
      },
      getJob: async () => job,
      getSource: async () => mockSource,
      collectSource: async () => ({
        jobId: job.id,
        state: 'blocked',
        documentCount: 0,
        partialReason: 'Platform capability blocked',
      }),
      getDocuments: async () => [],
      analyzeDocuments: async () => [],
      saveCandidates: async () => {},
      completeJob: async () => {
        throw new Error('Should not complete on blocked collection!')
      },
      failJob: async () => {},
      cancelJob: async (_jobId, reason) => {
        job = { ...job, status: 'cancelled', lastError: reason }
      },
    }

    await runLearningJob('job-blocked-collect', deps)
    expect(job.status).toBe('cancelled')
    expect(job.lastError).toContain('Platform capability blocked')
  })

  it('cancels without running AI if source is revoked or lease expires before AI phase', async () => {
    let job: DurableJob = {
      id: 'job-revoked-before-ai',
      source: sourceRef,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    let sourceChecks = 0
    let aiCalled = false

    const deps: JobRunnerDeps = {
      claimJob: async () => {
        job = { ...job, status: 'running', attempts: 1 }
        return job
      },
      getJob: async () => job,
      getSource: async () => {
        sourceChecks++
        if (sourceChecks === 1) return mockSource // Phase 1: valid
        // Phase 2 (before AI): lease revoked!
        return {
          ...mockSource,
          verification: 'revoked',
          lease: { ...mockSource.lease!, revokedAt: '2026-11-10T12:00:00.000Z' },
        }
      },
      collectSource: async () => ({
        jobId: job.id,
        state: 'review_required',
        documentCount: 1,
        partialReason: null,
      }),
      getDocuments: async () => [mockDoc],
      analyzeDocuments: async () => {
        aiCalled = true
        return []
      },
      saveCandidates: async () => {},
      completeJob: async () => {},
      failJob: async () => {},
      cancelJob: async (_jobId, reason) => {
        job = { ...job, status: 'cancelled', lastError: reason }
      },
    }

    await runLearningJob('job-revoked-before-ai', deps)
    expect(job.status).toBe('cancelled')
    expect(aiCalled).toBe(false)
  })

  it('cancels without saving candidates if source revision bumped before persistence phase', async () => {
    let job: DurableJob = {
      id: 'job-stale-revision',
      source: sourceRef,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    let sourceChecks = 0
    let candidatesSaved = false

    const deps: JobRunnerDeps = {
      claimJob: async () => {
        job = { ...job, status: 'running', attempts: 1 }
        return job
      },
      getJob: async () => job,
      getSource: async () => {
        sourceChecks++
        if (sourceChecks <= 2) return mockSource // Phase 1 and 2 valid
        // Phase 3 (before persist): revision bumped!
        return {
          ...mockSource,
          revision: 2, // bumped to 2 while job was for revision 1!
        }
      },
      collectSource: async () => ({
        jobId: job.id,
        state: 'review_required',
        documentCount: 1,
        partialReason: null,
      }),
      getDocuments: async () => [mockDoc],
      analyzeDocuments: async () => [
        {
          id: crypto.randomUUID(),
          source: sourceRef,
          version: 1,
          category: 'price',
          content: '커피 5,000원',
          evidence: { documentId: mockDoc.id, excerpt: '커피 5,000원', visionReceiptId: null },
          evidenceState: 'observed',
          status: 'review_required',
          conflictsWithFactId: null,
        },
      ],
      saveCandidates: async () => {
        candidatesSaved = true
      },
      completeJob: async () => {},
      failJob: async () => {},
      cancelJob: async (_jobId, reason) => {
        job = { ...job, status: 'cancelled', lastError: reason }
      },
    }

    await runLearningJob('job-stale-revision', deps)
    expect(job.status).toBe('cancelled')
    expect(candidatesSaved).toBe(false)
  })
})
