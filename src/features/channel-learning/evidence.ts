import type {
  CandidateEvidence,
  EvidenceState,
  LearningDocument,
} from './contracts'

export const MAX_EXCERPT_LENGTH = 500

export interface QuoteValidationResult {
  valid: boolean
  normalizedExcerpt?: string
  reason?: 'EMPTY_EXCERPT' | 'EXCERPT_TOO_LONG' | 'EXCERPT_NOT_IN_DOCUMENT'
}

export function validateQuoteEvidence(
  document: LearningDocument,
  excerpt: string,
): QuoteValidationResult {
  const trimmed = excerpt.trim()
  if (!trimmed) {
    return { valid: false, reason: 'EMPTY_EXCERPT' }
  }
  if (trimmed.length > MAX_EXCERPT_LENGTH) {
    return { valid: false, reason: 'EXCERPT_TOO_LONG' }
  }
  if (!document.text.includes(trimmed)) {
    return { valid: false, reason: 'EXCERPT_NOT_IN_DOCUMENT' }
  }
  return { valid: true, normalizedExcerpt: trimmed }
}

export interface VisionValidationResult {
  valid: boolean
  reason?: 'NO_IMAGES_IN_DOCUMENT' | 'VISION_RECEIPT_REQUIRED'
}

export function validateVisionEvidence(
  document: LearningDocument,
  visionReceiptId: string | null,
  evidenceState: EvidenceState,
): VisionValidationResult {
  if (evidenceState === 'observed') {
    if (!document.images || document.images.length === 0) {
      return { valid: false, reason: 'NO_IMAGES_IN_DOCUMENT' }
    }
    if (!visionReceiptId || !visionReceiptId.trim()) {
      return { valid: false, reason: 'VISION_RECEIPT_REQUIRED' }
    }
  }
  return { valid: true }
}

export function createCandidateEvidence(params: {
  documentId: string
  excerpt: string | null
  visionReceiptId: string | null
}): CandidateEvidence {
  return {
    documentId: params.documentId,
    excerpt: params.excerpt ?? null,
    visionReceiptId: params.visionReceiptId ?? null,
  }
}

export async function verifyVisionReceipt(
  receiptId: string,
  deps: { hasVisionReceipt: (id: string) => Promise<boolean> },
): Promise<boolean> {
  if (!receiptId) return false
  return deps.hasVisionReceipt(receiptId)
}
