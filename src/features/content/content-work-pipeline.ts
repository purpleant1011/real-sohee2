/**
 * Content Work Pipeline Model & Stage Tracker (ANI-1262)
 *
 * Transforms the content repository into a 7-stage linear marketing pipeline:
 * IDEA → PRODUCING → REVIEW_REQUIRED → SCHEDULED → PUBLISHED → OBSERVING_RESPONSE → OUTCOME_VERIFIED
 * Connects directly to marketing missions, target channels, and provider-verified readback evidence.
 */

export type ContentPipelineStage =
  | 'IDEA'                 // 기획 및 아이디어 발굴
  | 'PRODUCING'            // 원고 및 미디어 생성 중
  | 'REVIEW_REQUIRED'      // 원장님 검토 및 승인 대기
  | 'SCHEDULED'            // 승인 완료 후 발행 예약됨
  | 'PUBLISHED'            // 외부 플랫폼 실발행 완료
  | 'OBSERVING_RESPONSE'   // 게시 반응 및 댓글/문의 관측 중
  | 'OUTCOME_VERIFIED';    // 예약 및 실매출 인과 확인 완료

export interface PipelineCardItem {
  contentId: string;
  workspaceId: string;
  missionId: string;
  missionGoal: string;
  targetChannel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN';
  title?: string;
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
  versionNumber: number;
  versionId: string;
  contentFingerprint: string;
  stage: ContentPipelineStage;
  isApproved: boolean;
  scheduledAt?: string;
  publishedAt?: string;
  providerPostId?: string;
  providerPermalink?: string;
  readbackReceiptId?: string;
  inboundResponseCount?: number;
  confirmedBookingCount?: number;
  nextActionAdvice: string;
  updatedAt: string;
}

export interface ContentPipelineSnapshot {
  workspaceId: string;
  stages: Record<ContentPipelineStage, PipelineCardItem[]>;
  totalActiveItems: number;
  staleItemCount: number;
  snapshotAt: string;
}

export const PIPELINE_STAGE_SEQUENCE: readonly ContentPipelineStage[] = Object.freeze([
  'IDEA',
  'PRODUCING',
  'REVIEW_REQUIRED',
  'SCHEDULED',
  'PUBLISHED',
  'OBSERVING_RESPONSE',
  'OUTCOME_VERIFIED',
]);

export class ContentWorkPipelineManager {
  /**
   * 파이프라인 항목들을 7단계 버킷으로 분류 및 정렬
   */
  aggregatePipeline(workspaceId: string, items: PipelineCardItem[]): ContentPipelineSnapshot {
    const stages: Record<ContentPipelineStage, PipelineCardItem[]> = {
      IDEA: [],
      PRODUCING: [],
      REVIEW_REQUIRED: [],
      SCHEDULED: [],
      PUBLISHED: [],
      OBSERVING_RESPONSE: [],
      OUTCOME_VERIFIED: [],
    };

    let staleItemCount = 0;
    const now = Date.now();
    const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48시간 이상 미진행 시 stale

    for (const item of items) {
      if (stages[item.stage]) {
        stages[item.stage].push(item);
      } else {
        stages.IDEA.push(item);
      }

      const itemUpdatedMs = new Date(item.updatedAt).getTime();
      if (now - itemUpdatedMs > STALE_THRESHOLD_MS && item.stage !== 'OUTCOME_VERIFIED') {
        staleItemCount += 1;
      }
    }

    // 최신 수정순 정렬
    for (const stage of PIPELINE_STAGE_SEQUENCE) {
      stages[stage].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }

    return {
      workspaceId,
      stages,
      totalActiveItems: items.length,
      staleItemCount,
      snapshotAt: new Date().toISOString(),
    };
  }

  /**
   * 단계 승격 및 유효성 검증
   */
  transitionStage(
    item: PipelineCardItem,
    targetStage: ContentPipelineStage,
    evidence?: {
      providerPostId?: string;
      providerPermalink?: string;
      readbackReceiptId?: string;
      confirmedBookingCount?: number;
    }
  ): PipelineCardItem {
    const currentIdx = PIPELINE_STAGE_SEQUENCE.indexOf(item.stage);
    const targetIdx = PIPELINE_STAGE_SEQUENCE.indexOf(targetStage);

    // 승인 없이 바로 PUBLISHED로 점프 불가
    if (targetStage === 'PUBLISHED' && !item.isApproved) {
      throw new Error('승인되지 않은 콘텐츠는 PUBLISHED 단계로 전진할 수 없습니다.');
    }

    // PUBLISHED로 이동할 때는 providerPostId 또는 readbackReceiptId 필수
    if (targetStage === 'PUBLISHED' && (!evidence?.providerPostId && !evidence?.providerPermalink)) {
      throw new Error('외부 플랫폼 실발행 증거(providerPostId/permalink) 없이 PUBLISHED로 승격할 수 없습니다.');
    }

    const now = new Date().toISOString();
    return {
      ...item,
      stage: targetStage,
      providerPostId: evidence?.providerPostId || item.providerPostId,
      providerPermalink: evidence?.providerPermalink || item.providerPermalink,
      readbackReceiptId: evidence?.readbackReceiptId || item.readbackReceiptId,
      confirmedBookingCount: evidence?.confirmedBookingCount ?? item.confirmedBookingCount,
      updatedAt: now,
      nextActionAdvice: this.generateNextActionAdvice(targetStage),
    };
  }

  private generateNextActionAdvice(stage: ContentPipelineStage): string {
    switch (stage) {
      case 'IDEA':
        return '소희에게 초안 작성을 요청하세요.';
      case 'PRODUCING':
        return '소희가 우리 매장 스타일에 맞춰 원고를 작성 중입니다.';
      case 'REVIEW_REQUIRED':
        return '사장님의 5초 승인이 필요합니다.';
      case 'SCHEDULED':
        return '예약된 시간에 자동으로 안전하게 발행됩니다.';
      case 'PUBLISHED':
        return '고객의 댓글 및 문의 수신을 기다리고 있습니다.';
      case 'OBSERVING_RESPONSE':
        return '새로운 문의가 들어오면 즉시 알려드립니다.';
      case 'OUTCOME_VERIFIED':
        return '성공 요인을 학습하여 다음 추천 행동(NBA)을 준비합니다.';
    }
  }
}
