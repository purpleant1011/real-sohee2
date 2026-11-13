import { randomUUID } from 'node:crypto'
import {
  type CandidateCategory,
  type Capability,
  type EvidenceLease,
  type LearningCandidate,
  type LearningDocument,
  LearningError,
  type LearningSource,
  type SourceRef,
} from './contracts'
import type { ApprovedContextItem, DurableJobRecord, LearningRepository } from './repository'

export const TENANT_A_WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'
export const TENANT_A_USER_ID = '10000000-0000-4000-8000-000000000002'
export const TENANT_A_SOURCE_ID = '20000000-0000-4000-8000-000000000001'
export const TENANT_A_DOCUMENT_ID = '30000000-0000-4000-8000-000000000001'
export const TENANT_A_CANDIDATE_ID = '40000000-0000-4000-8000-000000000001'

export const TENANT_B_WORKSPACE_ID = '10000000-0000-4000-8000-000000000003'
export const TENANT_B_USER_ID = '10000000-0000-4000-8000-000000000004'
export const TENANT_B_SOURCE_ID = '20000000-0000-4000-8000-000000000002'
export const TENANT_B_DOCUMENT_ID = '30000000-0000-4000-8000-000000000002'
export const TENANT_B_CANDIDATE_ID = '40000000-0000-4000-8000-000000000002'

export const tenantASourceRef: SourceRef = {
  workspaceId: TENANT_A_WORKSPACE_ID,
  sourceId: TENANT_A_SOURCE_ID,
  revision: 1,
}

export const tenantBSourceRef: SourceRef = {
  workspaceId: TENANT_B_WORKSPACE_ID,
  sourceId: TENANT_B_SOURCE_ID,
  revision: 1,
}

export const tenantALease: EvidenceLease = {
  ...tenantASourceRef,
  providerAccountId: 'ig_act_tenant_a',
  method: 'oauth',
  verifiedAt: '2026-11-10T09:00:00.000Z',
  expiresAt: '2026-11-11T09:00:00.000Z',
  revokedAt: null,
  evidenceRevision: 1,
}

export const tenantBLease: EvidenceLease = {
  ...tenantBSourceRef,
  providerAccountId: 'ig_act_tenant_b',
  method: 'oauth',
  verifiedAt: '2026-11-10T09:00:00.000Z',
  expiresAt: '2026-11-11T09:00:00.000Z',
  revokedAt: null,
  evidenceRevision: 1,
}

export const tenantASource: LearningSource = {
  ...tenantASourceRef,
  platform: 'instagram',
  canonicalUrl: 'https://www.instagram.com/tenant_a_biz/',
  canonicalIdentity: 'tenant_a_biz',
  verification: 'verified',
  collection: 'extracting',
  lease: tenantALease,
  consent: { text: true, images: true, revision: 1 },
  deletedAt: null,
}

export const tenantBSource: LearningSource = {
  ...tenantBSourceRef,
  platform: 'instagram',
  canonicalUrl: 'https://www.instagram.com/tenant_b_biz/',
  canonicalIdentity: 'tenant_b_biz',
  verification: 'verified',
  collection: 'extracting',
  lease: tenantBLease,
  consent: { text: true, images: false, revision: 1 },
  deletedAt: null,
}

export const tenantADocument: LearningDocument = {
  id: TENANT_A_DOCUMENT_ID,
  source: tenantASourceRef,
  providerDocumentId: 'post_1001',
  authorAccountId: 'ig_act_tenant_a',
  url: 'https://www.instagram.com/p/tenant_a_post_1/',
  publishedAt: '2026-11-09T10:00:00.000Z',
  collectedAt: '2026-11-10T09:05:00.000Z',
  text: '월~금 10:00 - 20:00 예약제로 운영되는 프라이빗 살롱입니다.',
  contentHash: 'hash_tenant_a_doc_1001',
  images: [
    {
      mediaId: 'media_a_1',
      url: 'https://cdn.instagram.com/media_a_1.jpg',
      mimeType: 'image/jpeg',
    },
  ],
}

