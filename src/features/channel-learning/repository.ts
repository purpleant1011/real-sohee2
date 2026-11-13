import {
  type CandidateCategory,
  type EvidenceLease,
  type LearningCandidate,
  type LearningDocument,
  LearningError,
  type LearningPlatform,
  type LearningPurpose,
  type LearningSource,
  type ReviewLearningCandidatesInput,
  type SourceRef,
} from './contracts'

export type ApprovedContextItem = Readonly<{
  id: string
  category: CandidateCategory
  content: string
  sourceType: 'manual' | 'channel'
  sourceId: string | null
  sourceRevision: number | null
}>

export type DurableJobRecord = Readonly<{
  id: string
  workspaceId: string
  sourceId: string
  sourceRevision: number
  kind: 'collect' | 'verify' | 'delete'
  idempotencyKey: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  attempt: number
  checkpoint: Record<string, unknown>
  /** Worker that currently holds the claim lease (null while queued / after a terminal transition). */
  leaseOwner?: string | null
  leaseExpiresAt?: string | null
  createdAt: string
  updatedAt: string
}>

export type JobTransitionDetails = {
  checkpoint?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
  /**
   * Worker id returned by claimJob. Required for any transition of a claimed job; the database
   * compare-and-swaps owner, lease expiry and current state. Without it only an unclaimed queued
   * job can be cancelled/failed.
   */
  leaseOwner?: string
}

export type LearningRepository = Readonly<{
  loadSource(workspaceId: string, sourceId: string): Promise<LearningSource | null>
  listSources(workspaceId: string): Promise<readonly LearningSource[]>
  registerSource(input: {
    workspaceId: string
    actorUserId: string
    platform: LearningPlatform
    canonicalUrl: string
    canonicalIdentity: string
    consent: { text: boolean; images: boolean }
  }): Promise<LearningSource>
  /**
   * Server-proven evidence write. One SQL transaction verifies: active source, current revision,
   * text consent, valid lease, lease-account authorship, actor (explicit, else the source creator)
   * is an active owner/manager. Documents are immutable versions: recollecting the same
   * provider/revision/hash requires the same stable document id.
   */
  persistDocuments(
    workspaceId: string,
    source: SourceRef,
    documents: readonly LearningDocument[],
    actorUserId?: string,
  ): Promise<void>
  persistCandidates(
    workspaceId: string,
    source: SourceRef,
    candidates: readonly LearningCandidate[],
    actorUserId?: string,
  ): Promise<void>
  loadCandidates(workspaceId: string, sourceId: string): Promise<readonly LearningCandidate[]>
  updateVerificationLease(input: {
    source: SourceRef
    lease: Omit<EvidenceLease, 'workspaceId' | 'sourceId' | 'revision'>
    actorUserId?: string
  }): Promise<EvidenceLease>
  reviewCandidates(
    actor: { userId: string; workspaceId: string },
    input: ReviewLearningCandidatesInput,
  ): Promise<void>
  revokeSource(
    actor: { userId: string; workspaceId: string },
    source: SourceRef,
  ): Promise<void>
  createJob(input: {
    workspaceId: string
    sourceId: string
    sourceRevision: number
    kind: 'collect' | 'verify' | 'delete'
    idempotencyKey: string
  }): Promise<DurableJobRecord>
  getJob(workspaceId: string, jobId: string): Promise<DurableJobRecord | null>
  /**
   * Atomically claims a queued job (or one whose lease expired) for `workerId`. Returns null when
   * another worker holds it, it is already finished, or its source was revoked/deleted/went stale
   * (such jobs are cancelled). Use the returned `leaseOwner` for every later transition.
   */
  claimJob(
    workspaceId: string,
    jobId: string,
    workerId: string,
    leaseSeconds?: number,
  ): Promise<DurableJobRecord | null>
  /** CAS transition. Throws LearningError JOB_LEASE_MISMATCH / JOB_LEASE_REQUIRED / JOB_STATE_CONFLICT. */
  updateJobStatus(
    workspaceId: string,
    jobId: string,
    status: DurableJobRecord['status'],
    details?: JobTransitionDetails,
  ): Promise<void>
  markSourceDeleted(
    actor: { userId: string; workspaceId: string },
    source: SourceRef,
  ): Promise<{ deletionJobId: string; status: 'pending' }>
  queryApprovedContext(input: {
    workspaceId: string
    purpose: LearningPurpose
    maxFacts?: number
    query?: string
  }): Promise<{
    items: readonly ApprovedContextItem[]
    epoch: number
    dependencies: readonly SourceRef[]
  }>
  validateResult(input: {
    workspaceId: string
    expectedEpoch: number
    dependencies: readonly SourceRef[]
    purpose?: LearningPurpose
  }): Promise<boolean>
}>

