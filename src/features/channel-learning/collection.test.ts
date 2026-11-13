import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LearningError,
  type LearningDocument,
  type LearningSource,
  type SourceRef,
} from './contracts'
import {
  collectLearningSource,
  type CollectionDeps,
} from './collection'

const sourceRef: SourceRef = {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  sourceId: '22222222-2222-2222-2222-222222222222',
  revision: 1,
}

const activeSource: LearningSource = {
  ...sourceRef,
  platform: 'instagram',
  canonicalUrl: 'https://instagram.com/my_shop',
  canonicalIdentity: 'my_shop',
  verification: 'verified',
  collection: 'queued',
  lease: {
    ...sourceRef,
    providerAccountId: 'act-12345',
    method: 'oauth',
    verifiedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-15T00:00:00.000Z',
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

function createSampleDoc(id: string): LearningDocument {
  return {
    id: crypto.randomUUID(),
    source: sourceRef,
    providerDocumentId: id,
    authorAccountId: 'act-12345',
    url: `https://instagram.com/p/${id}`,
    publishedAt: '2026-11-05T00:00:00.000Z',
    collectedAt: '2026-11-10T12:00:00.000Z',
    text: `Content for ${id}`,
    contentHash: `hash-${id}`,
    images: [],
  }
}

describe('collectLearningSource', () => {
  it('collects documents and transitions state to review_required', async () => {
    let savedDocs: LearningDocument[] = []
    let finalState: string = ''

    const deps: CollectionDeps = {
      getSource: async () => activeSource,
      collectDocuments: async function* () {
        yield createSampleDoc('doc-1')
        yield createSampleDoc('doc-2')
      },
      saveDocuments: async (_ref, docs) => {
        savedDocs = [...docs]
      },
      updateSourceCollectionState: async (_ref, state) => {
        finalState = state
      },
      checkRevocation: async () => false,
      generateJobId: () => 'job-test-1',
    }

    const result = await collectLearningSource(sourceRef, deps)
    expect(result.jobId).toBe('job-test-1')
    expect(result.state).toBe('review_required')
    expect(result.documentCount).toBe(2)
    expect(savedDocs).toHaveLength(2)
    expect(finalState).toBe('review_required')
  })

  it('rejects collection when source lease is expired', async () => {
    const expiredSource: LearningSource = {
      ...activeSource,
      lease: {
        ...activeSource.lease!,
        expiresAt: '2026-11-01T00:00:00.000Z', // past
      },
    }

    const deps: CollectionDeps = {
      getSource: async () => expiredSource,
      collectDocuments: async function* () {},
      saveDocuments: async () => {},
      updateSourceCollectionState: async () => {},
      checkRevocation: async () => false,
      now: () => new Date('2026-11-10T00:00:00.000Z'),
    }

    await expect(collectLearningSource(sourceRef, deps)).rejects.toThrow(LearningError)
  })

  it('cancels without saving when source is revoked before persistence CAS', async () => {
    let saved = false
    let finalState = ''

    const deps: CollectionDeps = {
      getSource: async () => activeSource,
      collectDocuments: async function* () {
        yield createSampleDoc('doc-1')
      },
      saveDocuments: async () => {
        saved = true
      },
      updateSourceCollectionState: async (_ref, state) => {
        finalState = state
      },
      checkRevocation: async () => true, // revoked concurrently!
    }

    const result = await collectLearningSource(sourceRef, deps)
    expect(saved).toBe(false)
    expect(result.state).toBe('cancelled')
    expect(finalState).toBe('cancelled')
  })

  it('rejects collection when consent is empty or stale', async () => {
    const noConsentSource: LearningSource = {
      ...activeSource,
      consent: { text: false, images: false, revision: 1 },
    }

    const deps: CollectionDeps = {
      getSource: async () => noConsentSource,
      collectDocuments: async function* () {},
      saveDocuments: async () => {},
      updateSourceCollectionState: async () => {},
      checkRevocation: async () => false,
    }

    await expect(collectLearningSource(sourceRef, deps)).rejects.toThrow(LearningError)
  })
})
