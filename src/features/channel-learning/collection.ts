import crypto from 'node:crypto'
import {
  LearningError,
  type LearningDocument,
  type LearningSource,
  type SourceRef,
} from './contracts'

export interface CollectionDeps {
  getSource: (ref: SourceRef) => Promise<LearningSource | null>
  collectDocuments: (source: LearningSource) => AsyncIterable<LearningDocument>
  saveDocuments: (ref: SourceRef, docs: LearningDocument[]) => Promise<void>
  updateSourceCollectionState: (
    ref: SourceRef,
    state: LearningSource['collection'],
    meta?: { partialReason?: string | null },
  ) => Promise<void>
  checkRevocation: (ref: SourceRef) => Promise<boolean>
  generateJobId?: () => string
  now?: () => Date
}

export async function collectLearningSource(
  sourceRef: SourceRef,
  deps: CollectionDeps,
): Promise<{
  jobId: string
  state: LearningSource['collection']
  documentCount: number
  partialReason: string | null
}> {
  const getNow = deps.now ?? (() => new Date())
  const now = getNow()
  const jobId = deps.generateJobId ? deps.generateJobId() : crypto.randomUUID()

  const source = await deps.getSource(sourceRef)
  if (!source) {
    throw new LearningError('SOURCE_NOT_FOUND', 'Learning source not found')
  }

  // Lease checks
  if (!source.lease) {
    throw new LearningError('NO_LEASE', 'Learning source does not have a valid lease')
  }
  if (source.lease.revokedAt) {
    throw new LearningError('LEASE_REVOKED', 'Learning source lease is revoked')
  }
  if (new Date(source.lease.expiresAt) <= now) {
    throw new LearningError('LEASE_EXPIRED', 'Learning source lease is expired')
  }

  // Consent checks
  if (!source.consent.text && !source.consent.images) {
    throw new LearningError('NO_CONSENT', 'Learning source has no consent for text or images')
  }

  // Revocation check before start
  if (await deps.checkRevocation(sourceRef)) {
    await deps.updateSourceCollectionState(sourceRef, 'cancelled')
    return {
      jobId,
      state: 'cancelled',
      documentCount: 0,
      partialReason: 'Source revoked before collection',
    }
  }

  // Transition to collecting
  await deps.updateSourceCollectionState(sourceRef, 'collecting')

  const collectedDocs: LearningDocument[] = []
  try {
    for await (const doc of deps.collectDocuments(source)) {
      collectedDocs.push(doc)
    }
  } catch (err: any) {
    const reason = err?.message || 'Collection encountered provider error'
    await deps.updateSourceCollectionState(sourceRef, 'failed', { partialReason: reason })
    throw err
  }

  // Revocation check before persistence CAS
  if (await deps.checkRevocation(sourceRef)) {
    await deps.updateSourceCollectionState(sourceRef, 'cancelled', {
      partialReason: 'Source revoked before persistence',
    })
    return {
      jobId,
      state: 'cancelled',
      documentCount: 0,
      partialReason: 'Source revoked before persistence',
    }
  }

  // Persist documents
  await deps.saveDocuments(sourceRef, collectedDocs)

  const finalState: LearningSource['collection'] =
    collectedDocs.length > 0 ? 'review_required' : 'partial'
  const partialReason = collectedDocs.length === 0 ? 'No documents collected' : null

  await deps.updateSourceCollectionState(sourceRef, finalState, { partialReason })

  return {
    jobId,
    state: finalState,
    documentCount: collectedDocs.length,
    partialReason,
  }
}