export type SupabaseQueryClient = {
  from(table: string): any
  rpc(fn: string, args: Record<string, unknown>): any
}

const FORBIDDEN_DB_CODES = [
  'FORBIDDEN_WORKSPACE_MEMBER',
  'FORBIDDEN_UNAUTHENTICATED',
  'FORBIDDEN_SERVER_ONLY',
  'ACTOR_MISMATCH',
  'ACTOR_REQUIRED',
] as const

// Codes raised by the SQL RPCs that callers are allowed to branch on. Anything else becomes the
// operation-specific fallback code (never swallowed).
const PASSTHROUGH_DB_CODES = [
  'STALE_SOURCE_REVISION',
  'STALE_EVIDENCE_REVISION',
  'STALE_CANDIDATE_VERSION',
  'STALE_CANDIDATE_REVISION',
  'STALE_DOCUMENT_REVISION',
  'SOURCE_NOT_FOUND',
  'SOURCE_PAUSED',
  'SOURCE_NOT_VERIFIED',
  'VALID_LEASE_REQUIRED',
  'LEASE_ACCOUNT_REQUIRED',
  'CONSENT_REQUIRED',
  'CONSENT_REVOKED',
  'IMAGE_CONSENT_REQUIRED',
  'DOCUMENT_ID_MISMATCH',
  'DOCUMENT_VERSION_CONFLICT',
  'DOCUMENT_AUTHOR_MISMATCH',
  'DOCUMENT_SOURCE_MISMATCH',
  'CANDIDATE_SOURCE_MISMATCH',
  'CANDIDATE_NOT_FOUND',
  'EVIDENCE_QUOTE_NOT_IN_DOCUMENT',
  'EVIDENCE_QUOTE_REQUIRED',
  'INVALID_CONFLICT_FACT',
  'CONFLICT_RESOLUTION_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'JOB_NOT_FOUND',
  'JOB_LEASE_MISMATCH',
  'JOB_LEASE_REQUIRED',
  'JOB_STATE_CONFLICT',
] as const

const EVIDENCE_INVALID_DB_CODES = ['DOCUMENT_EVIDENCE_REQUIRED', 'INVALID_DOCUMENT_EVIDENCE'] as const

function toLearningError(message: string | undefined, fallbackCode: string, fallbackText: string): LearningError {
  const msg = message ?? ''
  if (FORBIDDEN_DB_CODES.some((code) => msg.includes(code))) {
    return new LearningError('FORBIDDEN', '권한이 없습니다.')
  }
  if (EVIDENCE_INVALID_DB_CODES.some((code) => msg.includes(code))) {
    return new LearningError('INVALID_CANDIDATE_DATA', '후보의 원문 문서 증거가 유효하지 않습니다.')
  }
  const passthrough = PASSTHROUGH_DB_CODES.find((code) => msg.includes(code))
  if (passthrough) return new LearningError(passthrough, `${fallbackText}: ${passthrough}`)
  return new LearningError(fallbackCode, `${fallbackText}: ${msg}`)
}

function mapJobRow(row: any): DurableJobRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.knowledge_source_id,
    sourceRevision: row.source_revision,
    kind: row.job_kind,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempt: row.attempt ?? 0,
    checkpoint: row.checkpoint ?? {},
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Maps a knowledge_sources row and the lease row of its CURRENT evidence revision (expired or revoked
 * leases included) to the DTO. `verification` is derived so a stored 'verified' never outlives its lease:
 * revoked lease -> 'revoked', expired or missing lease -> 'expired'. Consumers still need to validate
 * `lease` themselves before trusting evidence.
 */
