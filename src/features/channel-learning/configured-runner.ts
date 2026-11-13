import crypto from 'node:crypto'
import { z } from 'zod'
import {
  LearningError,
  type LearningSource,
  type SourceRef,
} from './contracts'
import type { DurableJobRecord, LearningRepository, SupabaseQueryClient } from './repository'
import { createLearningRepository } from './repository'
import {
  createProductionLearningRunner,
  type LearningQueueEnvelope,
  type ProductionOAuthCredential,
} from './runtime-runner'
import { verifyLearningOwnership, type OAuthCredentialData } from './ownership'
import { renewLearningVerification } from './verification-renewal'
import { fetchLearningProvider, type FetchLearningProviderInput } from './provider-fetch'
import { createOwnedMediaFetcher } from './provider-media'
import { createLearningAiProvider, type ReceiptInput } from './ai-provider'
import { createDurableLearningBilling } from './durable-billing'
import { type RetentionDeps } from './retention'
import type { CreditRateCatalog } from '@/features/credits/types'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const providerMeSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1).optional(),
  username: z.string().min(1),
})

export interface ConfiguredRunnerInternalDeps {
  adminClient?: SupabaseQueryClient
  repository?: LearningRepository
  workerId?: string
  now?: () => Date
  enabled?: boolean
  rateCatalog?: CreditRateCatalog
  getCredential?: (
    workspaceId: string,
    platform: 'instagram' | 'threads',
  ) => Promise<OAuthCredentialData | null>
  fetchLearningProvider?: (input: FetchLearningProviderInput) => Promise<unknown>
  fetchProviderMe?: (
    platform: 'instagram' | 'threads',
    accessToken: string,
  ) => Promise<{ id: string; username: string }>
  aiExtractor?: {
    extractFacts: (input: { text: string; source: SourceRef }) => Promise<any[]>
    analyzeVision?: (input: { images: Array<{ mediaId: string; url: string }>; source: SourceRef }) => Promise<any[]>
  }
  billingGateway?: any
  retentionDeps?: RetentionDeps
  claimJobCAS?: (input: {
    workspaceId: string
    jobId: string
    expectedStatus: 'queued'
  }) => Promise<DurableJobRecord | null>
  verificationRenewal?: (
    source: LearningSource,
    deps: { now?: () => Date },
  ) => Promise<{ state: string; [key: string]: any }>
}

/**
 * Top-level configured entrypoint for Cloudflare queue messages.
 * Wires real DB CAS, encrypted credentials, provider boundaries,
 * Gemini AI analysis with receipts, and FinOps billing.
 */
