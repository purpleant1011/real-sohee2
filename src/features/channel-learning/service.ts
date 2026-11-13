import { LearningError, type Capability, type EvidenceLease, type LearningSource } from './contracts'
import type { LearningRepository } from './repository'
import { LearningHttpError, type LearningActor, type LearningOperation } from './http'
import { registerLearningSource } from './source-service'
import { reviewLearningCandidates } from './review-service'
import { deleteLearningSource, revokeLearningSource } from './deletion-service'

export type LearningServiceAdapters = {
  normalizeUrl(platform: LearningSource['platform'], url: string): { canonicalIdentity: string; canonicalUrl: string }
  getCapabilities(): readonly Capability[]
  verify?(source: LearningSource, actor: LearningActor): Promise<EvidenceLease>
  enqueue?(source: LearningSource, actor: LearningActor, kind: 'collect' | 'delete'): Promise<{ jobId: string }>
}

function safeError(error: unknown): LearningHttpError {
  if (error instanceof LearningHttpError) return error
  const code = error instanceof LearningError ? error.code : ''
  if (code.includes('STALE') || code.includes('VERSION')) return new LearningHttpError('STALE_REVISION')
  if (code.includes('NOT_FOUND')) return new LearningHttpError('NOT_FOUND')
  if (code === 'FORBIDDEN') return new LearningHttpError('FORBIDDEN')
  if (code === 'OAUTH_NOT_CONNECTED' || code === 'INSUFFICIENT_SCOPES') {
    return new LearningHttpError('CONNECTION_REQUIRED')
  }
  if (
    code === 'CAPABILITY_BLOCKED' ||
    code === 'POLICY_DISABLED' ||
    code === 'VERIFICATION_NOT_SUPPORTED'
  ) {
    return new LearningHttpError('CAPABILITY_BLOCKED')
  }
  return new LearningHttpError('UNAVAILABLE')
}

/** Application boundary; no fixture repository is constructed here or on missing production configuration. */
export function createLearningService(repository: LearningRepository, adapters: LearningServiceAdapters) {
  return async (operation: LearningOperation, actor: LearningActor, input: Record<string, unknown>): Promise<unknown> => {
    try {
      if (operation === 'list') {
        const sources = await repository.listSources(actor.workspaceId)
        if (sources.some((source) => source.workspaceId !== actor.workspaceId)) throw new LearningHttpError('FORBIDDEN')
        return { sources, capabilities: adapters.getCapabilities() }
      }
      if (!['owner', 'manager'].includes(actor.role) && operation !== 'detail') throw new LearningHttpError('FORBIDDEN')
      if (operation === 'register') {
        const source = await registerLearningSource(actor, input as Parameters<typeof registerLearningSource>[1], {
          repository, normalizeUrl: adapters.normalizeUrl, getCapabilities: adapters.getCapabilities,
        })
        return { source }
      }
      const sourceId = String(input.sourceId ?? '')
      const source = await repository.loadSource(actor.workspaceId, sourceId)
      if (!source || source.workspaceId !== actor.workspaceId || source.sourceId !== sourceId || source.deletedAt) {
        throw new LearningHttpError('NOT_FOUND')
      }
      if (operation === 'detail') {
        return { source, candidates: await repository.loadCandidates(actor.workspaceId, sourceId), jobs: [] }
      }
      if (input.revision !== source.revision) throw new LearningHttpError('STALE_REVISION')
      const ref = { workspaceId: actor.workspaceId, sourceId, revision: source.revision }
      if (operation === 'verify' || (operation === 'update' && input.action === 'resume')) {
        if (!adapters.verify) throw new LearningHttpError('UNAVAILABLE')
        const lease = await adapters.verify(source, actor)
        if (lease.workspaceId !== actor.workspaceId || lease.sourceId !== sourceId || lease.revision !== source.revision) {
          throw new LearningHttpError('FORBIDDEN')
        }
        await repository.updateVerificationLease({ source: ref, lease, actorUserId: actor.userId })
        return { source: await repository.loadSource(actor.workspaceId, sourceId) }
      }
      if (operation === 'collect') {
        if (!adapters.enqueue) throw new LearningHttpError('UNAVAILABLE')
        const capability = adapters.getCapabilities().find((item) => item.platform === source.platform)
        if (!capability || capability.blockerCode || capability.collectionMode !== 'official_api') throw new LearningHttpError('CAPABILITY_BLOCKED')
        const lease = source.lease
        if (source.verification !== 'verified' || !lease || lease.revokedAt
          || Date.parse(lease.expiresAt) <= Date.now() || lease.revision !== source.revision
          || (!source.consent.text && !source.consent.images)) throw new LearningHttpError('FORBIDDEN')
        return { ...await adapters.enqueue(source, actor, 'collect'), state: 'queued' }
      }
      if (operation === 'review') {
        await reviewLearningCandidates(actor, { source: ref,
          evidenceRevision: input.evidenceRevision as number,
          decisions: input.decisions as Parameters<typeof reviewLearningCandidates>[1]['decisions'],
        }, { repository })
        return { source: await repository.loadSource(actor.workspaceId, sourceId) }
      }
      if (operation === 'delete') return await deleteLearningSource(actor, ref, { repository })
      if (operation === 'update' && (input.action === 'pause' || input.action === 'cancel')) {
        // Stop the source atomically, not just the browser poll. Resuming requires ownership re-verification.
        await revokeLearningSource(actor, ref, { repository })
        return { source: await repository.loadSource(actor.workspaceId, sourceId) }
      }
      throw new LearningHttpError('CAPABILITY_BLOCKED')
    } catch (error) { throw safeError(error) }
  }
}