function mapSourceRow(row: any, leaseRow: any | null, now: Date = new Date()): LearningSource {
  const lease: EvidenceLease | null = leaseRow
    ? {
        workspaceId: leaseRow.workspace_id,
        sourceId: leaseRow.knowledge_source_id,
        revision: row.lifecycle_revision ?? 1,
        providerAccountId: leaseRow.provider_account_id,
        method: leaseRow.method,
        verifiedAt: leaseRow.verified_at,
        expiresAt: leaseRow.expires_at,
        revokedAt: leaseRow.revoked_at,
        evidenceRevision: leaseRow.evidence_revision,
      }
    : null

  let verification: LearningSource['verification'] = row.learning_verification_status ?? 'pending'
  if (verification === 'verified') {
    if (!lease) verification = 'expired'
    else if (lease.revokedAt) verification = 'revoked'
    else if (new Date(lease.expiresAt) <= now) verification = 'expired'
  }

  return {
    workspaceId: row.workspace_id,
    sourceId: row.id,
    revision: row.lifecycle_revision ?? 1,
    platform: row.channel_type,
    canonicalUrl: row.uri,
    canonicalIdentity: row.display_name,
    verification,
    collection: row.learning_collection_status ?? 'queued',
    lease,
    consent: {
      text: Boolean(row.consent_text),
      images: Boolean(row.consent_images),
      revision: row.consent_revision ?? 1,
    },
    deletedAt: null,
  }
}

function firstRow(data: unknown): any | null {
  const row = Array.isArray(data) ? data[0] : data
  return row ?? null
}