export const tenantBDocument: LearningDocument = {
  id: TENANT_B_DOCUMENT_ID,
  source: tenantBSourceRef,
  providerDocumentId: 'post_2001',
  authorAccountId: 'ig_act_tenant_b',
  url: 'https://www.instagram.com/p/tenant_b_post_1/',
  publishedAt: '2026-11-09T11:00:00.000Z',
  collectedAt: '2026-11-10T09:10:00.000Z',
  text: '토요일 11:00 - 18:00 원데이 클래스를 진행합니다.',
  contentHash: 'hash_tenant_b_doc_2001',
  images: [],
}

export const tenantACandidate: LearningCandidate = {
  id: TENANT_A_CANDIDATE_ID,
  source: tenantASourceRef,
  version: 1,
  category: 'hours',
  content: '월~금 10:00 - 20:00',
  evidence: {
    documentId: TENANT_A_DOCUMENT_ID,
    excerpt: '월~금 10:00 - 20:00 예약제',
    visionReceiptId: null,
  },
  evidenceState: 'observed',
  status: 'review_required',
  conflictsWithFactId: null,
}

export const tenantBCandidate: LearningCandidate = {
  id: TENANT_B_CANDIDATE_ID,
  source: tenantBSourceRef,
  version: 1,
  category: 'offering',
  content: '토요일 원데이 클래스',
  evidence: {
    documentId: TENANT_B_DOCUMENT_ID,
    excerpt: '원데이 클래스를 진행합니다.',
    visionReceiptId: null,
  },
  evidenceState: 'observed',
  status: 'review_required',
  conflictsWithFactId: null,
}

export const sampleCapabilities: readonly Capability[] = [
  {
    platform: 'instagram',
    verificationMethods: ['oauth'],
    collectionMode: 'official_api',
    blockerCode: null,
  },
  {
    platform: 'threads',
    verificationMethods: ['oauth'],
    collectionMode: 'official_api',
    blockerCode: null,
  },
  {
    platform: 'naver_blog',
    verificationMethods: [],
    collectionMode: 'manual_only',
    blockerCode: 'NAVER_AUTOMATION_RESTRICTED',
  },
  {
    platform: 'naver_place',
    verificationMethods: [],
    collectionMode: 'manual_only',
    blockerCode: 'NAVER_AUTOMATION_RESTRICTED',
  },
  {
    platform: 'daangn_business',
    verificationMethods: [],
    collectionMode: 'blocked',
    blockerCode: 'CAPABILITY_NOT_ACTIVATED',
  },
  {
    platform: 'website',
    verificationMethods: [],
    collectionMode: 'blocked',
    blockerCode: 'SAFE_FETCH_NOT_CONFIGURED',
  },
]

