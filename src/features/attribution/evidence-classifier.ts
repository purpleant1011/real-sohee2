/**
 * Evidence Classifier & Source Chain Verification (ANI-1256)
 * 
 * 3-Tier Evidence Classification Law:
 * 1. VERIFIED: Full 5-link direct source chain (Post Reference -> Action Receipt -> Inbound Message -> Customer -> Confirmed Booking).
 * 2. INFERRED: Temporal correlation exists but direct link is broken/missing. Must state inference rationale & confidence < 0.8.
 * 3. UNKNOWN: Broken, missing, or contradictory evidence.
 * 
 * Anti-Fabrication Guarantee:
 * - Broken chains must NEVER be promoted to VERIFIED.
 * - Missing revenue is NOT_OBSERVED, never fabricated default (e.g. 150000 KRW).
 */

export type AttributionEvidenceClass = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';

export interface SourceChainInput {
  workspaceId: string;
  missionId: string;
  providerPostReference?: string | null;
  externalActionReceiptId?: string | null;
  inboundMessageId?: string | null;
  customerId?: string | null;
  bookingId?: string | null;
  revenueKrw?: number;
  postPublishedAt?: string;
  bookingCreatedAt?: string;
}

export interface ClassifiedAttribution {
  evidenceClass: AttributionEvidenceClass;
  confidence: number;
  hasDirectChain: boolean;
  sourceIds: string[];
  revenueKrw?: number;
  revenueStatus: 'OBSERVED' | 'NOT_OBSERVED';
  inferenceRationale?: string;
}

export class EvidenceClassifier {
  /**
   * Classifies a source chain into VERIFIED, INFERRED, or UNKNOWN based on evidence rigor.
   */
  classify(input: SourceChainInput): ClassifiedAttribution {
    const {
      providerPostReference,
      externalActionReceiptId,
      inboundMessageId,
      customerId,
      bookingId,
      revenueKrw,
      postPublishedAt,
      bookingCreatedAt,
    } = input;

    const sourceIds = [
      providerPostReference,
      externalActionReceiptId,
      inboundMessageId,
      customerId,
      bookingId,
    ].filter(Boolean) as string[];

    const revenueStatus = revenueKrw !== undefined ? 'OBSERVED' : 'NOT_OBSERVED';

    // 1. VERIFIED Check: Complete 5-link direct chain
    const hasFullDirectLinks =
      Boolean(providerPostReference) &&
      Boolean(externalActionReceiptId) &&
      Boolean(inboundMessageId) &&
      Boolean(customerId) &&
      Boolean(bookingId);

    if (hasFullDirectLinks) {
      return {
        evidenceClass: 'VERIFIED',
        confidence: 1.0,
        hasDirectChain: true,
        sourceIds,
        revenueKrw,
        revenueStatus,
      };
    }

    // 2. INFERRED Check: Temporal correlation without direct link
    if (providerPostReference && bookingId && postPublishedAt && bookingCreatedAt) {
      const postTime = new Date(postPublishedAt).getTime();
      const bookTime = new Date(bookingCreatedAt).getTime();
      const diffHours = (bookTime - postTime) / (1000 * 3600);

      // If booking occurred within 24 hours of posting
      if (diffHours >= 0 && diffHours <= 24) {
        return {
          evidenceClass: 'INFERRED',
          confidence: 0.65,
          hasDirectChain: false,
          sourceIds,
          revenueKrw,
          revenueStatus,
          inferenceRationale: `발행 직후 ${diffHours.toFixed(1)}시간 내 발생한 예약으로 시계열적 상관관계가 있으나 직접 추적 태그 부재`,
        };
      }
    }

    // 3. UNKNOWN: Broken, unsubstantiated, or contradictory
    return {
      evidenceClass: 'UNKNOWN',
      confidence: 0.0,
      hasDirectChain: false,
      sourceIds,
      revenueKrw,
      revenueStatus,
      inferenceRationale: '인과 관계를 입증할 원천 레코드가 결여되어 알 수 없음(UNKNOWN)으로 분류됨',
    };
  }

  /**
   * Guard preventing illegal promotion of broken/inferred chains to VERIFIED.
   */
  assertPromotableToVerified(attribution: ClassifiedAttribution): void {
    if (attribution.evidenceClass !== 'VERIFIED') {
      throw new Error(
        `[INVALID_EVIDENCE_PROMOTION] 끊어진 증거 체인(현재: ${attribution.evidenceClass})은 VERIFIED 등급으로 승격할 수 없습니다.`
      );
    }
  }
}
