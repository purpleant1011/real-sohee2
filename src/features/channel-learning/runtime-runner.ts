import {
  LearningError,
  type LearningDocument,
  type LearningSource,
  type SourceRef,
} from './contracts'
import type { DurableJobRecord, LearningRepository, SupabaseQueryClient } from './repository'
import { collectMetaDocuments, type ProviderFetchResult } from './meta-collector'
import { analyzeLearningDocuments, type AnalysisDeps, type BillingGateway } from './analysis'
import { executeSourceDeletion, type RetentionDeps } from './retention'
import { validateSourceLeaseAndConsent } from './queue'

export interface LearningQueueEnvelope {
  schemaVersion?: number
  kind: 'knowledge_collect' | 'knowledge_verify' | 'knowledge_delete'
  workspaceId: string
  jobId: string
}

export interface ProductionOAuthCredential {
  accessToken: string
  scopes: string[]
  providerAccountId?: string
  expiresAt?: string
}

export interface ProductionLearningRunnerOptions {
  repository?: LearningRepository
  claimJobCAS?: (input: {
    workspaceId: string
    jobId: string
    expectedStatus: 'queued'
  }) => Promise<DurableJobRecord | null>
  updateSourceCollectionStatus?: (
    workspaceId: string,
    sourceId: string,
    status: 'collecting' | 'review_required' | 'partial' | 'failed' | 'cancelled',
    expectedRevision: number,
  ) => Promise<void>
  getCredential?: (workspaceId: string, platform: 'instagram' | 'threads') => Promise<ProductionOAuthCredential | null>
  providerFetch?: (input: {
    provider: 'instagram' | 'threads'
    path: string
    accessToken: string
    maxBytes?: number
    query?: Record<string, string>
  }) => Promise<any>
  billingGateway?: BillingGateway
  aiExtractor?: {
    extractFacts: (input: { text: string; source: SourceRef }) => Promise<any[]>
    analyzeVision?: (input: { images: Array<{ mediaId: string; url: string }>; source: SourceRef }) => Promise<any[]>
  }
  retentionDeps?: RetentionDeps
  verificationRenewal?: (
    source: LearningSource,
    deps: { now?: () => Date },
  ) => Promise<{ state: string; [key: string]: any }>
  verifyFreshSubject?: (
    source: LearningSource,
    credential: ProductionOAuthCredential,
  ) => Promise<{ valid: boolean; code?: string; reason?: string }>
  now?: () => Date
}

