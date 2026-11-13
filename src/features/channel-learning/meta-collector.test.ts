import { describe, expect, it } from 'vitest'
import { LearningError, type LearningSource } from './contracts'
import {
  collectMetaDocuments,
  type MetaCollectorDeps,
  type ProviderPost,
} from './meta-collector'

const validSource: LearningSource = {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  sourceId: '22222222-2222-2222-2222-222222222222',
  revision: 1,
  platform: 'instagram',
  canonicalUrl: 'https://instagram.com/my_shop',
  canonicalIdentity: 'my_shop',
  verification: 'verified',
  collection: 'queued',
  lease: {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    sourceId: '22222222-2222-2222-2222-222222222222',
    revision: 1,
    providerAccountId: 'act-12345',
    method: 'oauth',
    verifiedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-12T00:00:00.000Z',
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

const mockNow = new Date('2026-11-10T12:00:00.000Z')

function createMockDeps(posts: ProviderPost[], overrides: Partial<MetaCollectorDeps> = {}): MetaCollectorDeps {
  return {
    fetchProvider: async () => {
      return {
        status: 200,
        data: {
          data: posts,
          paging: {},
        },
        bodySizeBytes: 1024,
      }
    },
    now: () => mockNow,
    sleep: async () => {},
    ...overrides,
  }
}

describe('meta collector', () => {
  it('collects documents matching provider author account', async () => {
    const posts: ProviderPost[] = [
      {
        id: 'post-1',
        author_id: 'act-12345',
        caption: '첫 번째 글입니다.',
        timestamp: '2026-11-09T10:00:00.000Z',
        permalink: 'https://instagram.com/p/1',
        media_type: 'IMAGE',
        media_url: 'https://cdn.instagram.com/1.jpg',
      },
    ]

    const deps = createMockDeps(posts)
    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    expect(docs).toHaveLength(1)
    expect(docs[0].providerDocumentId).toBe('post-1')
    expect(docs[0].authorAccountId).toBe('act-12345')
    expect(docs[0].text).toBe('첫 번째 글입니다.')
    expect(docs[0].images).toHaveLength(1)
  })

  it('drops posts with forged or mismatched author account ID', async () => {
    const posts: ProviderPost[] = [
      {
        id: 'post-good',
        author_id: 'act-12345',
        caption: '정상 게시물',
        timestamp: '2026-11-09T10:00:00.000Z',
        permalink: 'https://instagram.com/p/good',
      },
      {
        id: 'post-forged',
        author_id: 'forged-attacker-id',
        caption: '위조된 게시물',
        timestamp: '2026-11-09T11:00:00.000Z',
        permalink: 'https://instagram.com/p/forged',
      },
    ]

    const deps = createMockDeps(posts)
    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    expect(docs).toHaveLength(1)
    expect(docs[0].providerDocumentId).toBe('post-good')
  })

  it('bounds collection to max 90 days, ignoring posts older than 90 days', async () => {
    const posts: ProviderPost[] = [
      {
        id: 'post-recent',
        author_id: 'act-12345',
        caption: '최근 게시물',
        timestamp: '2026-11-01T00:00:00.000Z', // 9 days ago
        permalink: 'https://instagram.com/p/recent',
      },
      {
        id: 'post-old',
        author_id: 'act-12345',
        caption: '91일 지난 오래된 게시물',
        timestamp: '2026-08-01T00:00:00.000Z', // > 90 days ago
        permalink: 'https://instagram.com/p/old',
      },
    ]

    const deps = createMockDeps(posts)
    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    expect(docs).toHaveLength(1)
    expect(docs[0].providerDocumentId).toBe('post-recent')
  })

  it('bounds collection to at most 30 posts (31st post ignored)', async () => {
    const posts: ProviderPost[] = Array.from({ length: 35 }, (_, i) => ({
      id: `post-${i + 1}`,
      author_id: 'act-12345',
      caption: `게시물 ${i + 1}`,
      timestamp: '2026-11-05T00:00:00.000Z',
      permalink: `https://instagram.com/p/${i + 1}`,
    }))

    const deps = createMockDeps(posts)
    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    expect(docs).toHaveLength(30)
    expect(docs[29].providerDocumentId).toBe('post-30')
  })

  it('bounds cumulative images to at most 10 images (11th image ignored)', async () => {
    // 6 posts each with 2 images = 12 images total
    const posts: ProviderPost[] = Array.from({ length: 6 }, (_, i) => ({
      id: `post-${i + 1}`,
      author_id: 'act-12345',
      caption: `게시물 ${i + 1}`,
      timestamp: '2026-11-05T00:00:00.000Z',
      permalink: `https://instagram.com/p/${i + 1}`,
      children: [
        { id: `img-${i * 2 + 1}`, media_url: `https://cdn.example.com/${i * 2 + 1}.jpg`, media_type: 'IMAGE' },
        { id: `img-${i * 2 + 2}`, media_url: `https://cdn.example.com/${i * 2 + 2}.jpg`, media_type: 'IMAGE' },
      ],
    }))

    const deps = createMockDeps(posts)
    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    const totalImages = docs.reduce((acc, d) => acc + d.images.length, 0)
    expect(totalImages).toBe(10)
  })

  it('bounds cumulative characters to 60,000 characters', async () => {
    // 2 posts with 40,000 chars each = 80,000 chars total
    const posts: ProviderPost[] = [
      {
        id: 'post-1',
        author_id: 'act-12345',
        caption: 'A'.repeat(40000),
        timestamp: '2026-11-05T00:00:00.000Z',
        permalink: 'https://instagram.com/p/1',
      },
      {
        id: 'post-2',
        author_id: 'act-12345',
        caption: 'B'.repeat(40000),
        timestamp: '2026-11-05T00:00:00.000Z',
        permalink: 'https://instagram.com/p/2',
      },
    ]

    const deps = createMockDeps(posts)
    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    const totalChars = docs.reduce((acc, d) => acc + d.text.length, 0)
    expect(totalChars).toBeLessThanOrEqual(60000)
    expect(docs[0].text.length).toBe(40000)
    expect(docs[1].text.length).toBe(20000)
  })

  it('rejects document response exceeding 2MB cap', async () => {
    const deps: MetaCollectorDeps = {
      fetchProvider: async () => ({
        status: 200,
        data: { data: [{ id: 'p1', author_id: 'act-12345', caption: 'huge' }] },
        bodySizeBytes: 3 * 1024 * 1024, // 3MB > 2MB
      }),
      now: () => mockNow,
      sleep: async () => {},
    }

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _doc of collectMetaDocuments(validSource, deps)) {}
    }).rejects.toThrow(LearningError)
  })

  it('retries up to 3 times on HTTP 429 and succeeds on 3rd retry', async () => {
    let callCount = 0
    const deps: MetaCollectorDeps = {
      fetchProvider: async () => {
        callCount++
        if (callCount <= 2) {
          return { status: 429, error: 'Rate limit exceeded' }
        }
        return {
          status: 200,
          data: {
            data: [
              {
                id: 'post-ok',
                author_id: 'act-12345',
                caption: '성공',
                timestamp: '2026-11-05T00:00:00.000Z',
                permalink: 'https://instagram.com/p/ok',
              },
            ],
          },
          bodySizeBytes: 512,
        }
      },
      now: () => mockNow,
      sleep: async () => {},
    }

    const docs = []
    for await (const doc of collectMetaDocuments(validSource, deps)) {
      docs.push(doc)
    }

    expect(callCount).toBe(3)
    expect(docs).toHaveLength(1)
  })

  it('fails after exceeding 3 retries on HTTP 429', async () => {
    let callCount = 0
    const deps: MetaCollectorDeps = {
      fetchProvider: async () => {
        callCount++
        return { status: 429, error: 'Rate limit exceeded' }
      },
      now: () => mockNow,
      sleep: async () => {},
    }

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _doc of collectMetaDocuments(validSource, deps)) {}
    }).rejects.toThrow(LearningError)
    expect(callCount).toBe(4) // initial + 3 retries
  })

  it('respects consent settings: text false drops text, images false drops images', async () => {
    const posts: ProviderPost[] = [
      {
        id: 'post-1',
        author_id: 'act-12345',
        caption: '본문 텍스트',
        timestamp: '2026-11-05T00:00:00.000Z',
        permalink: 'https://instagram.com/p/1',
        media_type: 'IMAGE',
        media_url: 'https://cdn.example.com/1.jpg',
      },
    ]

    const noTextSource: LearningSource = {
      ...validSource,
      consent: { text: false, images: true, revision: 1 },
    }
    const noTextDocs = []
    for await (const doc of collectMetaDocuments(noTextSource, createMockDeps(posts))) {
      noTextDocs.push(doc)
    }
    expect(noTextDocs[0].text).toBe('')
    expect(noTextDocs[0].images).toHaveLength(1)

    const noImageSource: LearningSource = {
      ...validSource,
      consent: { text: true, images: false, revision: 1 },
    }
    const noImageDocs = []
    for await (const doc of collectMetaDocuments(noImageSource, createMockDeps(posts))) {
      noImageDocs.push(doc)
    }
    expect(noImageDocs[0].text).toBe('본문 텍스트')
    expect(noImageDocs[0].images).toHaveLength(0)
  })

  it('generates deterministic doc.id for identical post and content, but distinct for different revision', async () => {
    const posts: ProviderPost[] = [
      {
        id: 'post-det-1',
        author_id: 'act-12345',
        caption: '결정적 문서 테스트',
        timestamp: '2026-11-05T00:00:00.000Z',
        permalink: 'https://instagram.com/p/det1',
      },
    ]

    const run1Docs = []
    for await (const doc of collectMetaDocuments(validSource, createMockDeps(posts))) {
      run1Docs.push(doc)
    }

    const run2Docs = []
    for await (const doc of collectMetaDocuments(validSource, createMockDeps(posts))) {
      run2Docs.push(doc)
    }

    expect(run1Docs[0].id).toBe(run2Docs[0].id) // identical doc.id across runs!

    // Different revision
    const rev2Source: LearningSource = {
      ...validSource,
      revision: 2,
    }
    const rev2Docs = []
    for await (const doc of collectMetaDocuments(rev2Source, createMockDeps(posts))) {
      rev2Docs.push(doc)
    }

    expect(rev2Docs[0].id).not.toBe(run1Docs[0].id)
  })
})

