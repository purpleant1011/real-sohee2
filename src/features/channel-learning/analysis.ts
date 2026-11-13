import crypto from 'node:crypto'
import {
  candidateCategories,
  LearningError,
  type CandidateCategory,
  type EvidenceState,
  type LearningCandidate,
  type LearningDocument,
  type SourceRef,
} from './contracts'
import { validateQuoteEvidence, validateVisionEvidence } from './evidence'
import { createDeterministicUuid } from './meta-collector'

export interface BillingQuoteResult {
  allowed: boolean
  quoteId?: string
  reason?: string
}

export interface BillingGateway {
  quote: (operation: string, units: number) => Promise<BillingQuoteResult>
  reserve: (quoteId: string) => Promise<{ reservationId: string }>
  settle: (reservationId: string, actualUnits: number) => Promise<void>
  release: (reservationId: string) => Promise<void>
}

export interface AIExtractFactItem {
  category: CandidateCategory
  content: string
  excerpt: string | null
  evidenceState?: EvidenceState
}

export interface AIVisionAnalyzeItem {
  visionReceiptId: string
  styleDescription: string
  evidenceState?: EvidenceState
}

export interface AnalysisDeps {
  billingGateway: BillingGateway
  aiGateway: {
    extractFacts: (input: {
      text: string
      source: SourceRef
    }) => Promise<AIExtractFactItem[]>
    analyzeVision?: (input: {
      images: Array<{ mediaId: string; url: string }>
      source: SourceRef
    }) => Promise<AIVisionAnalyzeItem[]>
  }
  hasVisionReceipt?: (receiptId: string) => Promise<boolean>
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:previous|all)\s+instructions/i,
  /system\s*:\s*/i,
  /system\s*prompt/i,
  /delete\s+(?:all|db|database|tables)/i,
  /<script\b/i,
  /\{\{.*?\}\}/,
]

function isMaliciousContent(text: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pat) => pat.test(text))
}