export function createInMemoryLearningRepository(): LearningRepository {
  type SourceState = LearningSource & { actorUserId: string }
  type CandidateState = LearningCandidate & { workspaceId: string }
  type FactState = {
    id: string
    workspaceId: string
    category: CandidateCategory
    content: string
    status: 'active' | 'superseded'
    sourceType: 'manual' | 'channel'
    sourceId: string | null
    sourceRevision: number | null
  }

  const sources = new Map<string, SourceState>()
  const documents = new Map<string, LearningDocument>()
  const candidates = new Map<string, CandidateState>()
  const facts = new Map<string, FactState>()
  const jobs = new Map<string, DurableJobRecord>()
  const jobKeys = new Map<string, string>()
  const epochs = new Map<string, number>()

  const sourceKey = (ws: string, id: string) => `${ws}:${id}`
  const jobKey = (ws: string, idemp: string) => `${ws}:${idemp}`
  // Same contract as the production repository: the DTO keeps the latest (even expired) lease and a
  // stored 'verified' is derived to 'expired'/'revoked' once the lease is no longer usable.
  const withDerivedVerification = (item: SourceState): LearningSource => {
    const source: LearningSource & { actorUserId?: string } = { ...item }
    delete source.actorUserId
    if (source.verification !== 'verified') return { ...source }
    if (!source.lease) return { ...source, verification: 'expired' }
    if (source.lease.revokedAt) return { ...source, verification: 'revoked' }
    if (new Date(source.lease.expiresAt) <= new Date()) return { ...source, verification: 'expired' }
    return { ...source }
  }
  const cancelOpenJobs = (workspaceId: string, sourceId: string) => {
    for (const job of jobs.values()) {
      if (
        job.workspaceId === workspaceId &&
        job.sourceId === sourceId &&
        job.kind !== 'delete' &&
        (job.status === 'queued' || job.status === 'running')
      ) {
        jobs.set(job.id, { ...job, status: 'cancelled', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() })
      }
    }
  }

  const ensureManualFact = (workspaceId: string) => {
    const manualFactId = `manual_fact_${workspaceId}`
    if (!facts.has(manualFactId)) {
      facts.set(manualFactId, {
        id: manualFactId,
        workspaceId,
        category: 'policy',
        content: '수동 등록된 운영 원칙 및 고객 응대 가이드',
        status: 'active',
        sourceType: 'manual',
        sourceId: null,
        sourceRevision: null,
      })
    }
  }

  return {
    async loadSource(workspaceId: string, sourceId: string): Promise<LearningSource | null> {
      const item = sources.get(sourceKey(workspaceId, sourceId))
      if (!item || item.workspaceId !== workspaceId || item.deletedAt) return null
      return withDerivedVerification(item)
    },

    async listSources(workspaceId: string): Promise<readonly LearningSource[]> {
      const list: LearningSource[] = []
      for (const item of sources.values()) {
        if (item.workspaceId === workspaceId && !item.deletedAt) {
          list.push(withDerivedVerification(item))
        }
      }
      return list
    },

    async registerSource(input): Promise<LearningSource> {
      const sourceId = randomUUID()
      const newSource: SourceState = {
        workspaceId: input.workspaceId,
        sourceId,
        revision: 1,
        platform: input.platform,
        canonicalUrl: input.canonicalUrl,
        canonicalIdentity: input.canonicalIdentity,
        verification: 'pending',
        collection: 'queued',
        lease: null,
        consent: {
          text: input.consent.text,
          images: input.consent.images,
          revision: 1,
        },
        deletedAt: null,
        actorUserId: input.actorUserId,
      }
      sources.set(sourceKey(input.workspaceId, sourceId), newSource)
      if (!epochs.has(input.workspaceId)) epochs.set(input.workspaceId, 1)
      return { ...newSource }
    },

    async persistDocuments(workspaceId, source, docs): Promise<void> {
      const current = sources.get(sourceKey(workspaceId, source.sourceId))
      if (!current || current.deletedAt || current.revision !== source.revision) {
        throw new LearningError('STALE_SOURCE_REVISION', '문서 저장 중 리비전 불일치')
      }
      for (const doc of docs) {
        documents.set(`${workspaceId}:${doc.id}`, { ...doc, source })
      }
    },

    async persistCandidates(workspaceId, source, cands): Promise<void> {
      const current = sources.get(sourceKey(workspaceId, source.sourceId))
      if (!current || current.deletedAt || current.revision !== source.revision) {
        throw new LearningError('STALE_SOURCE_REVISION', '후보 저장 중 리비전 불일치')
      }
      for (const c of cands) {
        candidates.set(`${workspaceId}:${c.id}`, { ...c, source, workspaceId })
      }
    },

    async loadCandidates(workspaceId, sourceId): Promise<readonly LearningCandidate[]> {
      const list: LearningCandidate[] = []
      for (const c of candidates.values()) {
        if (c.workspaceId === workspaceId && c.source.sourceId === sourceId) {
          list.push({ ...c })
        }
      }
      return list
    },

    async updateVerificationLease(input): Promise<EvidenceLease> {
      const { source, lease } = input
      const current = sources.get(sourceKey(source.workspaceId, source.sourceId))
      if (!current || current.deletedAt || current.revision !== source.revision) {
        throw new LearningError('STALE_SOURCE_REVISION', '출처 리비전 불일치')
      }

      const fullLease: EvidenceLease = {
        ...source,
        ...lease,
      }
      current.lease = fullLease
      current.verification = 'verified'
      sources.set(sourceKey(source.workspaceId, source.sourceId), current)
      return fullLease
    },

    async reviewCandidates(actor, input): Promise<void> {
      const current = sources.get(sourceKey(actor.workspaceId, input.source.sourceId))
      if (!current || current.deletedAt) {
        throw new LearningError('SOURCE_NOT_FOUND', '출처가 존재하지 않거나 삭제되었습니다.')
      }

      if (current.revision !== input.source.revision) {
        throw new LearningError('STALE_SOURCE_REVISION', '출처 리비전이 변경되었습니다.')
      }

      const lease = current.lease
      if (
        !lease ||
        lease.revokedAt !== null ||
        new Date(lease.expiresAt) <= new Date() ||
        lease.evidenceRevision !== input.evidenceRevision
      ) {
        throw new LearningError('STALE_EVIDENCE_REVISION', '검증 리스가 유효하지 않습니다.')
      }

      for (const decision of input.decisions) {
        const candidate = candidates.get(`${actor.workspaceId}:${decision.candidateId}`)
        if (!candidate) {
          throw new LearningError('CANDIDATE_NOT_FOUND', '후보를 찾을 수 없습니다.')
        }

        if (candidate.version !== decision.version) {
          throw new LearningError('STALE_CANDIDATE_VERSION', '후보의 버전이 변경되었습니다.')
        }

        if (decision.decision === 'approved') {
          if (candidate.status === 'conflict' && !decision.editedContent) {
            throw new LearningError('CONFLICT_RESOLUTION_REQUIRED', '충돌 내용 수정이 필요합니다.')
          }

          candidate.status = 'approved'
          candidate.version += 1
          if (decision.editedContent) candidate.content = decision.editedContent
          candidates.set(`${actor.workspaceId}:${decision.candidateId}`, candidate)

          const factId = `fact_${candidate.id}`
          facts.set(factId, {
            id: factId,
            workspaceId: actor.workspaceId,
            category: candidate.category,
            content: candidate.content,
            status: 'active',
            sourceType: 'channel',
            sourceId: current.sourceId,
            sourceRevision: current.revision,
          })
        } else {
          candidate.status = 'rejected'
          candidate.version += 1
          candidates.set(`${actor.workspaceId}:${decision.candidateId}`, candidate)
        }
      }

      const nextEpoch = (epochs.get(actor.workspaceId) ?? 1) + 1
      epochs.set(actor.workspaceId, nextEpoch)
    },

    async revokeSource(actor, source): Promise<void> {
      const current = sources.get(sourceKey(actor.workspaceId, source.sourceId))
      if (!current) throw new LearningError('SOURCE_NOT_FOUND', '출처를 찾을 수 없습니다.')

      current.revision += 1
      current.verification = 'revoked'
      current.collection = 'cancelled'
      if (current.lease) {
        current.lease = {
          ...current.lease,
          revokedAt: new Date().toISOString(),
          revision: current.revision,
        }
      }
      sources.set(sourceKey(actor.workspaceId, source.sourceId), current)
      cancelOpenJobs(actor.workspaceId, source.sourceId)

      const nextEpoch = (epochs.get(actor.workspaceId) ?? 1) + 1
      epochs.set(actor.workspaceId, nextEpoch)

      for (const [id, fact] of facts.entries()) {
        if (fact.workspaceId === actor.workspaceId && fact.sourceId === source.sourceId) {
          facts.set(id, { ...fact, status: 'superseded' })
        }
      }
    },

    async createJob(input): Promise<DurableJobRecord> {
      const key = jobKey(input.workspaceId, input.idempotencyKey)
      const existingId = jobKeys.get(key)
      const existing = existingId ? jobs.get(existingId) : undefined
      if (existing) {
        if (
          existing.sourceId !== input.sourceId ||
          existing.kind !== input.kind ||
          existing.sourceRevision !== input.sourceRevision
        ) {
          throw new LearningError('IDEMPOTENCY_CONFLICT', '동일한 멱등키에 다른 작업 명세가 이미 등록되어 있습니다.')
        }
        return existing
      }

      // Mirrors create_learning_job_atomic: revoked/deleted/stale sources cannot get collect|verify jobs.
      const source = sources.get(sourceKey(input.workspaceId, input.sourceId))
      if (!source) throw new LearningError('SOURCE_NOT_FOUND', '출처를 찾을 수 없습니다.')
      if (input.kind !== 'delete') {
        if (source.deletedAt) throw new LearningError('SOURCE_NOT_FOUND', '출처를 찾을 수 없습니다.')
        if (source.collection === 'cancelled' || source.verification === 'revoked') {
          throw new LearningError('SOURCE_PAUSED', '철회된 출처입니다.')
        }
      }
      if (source.revision !== input.sourceRevision) {
        throw new LearningError('STALE_SOURCE_REVISION', '출처 리비전 불일치')
      }

      const newJob: DurableJobRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
        sourceRevision: input.sourceRevision,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        status: 'queued',
        attempt: 0,
        checkpoint: {},
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      jobKeys.set(key, newJob.id)
      jobs.set(newJob.id, newJob)
      return newJob
    },

    async getJob(_workspaceId, jobId): Promise<DurableJobRecord | null> {
      return jobs.get(jobId) ?? null
    },

    async claimJob(workspaceId, jobId, workerId, leaseSeconds = 300): Promise<DurableJobRecord | null> {
      const job = jobs.get(jobId)
      if (!job || job.workspaceId !== workspaceId) return null
      const claimable =
        job.status === 'queued' ||
        (job.status === 'running' && job.leaseExpiresAt !== null && job.leaseExpiresAt !== undefined && new Date(job.leaseExpiresAt) <= new Date())
      if (!claimable) return null

      if (job.kind !== 'delete') {
        const source = sources.get(sourceKey(workspaceId, job.sourceId))
        if (
          !source ||
          source.deletedAt ||
          source.collection === 'cancelled' ||
          source.verification === 'revoked' ||
          source.revision !== job.sourceRevision
        ) {
          jobs.set(job.id, { ...job, status: 'cancelled', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() })
          return null
        }
      }

      const claimed: DurableJobRecord = {
        ...job,
        status: 'running',
        attempt: job.attempt + 1,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }
      jobs.set(job.id, claimed)
      return claimed
    },

    async updateJobStatus(workspaceId, jobId, status, details): Promise<void> {
      const job = jobs.get(jobId)
      if (!job || job.workspaceId !== workspaceId) throw new LearningError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.')
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        if (job.status === status) return
        throw new LearningError('JOB_STATE_CONFLICT', '이미 종료된 작업입니다.')
      }
      if (!details?.leaseOwner) {
        if (!(job.status === 'queued' && (status === 'cancelled' || status === 'failed'))) {
          throw new LearningError('JOB_LEASE_REQUIRED', '클레임된 작업은 leaseOwner가 필요합니다.')
        }
      } else if (
        job.status !== 'running' ||
        job.leaseOwner !== details.leaseOwner ||
        !job.leaseExpiresAt ||
        new Date(job.leaseExpiresAt) <= new Date()
      ) {
        throw new LearningError('JOB_LEASE_MISMATCH', '작업 임대가 일치하지 않거나 만료되었습니다.')
      }
      const release = status !== 'running'
      jobs.set(jobId, {
        ...job,
        status,
        checkpoint: details?.checkpoint ?? job.checkpoint,
        leaseOwner: release ? null : job.leaseOwner,
        leaseExpiresAt: release ? null : new Date(Date.now() + 300_000).toISOString(),
        updatedAt: new Date().toISOString(),
      })
    },

    async markSourceDeleted(actor, source): Promise<{ deletionJobId: string; status: 'pending' }> {
      const current = sources.get(sourceKey(actor.workspaceId, source.sourceId))
      if (!current || current.deletedAt || current.revision !== source.revision) {
        throw new LearningError('STALE_SOURCE_REVISION', '출처 삭제 중 리비전 불일치 또는 이미 삭제됨')
      }

      current.revision += 1
      current.deletedAt = new Date().toISOString()
      current.verification = 'revoked'
      current.collection = 'cancelled'
      if (current.lease) {
        current.lease = {
          ...current.lease,
          revokedAt: current.deletedAt,
          revision: current.revision,
        }
      }
      sources.set(sourceKey(actor.workspaceId, source.sourceId), current)
      cancelOpenJobs(actor.workspaceId, source.sourceId)

      const nextEpoch = (epochs.get(actor.workspaceId) ?? 1) + 1
      epochs.set(actor.workspaceId, nextEpoch)

      for (const [id, fact] of facts.entries()) {
        if (fact.workspaceId === actor.workspaceId && fact.sourceId === source.sourceId) {
          facts.set(id, { ...fact, status: 'superseded' })
        }
      }

      const job = await this.createJob({
        workspaceId: actor.workspaceId,
        sourceId: source.sourceId,
        sourceRevision: current.revision,
        kind: 'delete',
        idempotencyKey: `delete:${source.sourceId}:${current.revision}`,
      })

      return { deletionJobId: job.id, status: 'pending' }
    },

    async queryApprovedContext(input): Promise<{
      items: readonly ApprovedContextItem[]
      epoch: number
      dependencies: readonly SourceRef[]
    }> {
      ensureManualFact(input.workspaceId)
      const epoch = epochs.get(input.workspaceId) ?? 1
      const activeItems: ApprovedContextItem[] = []
      const dependencies: SourceRef[] = []

      for (const fact of facts.values()) {
        if (fact.workspaceId !== input.workspaceId || fact.status !== 'active') continue
        if (input.purpose === 'image' && fact.category !== 'visual') continue

        if (fact.sourceType === 'manual') {
          activeItems.push({
            id: fact.id,
            category: fact.category,
            content: fact.content,
            sourceType: 'manual',
            sourceId: null,
            sourceRevision: null,
          })
          continue
        }

        if (fact.sourceType === 'channel' && fact.sourceId) {
          const source = sources.get(sourceKey(input.workspaceId, fact.sourceId))
          if (
            source &&
            !source.deletedAt &&
            source.revision === fact.sourceRevision &&
            source.lease &&
            source.lease.revokedAt === null &&
            new Date(source.lease.expiresAt) > new Date()
          ) {
            activeItems.push({
              id: fact.id,
              category: fact.category,
              content: fact.content,
              sourceType: 'channel',
              sourceId: fact.sourceId,
              sourceRevision: fact.sourceRevision,
            })
            dependencies.push({
              workspaceId: input.workspaceId,
              sourceId: fact.sourceId,
              revision: fact.sourceRevision ?? source.revision,
            })
          }
        }
      }

      let filteredItems = activeItems
      if (input.query && input.query.trim().length > 0) {
        const q = input.query.toLowerCase().trim()
        filteredItems = activeItems.filter(item => item.content.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
      }

      const limit = input.maxFacts ?? 32
      return {
        items: filteredItems.slice(0, limit),
        epoch,
        dependencies,
      }
    },

    async validateResult(input): Promise<boolean> {
      const currentEpoch = epochs.get(input.workspaceId) ?? 1
      if (currentEpoch !== input.expectedEpoch) return false
      if (input.dependencies.length === 0) return true
      for (const dep of input.dependencies) {
        if (dep.workspaceId !== input.workspaceId) return false
        const source = sources.get(sourceKey(input.workspaceId, dep.sourceId))
        if (
          !source ||
          source.deletedAt ||
          source.collection === 'cancelled' ||
          source.verification === 'revoked' ||
          source.revision !== dep.revision ||
          !source.lease ||
          source.lease.revokedAt !== null ||
          new Date(source.lease.expiresAt) <= new Date()
        ) {
          return false
        }
      }
      return true
    },
  }
}
