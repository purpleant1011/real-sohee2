/**
 * Results Storyline Model (ANI-1260)
 * 
 * Projects a 5-stage causal storyline from marketing action to verified revenue:
 * [Action] → [External Verified] → [Customer Response] → [Booking/Revenue] → [Learning/NBA]
 * 
 * Explains causality with visual evidence badges (VERIFIED / INFERRED / UNKNOWN)
 * instead of ungrounded dashboard numbers.
 */

export type StorylineStageName =
  | 'ACTION'
  | 'EXTERNAL_VERIFIED'
  | 'CUSTOMER_RESPONSE'
  | 'BOOKING_REVENUE'
  | 'LEARNING_NBA';

export interface StorylineStage {
  stageName: StorylineStageName;
  title: string;
  description: string;
  badge?: 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
  metricValue?: string;
  evidenceId?: string;
}

export interface StorylineProjection {
  missionId: string;
  workspaceId: string;
  stages: StorylineStage[];
  isVerifiedLineage: boolean;
  projectedAt: string;
}

export interface StorylineInput {
  missionId: string;
  workspaceId: string;
  actionTitle: string;
  publishReceiptId?: string;
  inboundConversationsCount?: number;
  confirmedBookingId?: string;
  revenueKrw?: number;
  evidenceClass: 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
  nextBestActionTitle?: string;
}

export class ResultsStorylineModel {
  /**
   * Builds the 5-stage causal storyline projection for owner and admin view parity.
   */
  buildStoryline(input: StorylineInput): StorylineProjection {
    const {
      missionId,
      workspaceId,
      actionTitle,
      publishReceiptId,
      inboundConversationsCount,
      confirmedBookingId,
      revenueKrw,
      evidenceClass,
      nextBestActionTitle,
    } = input;

    const stages: StorylineStage[] = [
      // 1. Action Execution
      {
        stageName: 'ACTION',
        title: actionTitle,
        description: '소희가 생성 및 발행한 마케팅 콘텐츠',
        badge: 'VERIFIED',
      },
      // 2. External Platform Verification
      {
        stageName: 'EXTERNAL_VERIFIED',
        title: '플랫폼 공식 발행 영수증 검증',
        description: publishReceiptId ? '소셜 미디어 API 영수증 확인 완료' : '발행 영수증 미확인',
        badge: publishReceiptId ? 'VERIFIED' : 'UNKNOWN',
        evidenceId: publishReceiptId,
      },
      // 3. Customer Inbound Response
      {
        stageName: 'CUSTOMER_RESPONSE',
        title: '고객 인바운드 문의 접수',
        description: `${inboundConversationsCount || 0}건의 고객 실시간 문의 응대`,
        metricValue: `${inboundConversationsCount || 0}건`,
        badge: (inboundConversationsCount && inboundConversationsCount > 0) ? 'VERIFIED' : 'UNKNOWN',
      },
      // 4. Booking & Revenue Conversion
      {
        stageName: 'BOOKING_REVENUE',
        title: '예약 확정 및 매출 성과',
        description: confirmedBookingId ? '고객 수락 증빙 기반 예약 확정' : '예약 미발생',
        badge: evidenceClass,
        metricValue: revenueKrw ? `₩${revenueKrw.toLocaleString()}` : '0원',
        evidenceId: confirmedBookingId,
      },
      // 5. Learning & Next Best Action
      {
        stageName: 'LEARNING_NBA',
        title: nextBestActionTitle || '후속 추천 최적 행동(Next Best Action)',
        description: '검증된 성과 패턴 학습 및 다음 비즈니스 성장 기회 제안',
        badge: evidenceClass === 'VERIFIED' ? 'VERIFIED' : 'INFERRED',
      },
    ];

    return {
      missionId,
      workspaceId,
      stages,
      isVerifiedLineage: evidenceClass === 'VERIFIED',
      projectedAt: new Date().toISOString(),
    };
  }
}