export function createProductionBillingAdapter(params: {
  creditsRepository?: any
  rateCatalog?: any
  finopsClient?: any
  workspaceId?: string
}): BillingGateway {
  const creditsRepo = params.creditsRepository
  const client = params.finopsClient

  return {
    quote: async (operation: string, units: number) => {
      // 1. If using real durable credits repository
      if (creditsRepo) {
        if (!params.rateCatalog || typeof params.rateCatalog.sourceAnalyses !== 'number' || params.rateCatalog.sourceAnalyses <= 0) {
          return {
            allowed: false,
            reason: 'FINOPS_RATE_NOT_CONFIGURED',
          }
        }
        try {
          const cost = params.rateCatalog.sourceAnalyses * units
          const balance = await creditsRepo.getAvailableCredits(params.workspaceId)
          if (balance < cost) {
            return { allowed: false, reason: 'CREDIT_EXHAUSTED' }
          }
          return {
            allowed: true,
            quoteId: crypto.randomUUID(),
          }
        } catch (err: any) {
          return { allowed: false, reason: err?.message || 'FINOPS_ERROR' }
        }
      }

      // 2. If using finopsClient
      if (!client) {
        return {
          allowed: false,
          reason: 'FINOPS_CONNECTION_BLOCKED',
        }
      }
      const hasReserve =
        typeof client.reserve === 'function' ||
        typeof client.reserveCredits === 'function'
      if (!hasReserve) {
        return {
          allowed: false,
          reason: 'FINOPS_RESERVATION_UNAVAILABLE',
        }
      }

      try {
        if (typeof client.checkAvailableBalance === 'function') {
          const canSpend = await client.checkAvailableBalance(params.workspaceId)
          if (!canSpend) {
            return { allowed: false, reason: 'CREDIT_EXHAUSTED' }
          }
        }
        if (typeof client.createQuote === 'function') {
          const q = await client.createQuote(operation, units, params.workspaceId)
          return { allowed: true, quoteId: q.quoteId }
        }
        return {
          allowed: true,
          quoteId: crypto.randomUUID(),
        }
      } catch (err: any) {
        return {
          allowed: false,
          reason: err?.message || 'FINOPS_ERROR',
        }
      }
    },
    reserve: async (quoteId: string) => {
      if (creditsRepo) {
        const res = await creditsRepo.reserveCredits({
          workspaceId: params.workspaceId,
          action: 'source_analysis',
          quoteId,
          idempotencyKey: `learn_${quoteId}`,
        })
        if (!res.allowed || !res.reservationId) {
          throw new LearningError('BILLING_BLOCKED', res.reason || 'Credit reservation disallowed')
        }
        return { reservationId: res.reservationId }
      }
      if (!client) {
        throw new LearningError('BILLING_UNAVAILABLE', 'FinOps client unavailable')
      }
      if (typeof client.reserve === 'function') {
        const res = await client.reserve(quoteId)
        return { reservationId: res.reservationId }
      }
      if (typeof client.reserveCredits === 'function') {
        const res = await client.reserveCredits({
          quote: { quoteId, workspaceId: params.workspaceId, requiredCredits: 5 },
          actionRunId: quoteId,
          idempotencyKey: `learn_${quoteId}`,
        })
        if (!res.allowed || !res.reservationId) {
          throw new LearningError('BILLING_BLOCKED', res.reason || 'FinOps credit reservation disallowed')
        }
        return { reservationId: res.reservationId }
      }
      throw new LearningError('FINOPS_RESERVATION_UNAVAILABLE', 'FinOps client lacks reservation capability')
    },
    settle: async (reservationId: string, actualUnits: number) => {
      if (creditsRepo) {
        await creditsRepo.settleCredits({
          reservationId,
          actualUnits,
        })
        return
      }
      if (!client) {
        throw new LearningError('BILLING_UNAVAILABLE', 'FinOps client unavailable')
      }
      if (typeof client.settle === 'function') {
        await client.settle(reservationId, actualUnits)
      } else if (typeof client.settleCredits === 'function') {
        await client.settleCredits({
          reservationId,
          actionStatus: 'SUCCESS',
        })
      }
    },
    release: async (reservationId: string) => {
      if (creditsRepo) {
        await creditsRepo.releaseCredits({
          reservationId,
        })
        return
      }
      if (!client) return
      if (typeof client.release === 'function') {
        await client.release(reservationId)
      } else if (typeof client.releaseCredits === 'function') {
        await client.releaseCredits({
          reservationId,
          actionStatus: 'FAILED',
        })
      }
    },
  }
}

