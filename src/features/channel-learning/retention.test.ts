import { describe, expect, it } from 'vitest'
import { LearningError } from './contracts'
import {
  purgeExpiredLearningMedia,
  executeSourceDeletion,
  type RetentionDeps,
} from './retention'

describe('retention and media lifecycle purge', () => {
  it('purges documents older than 7 days TTL while tracking purged and failed counts', async () => {
    const deletedBlobs: string[] = []
    const clearedDocIds: string[] = []

    const expiredDocs = [
      { id: 'doc-1', mediaUrls: ['https://cdn.example.com/img1.jpg'] },
      { id: 'doc-2', mediaUrls: ['https://cdn.example.com/img2.jpg', 'https://cdn.example.com/fail.jpg'] },
    ]

    const deps: RetentionDeps = {
      loadExpiredDocuments: async () => expiredDocs,
      deleteMediaBlob: async (url) => {
        if (url.includes('fail')) throw new Error('S3 error')
        deletedBlobs.push(url)
        return true
      },
      clearDocumentPayloads: async (ids) => {
        clearedDocIds.push(...ids)
        return ids.length
      },
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    }

    const result = await purgeExpiredLearningMedia(
      { ttlDays: 7, now: '2026-11-10T12:00:00.000Z' },
      deps,
    )

    expect(result.purgedCount).toBe(2) // 2 media blobs successfully deleted
    expect(result.failedCount).toBe(1) // 1 failed
    expect(deletedBlobs).toEqual(['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'])
    expect(clearedDocIds).toEqual(['doc-1']) // doc-2 had media failure, retained for retry
  })

  it('marks all media as failed when deleteMediaBlob adapter is missing (no fake purgedCount)', async () => {
    const expiredDocs = [
      { id: 'doc-1', mediaUrls: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'] },
    ]

    const deps: RetentionDeps = {
      loadExpiredDocuments: async () => expiredDocs,
      // deleteMediaBlob is intentionally undefined!
    }

    const result = await purgeExpiredLearningMedia({ ttlDays: 7 }, deps)
    expect(result.purgedCount).toBe(0)
    expect(result.failedCount).toBe(2)
  })

  it('clears raw text and images payload from learning_documents instead of dropping rows (preserves evidence FKs)', async () => {
    let payloadsCleared = false
    let manualFactsTouched = false

    const deps: RetentionDeps = {
      loadExpiredDocuments: async () => [{ id: 'doc-99', mediaUrls: ['https://cdn.example.com/99.jpg'] }],
      deleteMediaBlob: async () => true,
      clearDocumentPayloads: async () => {
        payloadsCleared = true
        return 1
      },
      purgeManualFacts: async () => {
        manualFactsTouched = true
      },
    }

    await purgeExpiredLearningMedia({ ttlDays: 7 }, deps)
    expect(payloadsCleared).toBe(true)
    expect(manualFactsTouched).toBe(false) // manual facts must NOT be purged
  })

  it('executeSourceDeletion purges source documents and unapproved artifacts', async () => {
    let purgedSourceDocs = false
    let purgedCandidates = false

    const deps: RetentionDeps = {
      deleteSourceArtifacts: async () => {
        purgedSourceDocs = true
        purgedCandidates = true
        return { purgedDocuments: 5, purgedMedia: 3, purgedCandidates: 12 }
      },
    }

    const res = await executeSourceDeletion('ws-1', 'source-1', deps)
    expect(purgedSourceDocs).toBe(true)
    expect(purgedCandidates).toBe(true)
    expect(res.purgedDocuments).toBe(5)
  })

  it('executeSourceDeletion blocks and refuses naked delete when atomic RPC is missing', async () => {
    const fakeAdmin = {
      rpc: (fn: string) => {
        if (fn === 'purge_learning_source_payloads') {
          return { data: null, error: { message: 'function purge_learning_source_payloads does not exist' } }
        }
        return { data: null, error: null }
      },
    }

    await expect(executeSourceDeletion('ws-1', 'source-1', { dbClient: fakeAdmin })).rejects.toThrow(
      LearningError,
    )
  })

  it('executeSourceDeletion successfully delegates to purge_learning_source_payloads with purgedMedia 0', async () => {
    const adminWithRpc = {
      rpc: (fn: string, args: any) => {
        if (fn === 'purge_learning_source_payloads' && args.p_source_id === 'source-ok') {
          return { data: { purged_documents: 4, purged_candidates: 8 }, error: null }
        }
        return { data: null, error: { message: 'Unknown RPC' } }
      },
    }

    const res = await executeSourceDeletion('ws-1', 'source-ok', { dbClient: adminWithRpc })
    expect(res.purgedDocuments).toBe(4)
    expect(res.purgedCandidates).toBe(8)
    expect(res.purgedMedia).toBe(0) // external SNS CDN images are not deleted
  })

  it('purgeExpiredLearningMedia calls purge_expired_learning_payloads with strictly p_workspace_id and no client p_cutoff', async () => {
    let capturedArgs: any = null
    const adminWithRpc = {
      rpc: (fn: string, args: any) => {
        if (fn === 'purge_expired_learning_payloads') {
          capturedArgs = args
          return { data: { purged_count: 7, failed_count: 0 }, error: null }
        }
        return { data: null, error: { message: 'Unknown RPC' } }
      },
    }

    const res = await purgeExpiredLearningMedia(
      { workspaceId: 'ws-test', ttlDays: 7 },
      { dbClient: adminWithRpc },
    )

    expect(res.purgedCount).toBe(7)
    expect(res.failedCount).toBe(0)
    // Server calculates fixed 7-day TTL; client is forbidden from passing p_cutoff
    expect(capturedArgs).toEqual({ p_workspace_id: 'ws-test' })
    expect(capturedArgs.p_cutoff).toBeUndefined()
  })

  it('returns blocked when required database or storage client is missing', async () => {
    const deps: RetentionDeps = {} // missing client

    await expect(purgeExpiredLearningMedia({ ttlDays: 7 }, deps)).rejects.toThrow(LearningError)
  })
})