export function createProductionLearningRunner(
  admin: SupabaseQueryClient | any,
  options: ProductionLearningRunnerOptions = {},
): (envelope: LearningQueueEnvelope) => Promise<{ state: string; details?: any }> {
  const getNow = options.now ?? (() => new Date())

  return async (envelope: LearningQueueEnvelope): Promise<{ state: string; details?: any }> => {
    // 1. Validate envelope shape
    if (
      !envelope ||
      !['knowledge_collect', 'knowledge_verify', 'knowledge_delete'].includes(envelope.kind) ||
      !envelope.workspaceId ||
      !envelope.jobId
    ) {
      throw new LearningError('INVALID_ENVELOPE', 'Envelope missing required kind, workspaceId, or jobId')
    }

    const { workspaceId, jobId, kind } = envelope

    const repo = options.repository
    if (!repo) {
      throw new LearningError('REPOSITORY_UNAVAILABLE', 'Learning repository is required for production runner')
    }

    // 2. Fetch durable job
    const job = await repo.getJob(workspaceId, jobId)
    if (!job) {
      return { state: 'not_found' }
    }

    // Cross-tenant validation
    if (job.workspaceId !== workspaceId) {
      throw new LearningError('TENANT_MISMATCH', 'Job workspaceId does not match envelope workspaceId')
    }

    // Kind matching
    const expectedKindMap = {
      knowledge_collect: 'collect',
      knowledge_verify: 'verify',
      knowledge_delete: 'delete',
    } as const

    if (job.kind !== expectedKindMap[kind]) {
      throw new LearningError(
        'JOB_KIND_MISMATCH',
        `Job kind '${job.kind}' does not match envelope kind '${kind}'`,
      )
    }

    // Idempotency: return existing state if already terminal
    if (job.status === 'completed' || job.status === 'cancelled') {
      return { state: job.status }
    }

    // 3. Atomic CAS Claim
    if (!options.claimJobCAS) {
      // Unconditional updateJobStatus(running) is NOT atomic CAS.
      // Must require claimJobCAS RPC to prevent race conditions.
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'JOB_CLAIM_CAS_RPC_REQUIRED',
        errorMessage: 'Atomic CAS claim RPC required for queue job execution',
      })
      return { state: 'blocked', details: { reason: 'JOB_CLAIM_CAS_RPC_REQUIRED' } }
    }

    const claimed = await options.claimJobCAS({
      workspaceId,
      jobId,
      expectedStatus: 'queued',
    })

    if (!claimed) {
      return { state: 'already_claimed_or_completed' }
    }

    // 4. Dispatch by kind
    if (kind === 'knowledge_delete') {
      try {
        const retentionDeps: RetentionDeps = options.retentionDeps ?? { dbClient: admin }
        const result = await executeSourceDeletion(workspaceId, job.sourceId, retentionDeps)
        await repo.updateJobStatus(workspaceId, jobId, 'completed', {
          checkpoint: { ...result },
        })
        return { state: 'completed', details: result }
      } catch (err: any) {
        const currentAttempt = Number(claimed.attempt ?? job.attempt ?? 1)
        if (currentAttempt < 5) {
          // Revert to queued via leaseOwner CAS so it can be re-claimed and retried
          await repo.updateJobStatus(workspaceId, jobId, 'queued', {
            errorCode: 'DELETE_RETRYABLE_ERROR',
            errorMessage: err?.message || 'Delete execution temporarily failed',
            checkpoint: {
              retryAttempt: currentAttempt,
              lastDeleteError: err?.message,
              lastDeleteAttemptAt: getNow().toISOString(),
            },
          })
          return { state: 'retry', details: { reason: err?.message, attempt: currentAttempt } }
        }
        // Max attempts reached: mark as operator-visible failed (do NOT mark completed)
        await repo.updateJobStatus(workspaceId, jobId, 'failed', {
          errorCode: 'DELETE_MAX_ATTEMPTS_EXCEEDED',
          errorMessage: err?.message || 'Delete execution failed after max attempts',
          checkpoint: {
            failedAtAttempt: currentAttempt,
            lastDeleteError: err?.message,
          },
        })
        throw err
      }
    }

    // Load source for collect and verify
    const source = await repo.loadSource(workspaceId, job.sourceId)
    if (!source) {
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorMessage: 'Source not found',
      })
      return { state: 'failed', details: { reason: 'SOURCE_NOT_FOUND' } }
    }

    if (kind === 'knowledge_verify') {
      try {
        if (!options.verificationRenewal) {
          // Do NOT complete with fake success simply because credentials exist.
          // Renewal requires atomic lease renewal with provider verification.
          await repo.updateJobStatus(workspaceId, jobId, 'failed', {
            errorCode: 'VERIFICATION_RENEWAL_ADAPTER_REQUIRED',
            errorMessage: 'Actual verification renewal adapter required',
          })
          return { state: 'blocked', details: { reason: 'VERIFICATION_RENEWAL_ADAPTER_REQUIRED' } }
        }

        const renewResult = await options.verificationRenewal(source, { now: getNow })
        if (renewResult.state === 'retry') {
          await repo.updateJobStatus(workspaceId, jobId, 'queued', {
            checkpoint: { ...renewResult },
          })
          return { state: 'retry', details: renewResult }
        }
        await repo.updateJobStatus(workspaceId, jobId, 'completed', {
          checkpoint: { ...renewResult },
        })
        return {
          state: renewResult.state === 'revoked' ? 'revoked' : 'completed',
          details: renewResult,
        }
      } catch (err: any) {
        await repo.updateJobStatus(workspaceId, jobId, 'failed', {
          errorMessage: err?.message || 'Verification renewal failed',
        })
        throw err
      }
    }

    // kind === 'knowledge_collect'
    // Platform validation: Do NOT coerce non-Meta platforms (e.g. naver_blog, website) to instagram!
    if (source.platform !== 'instagram' && source.platform !== 'threads') {
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'PLATFORM_OFFICIAL_API_UNSUPPORTED',
        errorMessage: `Platform ${source.platform} does not support official API collection`,
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
      return {
        state: 'blocked',
        details: { reason: `PLATFORM_OFFICIAL_API_UNSUPPORTED_${source.platform}` },
      }
    }

    // Phase 1: Pre-collection verification
    const preCheck = validateSourceLeaseAndConsent(source, job.sourceRevision, getNow())
    if (!preCheck.valid) {
      await repo.updateJobStatus(workspaceId, jobId, 'cancelled', {
        errorMessage: preCheck.reason,
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'cancelled', source.revision)
      return { state: 'cancelled', details: { reason: preCheck.reason } }
    }

    // Check credentials
    if (!options.getCredential) {
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'CREDENTIAL_ADAPTER_BLOCKED',
        errorMessage: 'No credential provider wired',
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
      return { state: 'blocked', details: { reason: 'CREDENTIAL_ADAPTER_BLOCKED' } }
    }

    const platform = source.platform
    const credential = await options.getCredential(workspaceId, platform)
    if (!credential) {
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'CREDENTIAL_MISSING',
        errorMessage: 'OAuth credential missing or not connected',
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
      return { state: 'blocked', details: { reason: 'CREDENTIAL_MISSING' } }
    }

    if (options.verifyFreshSubject) {
      const freshCheck = await options.verifyFreshSubject(source, credential)
      if (!freshCheck.valid) {
        if (freshCheck.code === 'TRANSIENT_ERROR') {
          // Do not cancel or fail permanently on temporary network/rate-limit issues; preserve valid lease and retry
          await repo.updateJobStatus(workspaceId, jobId, 'queued', {
            errorCode: 'TRANSIENT_PROVIDER_ERROR',
            errorMessage: freshCheck.reason ?? 'Live provider check temporarily unavailable',
          })
          return { state: 'retry', details: { reason: freshCheck.reason } }
        }
        await repo.updateJobStatus(workspaceId, jobId, 'failed', {
          errorCode: freshCheck.code ?? 'IDENTITY_MISMATCH',
          errorMessage: freshCheck.reason ?? 'Fresh token and subject verification failed',
        })
        await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
        return { state: 'failed', details: { reason: freshCheck.reason } }
      }
    }

    // Check AI billing and extractor
    if (!options.billingGateway || !options.aiExtractor) {
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'AI_PIPELINE_BLOCKED',
        errorMessage: 'AI billing or extractor is not configured; mock execution is forbidden',
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
      return { state: 'blocked', details: { reason: 'AI_PIPELINE_BLOCKED' } }
    }

    // Transition source collection status to 'collecting'
    await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'collecting', source.revision)

    // Collect documents
    const collectedDocs: LearningDocument[] = []
    const fetchProviderWrapper = async (input: {
      platform: 'instagram' | 'threads'
      path: string
      params?: Record<string, string>
      maxBytes?: number
    }): Promise<ProviderFetchResult> => {
      if (!options.providerFetch) {
        throw new LearningError('PROVIDER_FETCH_MISSING', 'Provider fetch adapter missing')
      }
      try {
        const res: any = await options.providerFetch({
          provider: input.platform,
          path: input.path,
          accessToken: credential.accessToken,
          maxBytes: input.maxBytes,
          query: input.params,
        })
        return {
          status: 200,
          data: res,
          bodySizeBytes: JSON.stringify(res).length,
        }
      } catch (err: any) {
        return {
          status: 500,
          error: err?.message || 'Provider fetch failed',
        }
      }
    }

    try {
      for await (const doc of collectMetaDocuments(source, {
        fetchProvider: fetchProviderWrapper,
        now: getNow,
      })) {
        collectedDocs.push(doc)
      }
    } catch (err: any) {
      await repo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorMessage: err?.message || 'Document collection failed',
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
      throw err
    }

    // Check revision before persist documents
    const sourceMid = await repo.loadSource(workspaceId, job.sourceId)
    const midCheck = validateSourceLeaseAndConsent(sourceMid, job.sourceRevision, getNow())
    if (!midCheck.valid) {
      await repo.updateJobStatus(workspaceId, jobId, 'cancelled', {
        errorMessage: `Source invalidated before persisting documents: ${midCheck.reason}`,
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'cancelled', source.revision)
      return { state: 'cancelled', details: { reason: midCheck.reason } }
    }

    if (collectedDocs.length > 0) {
      await repo.persistDocuments(workspaceId, source, collectedDocs)
    }

    // Analyze documents
    const analysisDeps: AnalysisDeps = {
      billingGateway: options.billingGateway,
      aiGateway: options.aiExtractor,
    }

    let candidates: any[] = []
    if (collectedDocs.length > 0) {
      try {
        candidates = [...(await analyzeLearningDocuments(source, collectedDocs, analysisDeps))]
      } catch (err: any) {
        await repo.updateJobStatus(workspaceId, jobId, 'failed', {
          errorMessage: err?.message || 'AI analysis failed',
        })
        await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'failed', source.revision)
        throw err
      }
    }

    // Check revision before persist candidates
    const sourceFinal = await repo.loadSource(workspaceId, job.sourceId)
    const finalCheck = validateSourceLeaseAndConsent(sourceFinal, job.sourceRevision, getNow())
    if (!finalCheck.valid) {
      await repo.updateJobStatus(workspaceId, jobId, 'cancelled', {
        errorMessage: `Source invalidated before persisting candidates: ${finalCheck.reason}`,
      })
      await options.updateSourceCollectionStatus?.(workspaceId, source.sourceId, 'cancelled', source.revision)
      return { state: 'cancelled', details: { reason: finalCheck.reason } }
    }

    if (candidates.length > 0) {
      await repo.persistCandidates(workspaceId, source, candidates)
    }

    // Update source collection status to 'review_required' (or 'partial') via CAS
    const finalSourceStatus =
      candidates.length > 0 ? 'review_required' : collectedDocs.length > 0 ? 'partial' : 'partial'
    await options.updateSourceCollectionStatus?.(
      workspaceId,
      source.sourceId,
      finalSourceStatus,
      source.revision,
    )

    await repo.updateJobStatus(workspaceId, jobId, 'completed', {
      checkpoint: {
        documentCount: collectedDocs.length,
        candidateCount: candidates.length,
      },
    })

    return {
      state: 'completed',
      details: {
        documentCount: collectedDocs.length,
        candidateCount: candidates.length,
      },
    }
  }
}
