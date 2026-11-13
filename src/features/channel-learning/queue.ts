import {
  LearningError,
  type LearningCandidate,
  type LearningDocument,
  type LearningSource,
  type SourceRef,
} from './contracts'

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface DurableJob {
  id: string
  source: SourceRef
  status: JobStatus
  attempts: number
  maxAttempts: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface QueueDeps {
  getActiveJobBySource: (source: SourceRef) => Promise<DurableJob | null>
  createJob: (source: SourceRef) => Promise<DurableJob>
}

export interface JobRunnerDeps {
  claimJob: (jobId: string) => Promise<DurableJob | null>
  getJob: (jobId: string) => Promise<DurableJob | null>
  getSource: (source: SourceRef) => Promise<LearningSource | null>
  collectSource: (
    source: SourceRef,
  ) => Promise<{
    jobId: string
    state: LearningSource['collection']
    documentCount: number
    partialReason: string | null
  }>
  getDocuments: (source: SourceRef) => Promise<LearningDocument[]>
  analyzeDocuments: (
    source: SourceRef,
    docs: LearningDocument[],
  ) => Promise<readonly LearningCandidate[]>
  saveCandidates: (
    source: SourceRef,
    candidates: readonly LearningCandidate[],
  ) => Promise<void>
  completeJob: (jobId: string) => Promise<void>
  failJob: (jobId: string, reason: string) => Promise<void>
  cancelJob: (jobId: string, reason: string) => Promise<void>
  now?: () => Date
}

export function validateSourceLeaseAndConsent(
  source: LearningSource | null,
  expectedRevision: number,
  now: Date,
): { valid: boolean; reason?: string; action: 'cancel' | 'fail' } {
  if (!source) {
    return { valid: false, reason: 'SOURCE_NOT_FOUND', action: 'fail' }
  }
  if (source.deletedAt !== null) {
    return { valid: false, reason: 'SOURCE_DELETED', action: 'cancel' }
  }
  if (source.revision !== expectedRevision) {
    return {
      valid: false,
      reason: `SOURCE_REVISION_MISMATCH_expected_${expectedRevision}_got_${source.revision}`,
      action: 'cancel',
    }
  }
  if (source.verification !== 'verified') {
    return { valid: false, reason: `SOURCE_NOT_VERIFIED_${source.verification}`, action: 'cancel' }
  }
  if (!source.lease) {
    return { valid: false, reason: 'NO_LEASE', action: 'cancel' }
  }
  if (source.lease.revokedAt !== null) {
    return { valid: false, reason: 'LEASE_REVOKED', action: 'cancel' }
  }
  if (new Date(source.lease.expiresAt).getTime() <= now.getTime()) {
    return { valid: false, reason: 'LEASE_EXPIRED', action: 'cancel' }
  }
  if (!source.consent.text && !source.consent.images) {
    return { valid: false, reason: 'NO_CONSENT', action: 'cancel' }
  }
  return { valid: true, action: 'cancel' }
}

export async function submitLearningJob(
  source: SourceRef,
  deps: QueueDeps,
): Promise<{ jobId: string }> {
  // Idempotency: check if an active job already exists for this source and revision
  const existing = await deps.getActiveJobBySource(source)
  if (existing && (existing.status === 'pending' || existing.status === 'running')) {
    return { jobId: existing.id }
  }

  const newJob = await deps.createJob(source)
  return { jobId: newJob.id }
}

export async function runLearningJob(
  jobId: string,
  deps: JobRunnerDeps,
): Promise<void> {
  const getNow = deps.now ?? (() => new Date())
  const now = getNow()

  const claimed = await deps.claimJob(jobId)
  if (!claimed) {
    // If claim returns null, re-check job status; do not falsely acknowledge completion
    const current = await deps.getJob(jobId)
    if (!current) {
      throw new LearningError('JOB_NOT_FOUND', `Job ${jobId} not found`)
    }
    return
  }

  // 1. Phase 1: Pre-collection verification
  const sourceBeforeCollect = await deps.getSource(claimed.source)
  const preCheck = validateSourceLeaseAndConsent(
    sourceBeforeCollect,
    claimed.source.revision,
    now,
  )
  if (!preCheck.valid) {
    const reason = preCheck.reason || 'Source validation failed before collect'
    if (preCheck.action === 'fail') {
      await deps.failJob(jobId, reason)
      throw new LearningError(reason, reason)
    } else {
      await deps.cancelJob(jobId, reason)
      return
    }
  }

  try {
    // 2. Collection
    const collectRes = await deps.collectSource(claimed.source)
    if (collectRes.state === 'blocked' || collectRes.state === 'cancelled') {
      await deps.cancelJob(
        jobId,
        collectRes.partialReason || `Collection stopped with state: ${collectRes.state}`,
      )
      return
    }
    if (collectRes.state === 'failed') {
      await deps.failJob(
        jobId,
        collectRes.partialReason || 'Collection failed permanently',
      )
      return
    }

    // 3. Load collected documents
    const docs = await deps.getDocuments(claimed.source)
    if (docs.length === 0) {
      // Partial collection or no docs found
      await deps.completeJob(jobId)
      return
    }

    // 4. Phase 2: Pre-AI verification (re-verify source revision, lease, revocation)
    const sourceBeforeAI = await deps.getSource(claimed.source)
    const aiCheck = validateSourceLeaseAndConsent(
      sourceBeforeAI,
      claimed.source.revision,
      getNow(),
    )
    if (!aiCheck.valid) {
      await deps.cancelJob(
        jobId,
        `Source invalidated before AI analysis: ${aiCheck.reason}`,
      )
      return
    }

    // 5. AI Analysis
    const candidates = await deps.analyzeDocuments(claimed.source, docs)

    // 6. Phase 3: Pre-persistence verification (re-verify source revision, lease, revocation)
    const sourceBeforePersist = await deps.getSource(claimed.source)
    const persistCheck = validateSourceLeaseAndConsent(
      sourceBeforePersist,
      claimed.source.revision,
      getNow(),
    )
    if (!persistCheck.valid) {
      await deps.cancelJob(
        jobId,
        `Source invalidated before candidate persistence: ${persistCheck.reason}`,
      )
      return
    }

    // 7. Save candidates
    if (candidates.length > 0) {
      await deps.saveCandidates(claimed.source, candidates)
    }

    // 8. Mark job completed
    await deps.completeJob(jobId)
  } catch (err: any) {
    const errorMsg = err?.message || 'Learning job execution failed'
    await deps.failJob(jobId, errorMsg)
    throw err
  }
}