function createProductionLearningRepository(client: SupabaseQueryClient): LearningRepository {
  return {
    async loadSource(workspaceId: string, sourceId: string): Promise<LearningSource | null> {
      const { data, error } = await client
        .from('knowledge_sources')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', sourceId)
        .eq('is_learning_source', true)
        .is('deleted_at', null)
        .maybeSingle()

      if (error) {
        throw new LearningError('QUERY_FAILED', `출처 조회 실패: ${error.message}`)
      }
      if (!data) return null

      // Latest lease of the CURRENT evidence revision, including expired/revoked ones: the DTO must keep
      // evidenceRevision and the previous provider account so re-verification can use evidenceRevision+1.
      // Whether the lease is still usable is expressed through the derived `verification` status.
      const { data: leaseData, error: leaseError } = await client
        .from('learning_evidence_leases')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('knowledge_source_id', sourceId)
        .eq('evidence_revision', data.evidence_revision)
        .order('evidence_revision', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (leaseError) {
        throw new LearningError('QUERY_FAILED', `증거 리스 조회 실패: ${leaseError.message}`)
      }

      return mapSourceRow(data, leaseData ?? null)
    },

    async listSources(workspaceId: string): Promise<readonly LearningSource[]> {
      const { data, error } = await client
        .from('knowledge_sources')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_learning_source', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (error) {
        throw new LearningError('QUERY_FAILED', `출처 목록 조회 실패: ${error.message}`)
      }
      // A malformed/empty-without-array response is a failure, never "no sources".
      if (!Array.isArray(data)) {
        throw new LearningError('QUERY_FAILED', '출처 목록 응답이 올바르지 않습니다.')
      }
      if (data.length === 0) return []

      // One lease query for all sources (fail-closed on error or malformed result).
      const { data: leaseRows, error: leaseError } = await client
        .from('learning_evidence_leases')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('knowledge_source_id', data.map((row: any) => row.id))

      if (leaseError) {
        throw new LearningError('QUERY_FAILED', `출처 리스 조회 실패: ${leaseError.message}`)
      }
      if (!Array.isArray(leaseRows)) {
        throw new LearningError('QUERY_FAILED', '출처 리스 응답이 올바르지 않습니다.')
      }

      return data.map((row: any) =>
        mapSourceRow(
          row,
          leaseRows.find(
            (lease: any) => lease.knowledge_source_id === row.id && lease.evidence_revision === row.evidence_revision,
          ) ?? null,
        ),
      )
    },

    async registerSource(input): Promise<LearningSource> {
      // refresh_policy satisfies existing constraint knowledge_sources_url_collection_contract_check
      // using connection_required so legacy url collection runner does not pick it up.
      const { data, error } = await client
        .from('knowledge_sources')
        .insert({
          workspace_id: input.workspaceId,
          created_by_user_id: input.actorUserId,
          source_type: 'url',
          provider_mode: 'registered_only',
          channel_type: input.platform,
          uri: input.canonicalUrl,
          display_name: input.canonicalIdentity,
          status: 'registered',
          is_learning_source: true,
          lifecycle_revision: 1,
          evidence_revision: 0,
          consent_revision: 1,
          consent_text: input.consent.text,
          consent_images: input.consent.images,
          learning_verification_status: 'pending',
          learning_collection_status: 'queued',
          refresh_policy: {
            ownership: 'owned',
            allowedUse: 'business_facts',
            requestedScope: 'posts',
            collectionState: 'connection_required',
            verifiedOwnership: false,
          },
        })
        .select('*')
        .single()

      if (error || !data) {
        throw new LearningError('REGISTER_FAILED', `출처 등록 실패: ${error?.message}`)
      }

      return {
        workspaceId: data.workspace_id,
        sourceId: data.id,
        revision: data.lifecycle_revision ?? 1,
        platform: data.channel_type,
        canonicalUrl: data.uri,
        canonicalIdentity: data.display_name,
        verification: 'pending',
        collection: 'queued',
        lease: null,
        consent: {
          text: Boolean(data.consent_text),
          images: Boolean(data.consent_images),
          revision: data.consent_revision ?? 1,
        },
        deletedAt: null,
      }
    },

    async persistDocuments(workspaceId, source, documents, actorUserId): Promise<void> {
      if (documents.length === 0) return

      // Atomic RPC: source lock, revision CAS, consent, lease, authorship and actor membership in one transaction.
      // Without an explicit actor the database derives the source creator and still requires an active owner/manager.
      const { error } = await client.rpc('persist_learning_documents_atomic', {
        p_workspace_id: workspaceId,
        p_source_id: source.sourceId,
        p_expected_revision: source.revision,
        p_documents: documents,
        p_actor_user_id: actorUserId ?? null,
      })

      if (error) {
        throw toLearningError(error.message, 'PERSIST_DOCUMENTS_FAILED', '문서 저장 실패')
      }
    },

    async persistCandidates(workspaceId, source, candidates, actorUserId): Promise<void> {
      if (candidates.length === 0) return

      // The database verifies the actor (explicit, else the source creator) is an active owner/manager;
      // the application no longer pre-reads the creator, which removed a TOCTOU window.
      const { error } = await client.rpc('persist_learning_candidates_atomic', {
        p_workspace_id: workspaceId,
        p_source_id: source.sourceId,
        p_expected_revision: source.revision,
        p_candidates: candidates,
        p_actor_user_id: actorUserId ?? null,
      })

      if (error) {
        throw toLearningError(error.message, 'PERSIST_CANDIDATES_FAILED', '후보 저장 실패')
      }
    },

    async loadCandidates(workspaceId, sourceId): Promise<readonly LearningCandidate[]> {
      // Legacy manual/file sources share knowledge_candidates; only learning sources may be read here.
      const { data: sourceRow, error: sourceError } = await client
        .from('knowledge_sources')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', sourceId)
        .eq('is_learning_source', true)
        .is('deleted_at', null)
        .maybeSingle()

      if (sourceError) {
        throw new LearningError('QUERY_FAILED', `출처 조회 실패: ${sourceError.message}`)
      }
      if (!sourceRow) {
        throw new LearningError('SOURCE_NOT_FOUND', '학습 출처를 찾을 수 없습니다.')
      }

      const { data, error } = await client
        .from('knowledge_candidates')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('knowledge_source_id', sourceId)
        .order('created_at', { ascending: false })

      if (error) {
        throw new LearningError('QUERY_FAILED', `후보 목록 조회 실패: ${error.message}`)
      }
      if (!Array.isArray(data)) {
        throw new LearningError('QUERY_FAILED', '후보 목록 응답이 올바르지 않습니다.')
      }

      return data.map((row: any) => {
        // Only the FK-enforced evidence document id is evidence; legacy free-text source_location is not.
        const documentId = row.evidence_document_id
        if (!documentId) {
          throw new LearningError('INVALID_CANDIDATE_DATA', '후보의 원문 문서 증거 ID가 누락되었습니다.')
        }

        return {
          id: row.id,
          source: {
            workspaceId,
            sourceId,
            revision: row.source_revision ?? 1,
          },
          version: row.version ?? 1,
          category: row.category,
          content: row.content,
          evidence: {
            documentId,
            excerpt: row.source_excerpt ?? null,
            visionReceiptId: row.evidence_vision_receipt_id ?? null,
          },
          evidenceState: row.evidence_state ?? 'observed',
          status: row.status,
          conflictsWithFactId: row.conflicts_with_fact_id ?? null,
        }
      })
    },

    async updateVerificationLease(input): Promise<EvidenceLease> {
      const { source, lease } = input

      // Single atomic RPC transaction
      const { error } = await client.rpc('update_learning_verification_lease_atomic', {
        p_workspace_id: source.workspaceId,
        p_source_id: source.sourceId,
        p_expected_source_revision: source.revision,
        p_evidence_revision: lease.evidenceRevision,
        p_provider_account_id: lease.providerAccountId,
        p_method: lease.method,
        p_verified_at: lease.verifiedAt,
        p_expires_at: lease.expiresAt,
        p_actor_user_id: input.actorUserId ?? null,
      })

      if (error) {
        throw toLearningError(error.message, 'UPDATE_LEASE_FAILED', '증거 리스 갱신 실패')
      }

      return {
        ...source,
        ...lease,
      }
    },

    async reviewCandidates(actor, input): Promise<void> {
      const { error } = await client.rpc('review_learning_candidates_atomic', {
        p_workspace_id: actor.workspaceId,
        p_source_id: input.source.sourceId,
        p_expected_source_revision: input.source.revision,
        p_expected_evidence_revision: input.evidenceRevision,
        p_actor_user_id: actor.userId,
        p_decisions: input.decisions,
      })

      if (error) {
        throw toLearningError(error.message, 'REVIEW_FAILED', '검토 처리 실패')
      }
    },

    async revokeSource(actor, source): Promise<void> {
      const { error } = await client.rpc('revoke_learning_source_atomic', {
        p_workspace_id: actor.workspaceId,
        p_source_id: source.sourceId,
        p_expected_revision: source.revision,
        p_actor_user_id: actor.userId,
      })

      if (error) {
        throw toLearningError(error.message, 'REVOKE_FAILED', '출처 철회 실패')
      }
    },

    async createJob(input): Promise<DurableJobRecord> {
      // Atomic RPC: locks the source, rejects revoked/deleted/paused/stale-revision collect|verify jobs,
      // and resolves idempotency (same spec => same job, different spec => IDEMPOTENCY_CONFLICT).
      const { data, error } = await client.rpc('create_learning_job_atomic', {
        p_workspace_id: input.workspaceId,
        p_source_id: input.sourceId,
        p_source_revision: input.sourceRevision,
        p_job_kind: input.kind,
        p_idempotency_key: input.idempotencyKey,
      })

      if (error) {
        throw toLearningError(error.message, 'JOB_CREATE_FAILED', '작업 생성 실패')
      }
      const row = firstRow(data)
      if (!row) {
        throw new LearningError('JOB_CREATE_FAILED', '작업 생성 결과가 비어 있습니다.')
      }
      return mapJobRow(row)
    },

    async claimJob(workspaceId, jobId, workerId, leaseSeconds = 300): Promise<DurableJobRecord | null> {
      const { data, error } = await client.rpc('claim_learning_job_atomic', {
        p_workspace_id: workspaceId,
        p_job_id: jobId,
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      })

      if (error) {
        throw toLearningError(error.message, 'JOB_CLAIM_FAILED', '작업 클레임 실패')
      }
      if (!Array.isArray(data)) {
        throw new LearningError('JOB_CLAIM_FAILED', '작업 클레임 응답이 올바르지 않습니다.')
      }
      const row = data[0]
      return row ? mapJobRow(row) : null
    },

    async getJob(workspaceId, jobId): Promise<DurableJobRecord | null> {
      const { data, error } = await client
        .from('learning_jobs')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', jobId)
        .maybeSingle()

      if (error) {
        throw new LearningError('QUERY_FAILED', `작업 조회 실패: ${error.message}`)
      }
      if (!data) return null

      return mapJobRow(data)
    },

    async updateJobStatus(workspaceId, jobId, status, details): Promise<void> {
      // CAS in SQL: owner + lease expiry + current state. Unconditional updates are no longer possible.
      const { error } = await client.rpc('update_learning_job_atomic', {
        p_workspace_id: workspaceId,
        p_job_id: jobId,
        p_status: status,
        p_lease_owner: details?.leaseOwner ?? null,
        p_checkpoint: details?.checkpoint ?? null,
        p_error_code: details?.errorCode ?? null,
        p_error_message: details?.errorMessage ?? null,
      })

      if (error) {
        throw toLearningError(error.message, 'JOB_UPDATE_FAILED', '작업 상태 갱신 실패')
      }
    },

    async markSourceDeleted(actor, source): Promise<{ deletionJobId: string; status: 'pending' }> {
      // Single atomic RPC transaction
      const { data, error } = await client.rpc('delete_learning_source_atomic', {
        p_workspace_id: actor.workspaceId,
        p_source_id: source.sourceId,
        p_expected_revision: source.revision,
        p_actor_user_id: actor.userId,
        p_idempotency_key: `delete:${source.sourceId}:${source.revision + 1}`,
      })

      if (error) {
        throw toLearningError(error.message, 'DELETE_FAILED', '출처 삭제 처리 실패')
      }

      const row = Array.isArray(data) ? data[0] : data
      if (!row || !row.deletion_job_id) {
        throw new LearningError('DELETE_FAILED', '삭제 작업 식별자 생성 실패')
      }

      return { deletionJobId: row.deletion_job_id, status: 'pending' }
    },

    async queryApprovedContext(input): Promise<{
      items: readonly ApprovedContextItem[]
      epoch: number
      dependencies: readonly SourceRef[]
    }> {
      const { data, error } = await client.rpc('get_approved_learning_context', {
        p_workspace_id: input.workspaceId,
        p_purpose: input.purpose,
        p_max_facts: input.maxFacts ?? 32,
        p_query: input.query ?? '',
      })

      if (error) {
        throw new LearningError('QUERY_FAILED', `승인 지식 조회 실패: ${error.message}`)
      }
      // A malformed result must never be treated as "no approved knowledge" (fail closed).
      if (!Array.isArray(data)) {
        throw new LearningError('QUERY_FAILED', '승인 지식 응답이 올바르지 않습니다.')
      }

      const items: ApprovedContextItem[] = data.map((d: any) => ({
        id: d.id,
        category: d.category,
        content: d.content,
        sourceType: d.source_type,
        sourceId: d.source_id,
        sourceRevision: d.source_revision,
      }))
      const epoch = data[0]?.epoch ?? 1

      // A fact may derive from several leaf sources: return every leaf (deduped) so any leaf change
      // invalidates the cache. Fall back to the representative source only for rows without the list.
      const seen = new Set<string>()
      const dependencies: SourceRef[] = []
      const addDependency = (sourceId: unknown, revision: unknown) => {
        if (typeof sourceId !== 'string' || typeof revision !== 'number') return
        const key = `${sourceId}:${revision}`
        if (seen.has(key)) return
        seen.add(key)
        dependencies.push({ workspaceId: input.workspaceId, sourceId, revision })
      }
      for (const d of data) {
        if (Array.isArray(d.dependencies) && d.dependencies.length > 0) {
          for (const dep of d.dependencies) addDependency(dep?.sourceId, dep?.revision)
        } else {
          addDependency(d.source_id, d.source_revision)
        }
      }
      return { items, epoch, dependencies }
    },

    async validateResult(input): Promise<boolean> {
      const { data, error } = await client.rpc('validate_learning_result', {
        p_workspace_id: input.workspaceId,
        p_expected_epoch: input.expectedEpoch,
        p_dependencies: input.dependencies,
        p_purpose: input.purpose ?? 'content',
      })
      if (error || typeof data !== 'boolean') return false
      return data
    },
  }
}

export function createLearningRepository(client: SupabaseQueryClient): LearningRepository {
  if (!client || typeof client !== 'object' || !('from' in client) || !('rpc' in client)) {
    throw new Error('Valid Supabase client is required to create LearningRepository')
  }
  return createProductionLearningRepository(client)
}
