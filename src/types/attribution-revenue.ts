/**
 * Sohee V0.9 5th Update · Wave 3 Results
 * Verified Attribution, Revenue Lineage & Zero Semantics Model
 * 
 * Traceability: ANI-929
 */

export type ZeroSemanticState = 
  | 'AWAITING_INITIAL_INGESTION'
  | 'MISSING_SOURCE'
  | 'STALE'
  | 'VERIFIED_ACTIVE';

export type AttributionModelType = 
  | 'FIRST_TOUCH'
  | 'LAST_TOUCH'
  | 'LINEAR'
  | 'POSITION_BASED';

export interface VerifiedRevenueEvent {
  revenueEventId: string;
  workspaceId: string;
  bookingId: string;
  customerId: string;
  amountKrw: number;
  paidAt: string;
  paymentMethod: 'CARD' | 'BANK_TRANSFER' | 'CASH';
  attributedCampaignId?: string;
  attributedContentId?: string;
  attributedConversationId?: string;
  attributedAdSpendId?: string;
  confidenceScore: number; // 0.0 ~ 1.0
  verificationState: 'VERIFIED' | 'RESULT_UNKNOWN' | 'DISPUTED';
  evidenceId: string;
}

export interface MarketingLineageEvidence {
  evidenceId: string;
  revenueEventId: string;
  campaignId?: string;
  contentId?: string;
  conversationId?: string;
  bookingId: string;
  customerId: string;
  amountKrw: number;
  adSpendKrw?: number;
  roasRatio?: number;
  confidenceScore: number;
  verifiedAt: string;
  readbackProofDigest: string;
}

export interface AttributionComparisonReport {
  workspaceId: string;
  period: string;
  totalActualRevenueKrw: number; // 절대 진실 현금 유입액 (Same Truth)
  totalAdSpendKrw: number;
  overallRoas: number;
  zeroSemantics: {
    organicContent: ZeroSemanticState;
    paidAds: ZeroSemanticState;
    crmBookings: ZeroSemanticState;
  };
  modelSimulations: Record<AttributionModelType, {
    modelName: string;
    attributedRevenueKrw: number;
    description: string;
  }>;
  verifiedEvents: VerifiedRevenueEvent[];
}
