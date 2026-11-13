import { describe, expect, it } from 'vitest'
import type { LearningDocument } from './contracts'
import {
  validateQuoteEvidence,
  validateVisionEvidence,
  createCandidateEvidence,
  verifyVisionReceipt,
} from './evidence'

const sampleDoc: LearningDocument = {
  id: '00000000-0000-0000-0000-000000000001',
  source: {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    sourceId: '22222222-2222-2222-2222-222222222222',
    revision: 1,
  },
  providerDocumentId: 'p-101',
  authorAccountId: 'author-101',
  url: 'https://instagram.com/p/abc123',
  publishedAt: '2026-11-01T10:00:00.000Z',
  collectedAt: '2026-11-02T10:00:00.000Z',
  text: '망원동 작은 카페입니다. 핸드드립 커피 5,000원에 판매합니다. 매주 월요일은 정기 휴무입니다.',
  contentHash: 'hash-abc',
  images: [
    {
      mediaId: 'm-1',
      url: 'https://cdn.instagram.com/image1.jpg',
      mimeType: 'image/jpeg',
    },
  ],
}

describe('evidence verification and creation', () => {
  describe('validateQuoteEvidence', () => {
    it('accepts exact excerpt from document text', () => {
      const res = validateQuoteEvidence(sampleDoc, '핸드드립 커피 5,000원')
      expect(res.valid).toBe(true)
      expect(res.normalizedExcerpt).toBe('핸드드립 커피 5,000원')
    })

    it('rejects excerpt not found in document text', () => {
      const res = validateQuoteEvidence(sampleDoc, '아메리카노 3,000원')
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('EXCERPT_NOT_IN_DOCUMENT')
    })

    it('rejects empty or whitespace-only excerpt', () => {
      const res = validateQuoteEvidence(sampleDoc, '   ')
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('EMPTY_EXCERPT')
    })

    it('rejects excerpt exceeding max character length', () => {
      const longExcerpt = 'a'.repeat(600)
      const res = validateQuoteEvidence(sampleDoc, longExcerpt)
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('EXCERPT_TOO_LONG')
    })
  })

  describe('validateVisionEvidence', () => {
    it('accepts visual observation when document has images and vision receipt is provided', () => {
      const res = validateVisionEvidence(sampleDoc, 'vr-999', 'observed')
      expect(res.valid).toBe(true)
    })

    it('rejects visual observation when document has no images', () => {
      const docNoImages: LearningDocument = { ...sampleDoc, images: [] }
      const res = validateVisionEvidence(docNoImages, 'vr-999', 'observed')
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('NO_IMAGES_IN_DOCUMENT')
    })

    it('rejects visual observation when vision receipt is absent', () => {
      const res = validateVisionEvidence(sampleDoc, null, 'observed')
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('VISION_RECEIPT_REQUIRED')
    })

    it('allows inferred/recommended visual statements without vision receipt if marked inferred', () => {
      const res = validateVisionEvidence(sampleDoc, null, 'inferred')
      expect(res.valid).toBe(true)
    })
  })

  describe('createCandidateEvidence', () => {
    it('constructs valid candidate evidence structure', () => {
      const evidence = createCandidateEvidence({
        documentId: sampleDoc.id,
        excerpt: '핸드드립 커피 5,000원',
        visionReceiptId: null,
      })
      expect(evidence).toEqual({
        documentId: sampleDoc.id,
        excerpt: '핸드드립 커피 5,000원',
        visionReceiptId: null,
      })
    })
  })

  describe('verifyVisionReceipt', () => {
    it('returns true when receipt is registered in database/store', async () => {
      const deps = {
        hasVisionReceipt: async (id: string) => id === 'vr-good',
      }
      expect(await verifyVisionReceipt('vr-good', deps)).toBe(true)
      expect(await verifyVisionReceipt('vr-bad', deps)).toBe(false)
    })
  })
})
