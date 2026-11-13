import type {
  KnowledgeFactLifecycle,
  KnowledgeFactProvenance,
} from '@/types/autonomous-outcome-os';

export interface IngestFactParams {
  workspaceId: string;
  factKey: string;
  observedValue: unknown;
  provenance: KnowledgeFactProvenance;
  currentCanonicalValue?: unknown;
}

export interface FactTransitionResult {
  workspaceId: string;
  factKey: string;
  lifecycle: KnowledgeFactLifecycle;
  effectiveValue: unknown;
  requiresReview: boolean;
  canonicalUnchanged: boolean;
  triggerRecompile: boolean;
  provenance: KnowledgeFactProvenance;
  updatedAt: string;
}

export interface PromotionDecisionParams {
  workspaceId: string;
  factKey: string;
  proposedValue: unknown;
  decision: 'APPROVE' | 'REJECT';
  reviewedBy: string;
}

export function ingestObservedFact(params: IngestFactParams): FactTransitionResult {
  const { workspaceId, factKey, observedValue, provenance, currentCanonicalValue } = params;

  const isIdentical =
    currentCanonicalValue !== undefined &&
    JSON.stringify(observedValue) === JSON.stringify(currentCanonicalValue);

  if (isIdentical) {
    return {
      workspaceId,
      factKey,
      lifecycle: 'CANONICAL',
      effectiveValue: currentCanonicalValue,
      requiresReview: false,
      canonicalUnchanged: true,
      triggerRecompile: false,
      provenance,
      updatedAt: new Date().toISOString(),
    };
  }

  // Contradiction or unverified new observation: must isolate as CONFLICTED or CANDIDATE
  const lifecycle: KnowledgeFactLifecycle =
    currentCanonicalValue !== undefined ? 'CONFLICTED' : 'CANDIDATE';

  return {
    workspaceId,
    factKey,
    lifecycle,
    effectiveValue: currentCanonicalValue ?? observedValue,
    requiresReview: true,
    canonicalUnchanged: currentCanonicalValue !== undefined,
    triggerRecompile: false,
    provenance,
    updatedAt: new Date().toISOString(),
  };
}

export function promoteCandidateFact(params: PromotionDecisionParams): FactTransitionResult {
  const { workspaceId, factKey, proposedValue, decision, reviewedBy } = params;

  if (decision === 'APPROVE') {
    return {
      workspaceId,
      factKey,
      lifecycle: 'CANONICAL',
      effectiveValue: proposedValue,
      requiresReview: false,
      canonicalUnchanged: false,
      triggerRecompile: true,
      provenance: {
        sourceId: `decision_by_${reviewedBy}`,
        sourceType: 'USER_INPUT',
        extractedAt: new Date().toISOString(),
        confidenceScore: 1.0,
        verifiedAt: new Date().toISOString(),
        verifiedBy: reviewedBy,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    workspaceId,
    factKey,
    lifecycle: 'REJECTED',
    effectiveValue: undefined,
    requiresReview: false,
    canonicalUnchanged: true,
    triggerRecompile: false,
    provenance: {
      sourceId: `rejection_by_${reviewedBy}`,
      sourceType: 'USER_INPUT',
      extractedAt: new Date().toISOString(),
      confidenceScore: 0,
      verifiedAt: new Date().toISOString(),
      verifiedBy: reviewedBy,
    },
    updatedAt: new Date().toISOString(),
  };
}
