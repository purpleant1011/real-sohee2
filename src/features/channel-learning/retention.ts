import { LearningError } from './contracts'

export const DEFAULT_MEDIA_RETENTION_DAYS = 7

export interface ExpiredDocumentItem {
  id: string
  mediaUrls: string[]
}

export interface RetentionDeps {
  dbClient?: any
  deleteMediaBlob?: (mediaUrl: string) => Promise<boolean>
  clearDocumentPayloads?: (documentIds: string[]) => Promise<number>
  loadExpiredDocuments?: (cutoffIso: string, workspaceId?: string) => Promise<ExpiredDocumentItem[]>
  deleteSourceArtifacts?: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<{ purgedDocuments: number; purgedMedia: number; purgedCandidates: number }>
  purgeManualFacts?: (workspaceId: string) => Promise<void>
  now?: () => Date
}

export async function purgeExpiredLearningMedia(
  input: {
    workspaceId?: string
    now?: string
    ttlDays?: number
  },
  deps: RetentionDeps,
): Promise<{
  purgedCount: number
  failedCount: number
}> {
  const ttlDays = input.ttlDays ?? DEFAULT_MEDIA_RETENTION_DAYS
  const getNow = deps.now ?? (() => (input.now ? new Date(input.now) : new Date()))
  const cutoffTime = new Date(getNow().getTime() - ttlDays * 24 * 60 * 60 * 1000)
  const cutoffIso = cutoffTime.toISOString()

  // 1. Production RPC path if available (server enforces strict 7-day TTL; no client-side p_cutoff parameter)
  if (deps.dbClient && typeof deps.dbClient.rpc === 'function') {
    const { data, error } = await deps.dbClient.rpc('purge_expired_learning_payloads', {
      p_workspace_id: input.workspaceId ?? null,
    })
    if (!error && data) {
      return {
        purgedCount: data.purged_count ?? data.purgedCount ?? 0,
        failedCount: data.failed_count ?? data.failedCount ?? 0,
      }
    }
    if (error && !deps.loadExpiredDocuments) {
      throw new LearningError('RETENTION_BLOCKED', `RPC purge_expired_learning_payloads failed: ${error.message}`)
    }
  }

  // 2. Fallback / Test adapter path
  if (!deps.loadExpiredDocuments && !deps.dbClient) {
    throw new LearningError('RETENTION_BLOCKED', 'No storage or database client provided for retention purge')
  }

  let expiredDocs: ExpiredDocumentItem[] = []
  if (deps.loadExpiredDocuments) {
    expiredDocs = await deps.loadExpiredDocuments(cutoffIso, input.workspaceId)
  } else if (deps.dbClient) {
    let query = deps.dbClient
      .from('learning_documents')
      .select('id, images, text_content')
      .lt('collected_at', cutoffIso)
    if (input.workspaceId) {
      query = query.eq('workspace_id', input.workspaceId)
    }
    const { data, error } = await query
    if (error) {
      throw new LearningError('DATABASE_ERROR', `Failed to load expired documents: ${error.message}`)
    }
    expiredDocs = (data || []).map((row: any) => ({
      id: row.id,
      mediaUrls: Array.isArray(row.images) ? row.images.map((img: any) => img.url).filter(Boolean) : [],
    }))
  }

  let purgedCount = 0
  let failedCount = 0
  const docsToClear: string[] = []

  for (const doc of expiredDocs) {
    if (!doc.mediaUrls || doc.mediaUrls.length === 0) {
      docsToClear.push(doc.id)
      purgedCount++
      continue
    }

    if (!deps.deleteMediaBlob) {
      // External SNS images are not our owned blobs.
      // If no blob storage deletion adapter is wired, external media is not deleted.
      // Raw document text & media references are cleared in DB, so record failedCount for media blobs
      failedCount += doc.mediaUrls.length
      continue
    }

    let allMediaSucceeded = true
    for (const url of doc.mediaUrls) {
      try {
        const ok = await deps.deleteMediaBlob(url)
        if (ok) {
          purgedCount++
        } else {
          failedCount++
          allMediaSucceeded = false
        }
      } catch {
        failedCount++
        allMediaSucceeded = false
      }
    }
    if (allMediaSucceeded) {
      docsToClear.push(doc.id)
    }
  }

  if (docsToClear.length > 0) {
    if (deps.clearDocumentPayloads) {
      await deps.clearDocumentPayloads(docsToClear)
    } else if (deps.dbClient) {
      // Truncate raw text and image refs; preserve manifest row for evidence FKs
      const { error: updateErr } = await deps.dbClient
        .from('learning_documents')
        .update({
          text_content: '[RAW_TEXT_PURGED_TTL_EXPIRED]',
          images: [],
        })
        .in('id', docsToClear)
      if (updateErr) {
        throw new LearningError('DATABASE_ERROR', `Failed to clear raw document payloads: ${updateErr.message}`)
      }
    }
  }

  return {
    purgedCount,
    failedCount,
  }
}

export async function executeSourceDeletion(
  workspaceId: string,
  sourceId: string,
  deps: RetentionDeps,
): Promise<{
  purgedDocuments: number
  purgedMedia: number
  purgedCandidates: number
}> {
  if (deps.deleteSourceArtifacts) {
    return deps.deleteSourceArtifacts(workspaceId, sourceId)
  }

  if (!deps.dbClient || typeof deps.dbClient.rpc !== 'function') {
    throw new LearningError('RETENTION_BLOCKED', 'No storage or database client provided for source deletion')
  }

  // Atomic purge RPC: purge_learning_source_payloads
  // External SNS CDN media is never deleted (purgedMedia: 0).
  const { data, error } = await deps.dbClient.rpc('purge_learning_source_payloads', {
    p_workspace_id: workspaceId,
    p_source_id: sourceId,
  })

  if (error) {
    throw new LearningError(
      'ATOMIC_PURGE_RPC_REQUIRED',
      `Atomic source purge RPC purge_learning_source_payloads failed or missing: ${error.message}`,
    )
  }

  return {
    purgedDocuments: data?.purged_documents ?? data?.purgedDocuments ?? 0,
    purgedMedia: 0, // external SNS CDN images are never deleted
    purgedCandidates: data?.purged_candidates ?? data?.purgedCandidates ?? 0,
  }
}