export async function runConfiguredLearningJob(
  envelope: LearningQueueEnvelope,
  env: Record<string, unknown> = {},
  internalDeps: ConfiguredRunnerInternalDeps = {},
): Promise<{ state: string; details?: any }> {
  // 1. Envelope validation
  if (
    !envelope ||
    !['knowledge_collect', 'knowledge_verify', 'knowledge_delete'].includes(envelope.kind) ||
    !envelope.workspaceId ||
    !envelope.jobId
  ) {
    throw new LearningError('INVALID_ENVELOPE', 'Envelope missing required kind, workspaceId, or jobId')
  }

  const { workspaceId, jobId, kind } = envelope
  const getNow = internalDeps.now ?? (() => new Date())
  const workerId = internalDeps.workerId ?? crypto.randomUUID()

  // 2. Resolve admin client & base repository
  const admin: SupabaseQueryClient = internalDeps.adminClient ?? (createAdminSupabaseClient() as any)
  const baseRepo: LearningRepository = internalDeps.repository ?? createLearningRepository(admin)

  let isClaimed = false

  // 3. Scoped repo wrapper: automatically injects leaseOwner = workerId for all transitions while claimed
  const scopedRepo: LearningRepository = {
    ...baseRepo,
    claimJob: async (wsId, jId, wId, leaseSec) => {
      const claimed = await baseRepo.claimJob(wsId, jId, wId, leaseSec)
      if (claimed) isClaimed = true
      return claimed
    },
    updateJobStatus: async (wsId, jId, status, details) => {
      const leaseOwner = details?.leaseOwner !== undefined
        ? details.leaseOwner
        : (isClaimed ? workerId : undefined)
      return baseRepo.updateJobStatus(wsId, jId, status, {
        ...details,
        leaseOwner,
      })
    },
  }

  // 4. Fetch durable job for pre-flight assertions
  const job = await scopedRepo.getJob(workspaceId, jobId)
  if (!job) {
    return { state: 'not_found' }
  }

  if (job.workspaceId !== workspaceId) {
    throw new LearningError('TENANT_MISMATCH', 'Job workspaceId does not match envelope workspaceId')
  }

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

  // Terminal state idempotency: 0 provider calls
  if (job.status === 'completed' || job.status === 'cancelled') {
    return { state: job.status }
  }

  // 5. Flags and configuration checks
  const isEnabled =
    internalDeps.enabled ??
    ((env.SOHEE_CHANNEL_LEARNING_ENABLED ?? process.env.SOHEE_CHANNEL_LEARNING_ENABLED) === '1')

  let rateCatalog = internalDeps.rateCatalog
  if (!rateCatalog) {
    const rawCatalog =
      (env.SOHEE_SOURCE_ANALYSIS_RATE_CATALOG as string | undefined) ??
      process.env.SOHEE_SOURCE_ANALYSIS_RATE_CATALOG
    if (rawCatalog) {
      try {
        rateCatalog = JSON.parse(rawCatalog)
      } catch {
        rateCatalog = undefined
      }
    }
  }

  const geminiApiKey =
    (env.GEMINI_API_KEY as string | undefined) ??
    process.env.GEMINI_API_KEY

  // For knowledge_collect, strictly enforce feature flag, rate catalog, and AI pipeline
  if (kind === 'knowledge_collect') {
    if (!isEnabled) {
      await scopedRepo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'CAPABILITY_BLOCKED',
        errorMessage: 'Channel learning collection is disabled',
      })
      return { state: 'blocked', details: { reason: 'CAPABILITY_BLOCKED' } }
    }

    if (!rateCatalog) {
      await scopedRepo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'FINOPS_RATE_NOT_CONFIGURED',
        errorMessage: 'Source analysis rate catalog is not configured',
      })
      return { state: 'blocked', details: { reason: 'FINOPS_RATE_NOT_CONFIGURED' } }
    }

    if (!geminiApiKey && !internalDeps.aiExtractor) {
      await scopedRepo.updateJobStatus(workspaceId, jobId, 'failed', {
        errorCode: 'AI_PIPELINE_BLOCKED',
        errorMessage: 'GEMINI_API_KEY is not configured',
      })
      return { state: 'blocked', details: { reason: 'AI_PIPELINE_BLOCKED' } }
    }
  }

  // 6. Adapters: credential & provider fetch
  const fetchProvider = internalDeps.fetchLearningProvider ?? fetchLearningProvider

  const loadCredential = async (
    ws: string,
    platform: 'instagram' | 'threads',
  ): Promise<OAuthCredentialData | null> => {
    if (internalDeps.getCredential) {
      const cred = await internalDeps.getCredential(ws, platform)
      if (!cred || !cred.accessToken || !cred.providerAccountId) return null
      return cred
    }
    const { loadChannelCredentialByChannel } = await import('@/features/channels/credential-repository')
    const encryptionKey =
      (env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY as string | undefined) ??
      process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY ??
      ''
    const credential = await loadChannelCredentialByChannel(ws, platform, undefined, encryptionKey, 'read')
    if (!credential || !credential.accessToken || !credential.externalAccountId) return null
    return {
      accessToken: credential.accessToken,
      scopes: [...credential.grantedScopes],
      providerAccountId: credential.externalAccountId,
      expiresAt: credential.expiresAt ?? undefined,
    }
  }

  const fetchProviderMe =
    internalDeps.fetchProviderMe ??
    (async (platform: 'instagram' | 'threads', accessToken: string) => {
      const raw = await fetchProvider({
        provider: platform,
        path: '/me',
        accessToken,
        maxBytes: 64 * 1024,
        query: { fields: platform === 'instagram' ? 'id,user_id,username' : 'id,username' },
      })
      const parsed = providerMeSchema.parse(raw)
      return { id: parsed.user_id ?? parsed.id, username: parsed.username }
    })

  // 7. Verify fresh subject before collection (live /me check)
  const verifyFreshSubject = async (
    source: LearningSource,
    credential: ProductionOAuthCredential,
  ): Promise<{ valid: boolean; code?: string; reason?: string }> => {
    try {
      const me = await fetchProviderMe(source.platform as 'instagram' | 'threads', credential.accessToken)
      if (credential.providerAccountId && credential.providerAccountId !== me.id) {
        return {
          valid: false,
          code: 'OAUTH_SUBJECT_MISMATCH',
          reason: `Token account ID (${credential.providerAccountId}) does not match live /me ID (${me.id})`,
        }
      }
      if (me.username.toLowerCase() !== source.canonicalIdentity.toLowerCase()) {
        return {
          valid: false,
          code: 'IDENTITY_MISMATCH',
          reason: `Live username (${me.username}) does not match source identity (${source.canonicalIdentity})`,
        }
      }
      if (source.lease?.providerAccountId && source.lease.providerAccountId !== me.id) {
        return {
          valid: false,
          code: 'IDENTITY_REASSIGNED',
          reason: 'Provider account ID changed for the same username',
        }
      }
      return { valid: true }
    } catch (err: any) {
      const status = err?.status
      const msg = (err?.message || '').toLowerCase()
      const isAuthLost =
        status === 401 || status === 403 || /unauthorized|forbidden|token expired|invalid token/i.test(msg)
      const isTransient =
        status === 429 ||
        (typeof status === 'number' && status >= 500 && status < 600) ||
        /timeout|network|econnrefused|fetch failed/i.test(msg)

      if (isAuthLost) {
        try {
          const { data: sourceRow } = await admin
            .from('knowledge_sources')
            .select('created_by_user_id')
            .eq('workspace_id', source.workspaceId)
            .eq('id', source.sourceId)
            .maybeSingle()
          const actorUserId = sourceRow?.created_by_user_id
          if (actorUserId) {
            await scopedRepo.revokeSource(
              { userId: actorUserId, workspaceId: source.workspaceId },
              { workspaceId: source.workspaceId, sourceId: source.sourceId, revision: source.revision },
            )
          }
        } catch (revokeErr) {
          console.error('Failed to revoke source on live auth loss:', revokeErr)
        }
        return {
          valid: false,
          code: 'AUTH_LOST',
          reason: 'OAuth authorization lost or expired; source revoked',
        }
      }

      if (isTransient) {
        return {
          valid: false,
          code: 'TRANSIENT_ERROR',
          reason: 'Live provider /me temporarily unavailable due to network or rate limit',
        }
      }

      return {
        valid: false,
        code: 'IDENTITY_MISMATCH',
        reason: err?.message || 'Fresh provider /me verification failed',
      }
    }
  }

  // 8. Provider media fetcher wrapper: normalizes Threads (/me/threads) and Instagram (/me/media)
  const providerFetchWrapper = async (req: {
    provider: 'instagram' | 'threads'
    path: string
    accessToken: string
    maxBytes?: number
    query?: Record<string, string>
  }): Promise<any> => {
    const source = await scopedRepo.loadSource(workspaceId, job.sourceId)
    const accountId = source?.lease?.providerAccountId || ''
    const username = source?.canonicalIdentity || ''

    const ownedFetcher = createOwnedMediaFetcher({
      platform: req.provider,
      accountId,
      username,
      fetchProvider,
    })

    return ownedFetcher({
      provider: req.provider,
      path: req.path,
      accessToken: req.accessToken,
      maxBytes: req.maxBytes ?? 2 * 1024 * 1024,
      query: req.query,
    })
  }

  // 9. AI Extractor & Billing Gateway
  let aiExtractor = internalDeps.aiExtractor
  if (!aiExtractor && geminiApiKey) {
    const aiModel =
      (env.GEMINI_ACTION_MODEL as string | undefined) ??
      process.env.GEMINI_ACTION_MODEL ??
      'gemini-3.8-flash'

    aiExtractor = createLearningAiProvider({
      apiKey: geminiApiKey,
      model: aiModel,
      recordReceipt: async (receiptInput: ReceiptInput) => {
        if (
          receiptInput.workspaceId !== job.workspaceId ||
          receiptInput.sourceId !== job.sourceId ||
          receiptInput.sourceRevision !== job.sourceRevision
        ) {
          throw new LearningError('RECEIPT_TENANT_MISMATCH', 'Receipt workspace/source/revision mismatch')
        }

        const { data, error } = await admin.rpc('record_learning_provider_receipt', {
          p_workspace_id: receiptInput.workspaceId,
          p_source_id: receiptInput.sourceId,
          p_source_revision: receiptInput.sourceRevision,
          p_provider_response_id: receiptInput.providerResponseId,
          p_model: receiptInput.model,
          p_kind: receiptInput.kind,
          p_input_hash: receiptInput.inputHash,
          p_media_refs: receiptInput.mediaRefs,
          p_usage: receiptInput.usage,
        })

        if (error) {
          throw new LearningError('RECORD_RECEIPT_FAILED', `Failed to record AI receipt: ${error.message}`)
        }

        const receiptId = String(data)

        // Send patch-only checkpoint without spreading stale initial snapshot
        await scopedRepo.updateJobStatus(job.workspaceId, job.id, 'running', {
          checkpoint: {
            lastReceiptId: receiptId,
            lastReceiptKind: receiptInput.kind,
            lastReceiptAt: getNow().toISOString(),
          },
        })

        return { id: receiptId }
      },
    })
  }

  // Lazy billing gateway: loads fresh checkpoint after claim to block re-claimed duplicate execution
  const getBillingGateway = async () => {
    if (internalDeps.billingGateway) return internalDeps.billingGateway
    if (!rateCatalog) return undefined
    const latestJob = await scopedRepo.getJob(job.workspaceId, job.id)
    return createDurableLearningBilling({
      workspaceId: job.workspaceId,
      jobId: job.id,
      gateway: admin,
      catalog: rateCatalog,
      initialState: latestJob?.checkpoint?.billing as any,
      recordState: async (billingState) => {
        // Send patch-only checkpoint without spreading stale initial snapshot
        await scopedRepo.updateJobStatus(job.workspaceId, job.id, 'running', {
          checkpoint: {
            billing: billingState,
          },
        })
      },
    })
  }

  let resolvedBillingGateway: any = null
  const lazyBillingGateway = {
    async quote(operation: string, units: number) {
      if (!resolvedBillingGateway) resolvedBillingGateway = await getBillingGateway()
      if (!resolvedBillingGateway) return { allowed: false, reason: 'FINOPS_RATE_NOT_CONFIGURED' }
      return resolvedBillingGateway.quote(operation, units)
    },
    async reserve(quoteId: string) {
      if (!resolvedBillingGateway) resolvedBillingGateway = await getBillingGateway()
      if (!resolvedBillingGateway) throw new LearningError('BILLING_BLOCKED', 'Billing gateway not initialized')
      return resolvedBillingGateway.reserve(quoteId)
    },
    async settle(id: string) {
      if (!resolvedBillingGateway) resolvedBillingGateway = await getBillingGateway()
      if (!resolvedBillingGateway) throw new LearningError('BILLING_BLOCKED', 'Billing gateway not initialized')
      return resolvedBillingGateway.settle(id)
    },
    async release(id: string) {
      if (!resolvedBillingGateway) resolvedBillingGateway = await getBillingGateway()
      if (!resolvedBillingGateway) throw new LearningError('BILLING_BLOCKED', 'Billing gateway not initialized')
      return resolvedBillingGateway.release(id)
    },
  }

  // 10. Verification renewal adapter (for knowledge_verify)
  const verificationRenewal =
    internalDeps.verificationRenewal ??
    (async (source: LearningSource, renewalDeps: { now?: () => Date }) => {
      const now = renewalDeps.now ? renewalDeps.now() : getNow()

      const renewalResult = await renewLearningVerification(source, {
        now: () => now,
        verifyOwnership: async (src) => {
          return verifyLearningOwnership(src, {
            now: () => now,
            getOAuthCredential: loadCredential,
            fetchProviderMe,
          })
        },
      })

      if (renewalResult.state === 'renewed' && renewalResult.lease) {
        // CAS save fresh lease into repository
        await scopedRepo.updateVerificationLease({
          source: {
            workspaceId: source.workspaceId,
            sourceId: source.sourceId,
            revision: source.revision,
          },
          lease: {
            providerAccountId: renewalResult.lease.providerAccountId,
            method: renewalResult.lease.method,
            verifiedAt: renewalResult.lease.verifiedAt,
            expiresAt: renewalResult.lease.expiresAt,
            revokedAt: renewalResult.lease.revokedAt,
            evidenceRevision: renewalResult.lease.evidenceRevision,
          },
        })
        return { state: 'renewed', lease: renewalResult.lease }
      }

      if (renewalResult.state === 'revoked') {
        // Lookup creator of source to act as authorized actor
        const { data: sourceRow } = await admin
          .from('knowledge_sources')
          .select('created_by_user_id')
          .eq('workspace_id', source.workspaceId)
          .eq('id', source.sourceId)
          .maybeSingle()

        const actorUserId = sourceRow?.created_by_user_id
        if (actorUserId) {
          await scopedRepo.revokeSource(
            { userId: actorUserId, workspaceId: source.workspaceId },
            { workspaceId: source.workspaceId, sourceId: source.sourceId, revision: source.revision },
          )
        }
        return { state: 'revoked' }
      }

      if (renewalResult.state === 'retry') {
        return { state: 'retry', nextCheckAt: renewalResult.nextCheckAt }
      }

      return { state: 'expired' }
    })

  // 11. Create and invoke production runner
  const runner = createProductionLearningRunner(admin, {
    repository: scopedRepo,
    now: getNow,
    claimJobCAS:
      internalDeps.claimJobCAS ??
      (async ({ workspaceId: ws, jobId: jId }) => {
        return scopedRepo.claimJob(ws, jId, workerId, 300)
      }),
    updateSourceCollectionStatus: async (ws, srcId, status, expectedRevision) => {
      const { data, error } = await admin
        .from('knowledge_sources')
        .update({
          learning_collection_status: status,
          updated_at: getNow().toISOString(),
        })
        .eq('workspace_id', ws)
        .eq('id', srcId)
        .eq('lifecycle_revision', expectedRevision)
        .select('id')

      if (error) {
        throw new LearningError('DATABASE_ERROR', `Failed to update collection status: ${error.message}`)
      }
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new LearningError('STALE_SOURCE_REVISION', 'Source revision mismatch when updating collection status')
      }
    },
    getCredential: loadCredential,
    providerFetch: providerFetchWrapper,
    verifyFreshSubject,
    aiExtractor,
    billingGateway: lazyBillingGateway,
    retentionDeps: internalDeps.retentionDeps ?? { dbClient: admin },
    verificationRenewal,
  })

  return runner(envelope)
}