export async function analyzeLearningDocuments(
  source: SourceRef,
  documents: readonly LearningDocument[],
  deps: AnalysisDeps,
): Promise<readonly LearningCandidate[]> {
  if (documents.length === 0) {
    return []
  }

  // Check for images-only documents without vision adapter
  for (const doc of documents) {
    const hasText = Boolean(doc.text && doc.text.trim().length > 0)
    const hasImages = Boolean(doc.images && doc.images.length > 0)
    if (!hasText && hasImages && !deps.aiGateway.analyzeVision) {
      throw new LearningError('VISION_UNAVAILABLE', 'Images-only document requires vision adapter')
    }
  }

  // Filter strictly eligible documents that can be analyzed
  const eligibleDocs = documents.filter((doc) => {
    const hasText = Boolean(doc.text && doc.text.trim().length > 0)
    const hasVision = Boolean(doc.images && doc.images.length > 0 && deps.aiGateway.analyzeVision)
    return hasText || hasVision
  })

  // 0 eligible units: 0 provider calls, 0 reservations
  if (eligibleDocs.length === 0) {
    return []
  }

  // 1. FinOps Quote with eligible units only
  const quote = await deps.billingGateway.quote('extract_knowledge', eligibleDocs.length)
  if (!quote.allowed || !quote.quoteId) {
    throw new LearningError(
      'BILLING_BLOCKED',
      quote.reason || 'AI extraction is blocked due to billing limits',
    )
  }

  // 2. FinOps Reserve
  const { reservationId } = await deps.billingGateway.reserve(quote.quoteId)

  const candidates: LearningCandidate[] = []
  const seenKeys = new Set<string>()

  try {
    for (const doc of eligibleDocs) {
      // Text Extraction
      if (doc.text && doc.text.trim().length > 0) {
        const extracted = await deps.aiGateway.extractFacts({
          text: doc.text,
          source,
        })

        for (const item of extracted) {
          // Category check
          if (!candidateCategories.includes(item.category)) {
            continue
          }

          // Malicious text check
          if (isMaliciousContent(item.content)) {
            continue
          }

          const evidenceState: EvidenceState = item.evidenceState || 'observed'

          // Special check for visual category: text-origin visual candidates are completely forbidden
          // (observed, inferred, or recommended). Only actual vision extraction with verified receipts can produce visual candidates.
          if (item.category === 'visual') {
            continue
          }

          // Quote validation
          let verifiedExcerpt: string | null = null
          if (item.excerpt) {
            const quoteRes = validateQuoteEvidence(doc, item.excerpt)
            if (!quoteRes.valid) {
              if (evidenceState === 'observed') {
                // If observed quote does not match document text, drop it
                continue
              }
            } else {
              verifiedExcerpt = quoteRes.normalizedExcerpt || null
            }
          } else if (evidenceState === 'observed') {
            // Observed text facts require matching excerpt
            continue
          }

          // Dedup key
          const dedupKey = `${item.category}:${item.content.trim()}`
          if (seenKeys.has(dedupKey)) {
            continue
          }
          seenKeys.add(dedupKey)

          const candidateId = createDeterministicUuid(
            `${doc.id}:${item.category}:${item.content.trim()}:${verifiedExcerpt ?? ''}:${evidenceState}`,
          )

          candidates.push({
            id: candidateId,
            source,
            version: 1,
            category: item.category,
            content: item.content.trim(),
            evidence: {
              documentId: doc.id,
              excerpt: verifiedExcerpt,
              visionReceiptId: null,
            },
            evidenceState,
            status: 'review_required',
            conflictsWithFactId: null,
          })
        }
      }

      // Vision Extraction (distinct actual vision path)
      if (doc.images && doc.images.length > 0 && deps.aiGateway.analyzeVision) {
        const visionResults = await deps.aiGateway.analyzeVision({
          images: doc.images,
          source,
        })

        for (const vItem of visionResults) {
          if (isMaliciousContent(vItem.styleDescription)) {
            continue
          }

          const evidenceState: EvidenceState = vItem.evidenceState || 'observed'
          const visionCheck = validateVisionEvidence(doc, vItem.visionReceiptId, evidenceState)
          if (!visionCheck.valid) {
            continue
          }

          // Block visual observed without verified vision receipt ID
          if (evidenceState === 'observed') {
            if (!vItem.visionReceiptId?.trim() || !deps.hasVisionReceipt) {
              continue
            }
            const hasReceipt = await deps.hasVisionReceipt(vItem.visionReceiptId)
            if (!hasReceipt) {
              continue
            }
          }

          const dedupKey = `visual:${vItem.styleDescription.trim()}`
          if (seenKeys.has(dedupKey)) {
            continue
          }
          seenKeys.add(dedupKey)

          const candidateId = createDeterministicUuid(
            `${doc.id}:visual:${vItem.styleDescription.trim()}:${vItem.visionReceiptId}:${evidenceState}`,
          )

          candidates.push({
            id: candidateId,
            source,
            version: 1,
            category: 'visual',
            content: vItem.styleDescription.trim(),
            evidence: {
              documentId: doc.id,
              excerpt: null,
              visionReceiptId: vItem.visionReceiptId,
            },
            evidenceState,
            status: 'review_required',
            conflictsWithFactId: null,
          })
        }
      }
    }

    // 3. FinOps Settle with eligible units (not candidate count)
    await deps.billingGateway.settle(reservationId, eligibleDocs.length)
    return candidates
  } catch (err) {
    // Once provider attempt was entered, no auto-refund to prevent free re-runs / double charges.
    // Durable billing ledger holds the reservation for reconciliation.
    throw err
  }
}
