/**
 * 5-Second Decision Card Model & Anti-TOCTOU Gatekeeper (ANI-1261)
 *
 * Provides small business owners with a clear, 5-second comprehensible decision card
 * containing: What / Where / When / Cost / Reversibility / Why.
 * Enforces TOCTOU fingerprint mutation protection and blocks optimistic-only approvals.
 */

import { createHash } from 'node:crypto';

export type DecisionChannel = 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN';

export type DecisionActionType = 'PUBLISH_CONTENT' | 'RESERVE_SLOT' | 'CAMPAIGN_SPEND' | 'AUTO_REPLY';

export interface DecisionCardContent {
  cardId: string;
  workspaceId: string;
  missionId: string;
  actionType: DecisionActionType;
  // 1. What: 무엇이 나가는가
  what: {
    title?: string;
    captionSummary: string;
    fullCaption: string;
    mediaUrls: string[];
    hashtags: string[];
  };
  // 2. Where: 어디에 나가는가
  where: {
    channel: DecisionChannel;
    accountHandle: string;
    targetAudienceSummary?: string;
  };
  // 3. When: 언제 나가는가
  when: {
    timing: 'IMMEDIATE' | 'SCHEDULED';
    scheduledAt?: string;
    displayTimingText: string;
  };
  // 4. Cost: 비용
  cost: {
    isFree: boolean;
    requiredCreditUnits: number;
    adBudgetKrw?: number;
    costDisplayText: string;
  };
  // 5. Reversibility: 되돌릴 수 있는가
  reversibility: {
    canDeleteAfterPublish: boolean;
    canEditAfterPublish: boolean;
    reversibilityNotice: string;
  };
  // 6. Why: 왜 지금 하는가
  why: {
    missionGoal: string;
    opportunityReason: string;
  };
  contentFingerprint: string;
  createdAt: string;
}

export type DecisionResultStatus = 'PENDING' | 'APPROVED' | 'REVISION_REQUESTED' | 'CANCELLED' | 'SUPERSEDED';

export interface DecisionRecord {
  decisionId: string;
  cardId: string;
  workspaceId: string;
  missionId: string;
  status: DecisionResultStatus;
  approvedFingerprint: string;
  approvedBy: string;
  approvedAt?: string;
  revisionFeedback?: string;
  rejectionReason?: string;
  isAuthoritativeServerRecorded: boolean;
}

export class DecisionIntegrityError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DecisionIntegrityError';
    this.code = code;
  }
}

export function computeDecisionFingerprint(payload: {
  actionType: DecisionActionType;
  channel: DecisionChannel;
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
  scheduledAt?: string;
}): string {
  const norm = {
    actionType: payload.actionType,
    channel: payload.channel,
    caption: payload.caption.trim(),
    hashtags: [...payload.hashtags].sort(),
    mediaUrls: [...payload.mediaUrls].sort(),
    scheduledAt: payload.scheduledAt || 'IMMEDIATE',
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

export class FiveSecondDecisionManager {
  /**
   * 5초 결정 카드 생성
   */
  createDecisionCard(params: {
    cardId: string;
    workspaceId: string;
    missionId: string;
    actionType: DecisionActionType;
    caption: string;
    channel: DecisionChannel;
    accountHandle: string;
    mediaUrls?: string[];
    hashtags?: string[];
    timing?: 'IMMEDIATE' | 'SCHEDULED';
    scheduledAt?: string;
    creditUnits?: number;
    adBudgetKrw?: number;
    missionGoal: string;
    opportunityReason: string;
  }): DecisionCardContent {
    const mediaUrls = params.mediaUrls || [];
    const hashtags = params.hashtags || [];
    const timing = params.timing || 'IMMEDIATE';
    const creditUnits = params.creditUnits || 0;
    const isFree = creditUnits === 0 && (!params.adBudgetKrw || params.adBudgetKrw === 0);

    const fingerprint = computeDecisionFingerprint({
      actionType: params.actionType,
      channel: params.channel,
      caption: params.caption,
      hashtags,
      mediaUrls,
      scheduledAt: params.scheduledAt,
    });

    const costText = isFree
      ? '무료 (기본 크레딧 차감 없음)'
      : params.adBudgetKrw
      ? `광고비 ${params.adBudgetKrw.toLocaleString()}원 + 크레딧 ${creditUnits}개`
      : `크레딧 ${creditUnits}개 사용`;

    const reversibilityNotice = params.channel === 'INSTAGRAM' || params.channel === 'THREADS'
      ? '게시 후 인스타그램/스레드 공식 앱에서 삭제 가능'
      : '게시 후 매장 채널에서 수정 및 삭제 가능';

    return {
      cardId: params.cardId,
      workspaceId: params.workspaceId,
      missionId: params.missionId,
      actionType: params.actionType,
      what: {
        captionSummary: params.caption.slice(0, 60) + (params.caption.length > 60 ? '...' : ''),
        fullCaption: params.caption,
        mediaUrls,
        hashtags,
      },
      where: {
        channel: params.channel,
        accountHandle: params.accountHandle,
        targetAudienceSummary: '지역 고객 및 기존 단골 고객층',
      },
      when: {
        timing,
        scheduledAt: params.scheduledAt,
        displayTimingText: timing === 'IMMEDIATE' ? '승인 확인 후 발행' : `${params.scheduledAt} 예약 발행`,
      },
      cost: {
        isFree,
        requiredCreditUnits: creditUnits,
        adBudgetKrw: params.adBudgetKrw,
        costDisplayText: costText,
      },
      reversibility: {
        canDeleteAfterPublish: true,
        canEditAfterPublish: params.channel === 'THREADS',
        reversibilityNotice,
      },
      why: {
        missionGoal: params.missionGoal,
        opportunityReason: params.opportunityReason,
      },
      contentFingerprint: fingerprint,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 사장님의 승인 결정 처리 및 Anti-TOCTOU 검증
   */
  processDecision(params: {
    card: DecisionCardContent;
    action: 'APPROVE_AND_EXECUTE' | 'REQUEST_REVISION' | 'CANCEL';
    actorId: string;
    currentContentFingerprint: string;
    feedbackText?: string;
    isAuthoritativeServerConfirmed?: boolean;
  }): DecisionRecord {
    const { card, action, actorId, currentContentFingerprint, feedbackText, isAuthoritativeServerConfirmed } = params;
    const now = new Date().toISOString();

    // 1. Anti-TOCTOU Fingerprint 무결성 검증
    if (action === 'APPROVE_AND_EXECUTE') {
      if (currentContentFingerprint !== card.contentFingerprint) {
        throw new DecisionIntegrityError(
          `TOCTOU 변조 감지: 카드 발행 승인 지문(${card.contentFingerprint})과 현재 콘텐츠 상태(${currentContentFingerprint})가 다릅니다. 재검토가 필요합니다.`,
          'MUTATION_DETECTED_REAPPROVAL_REQUIRED'
        );
      }

      // 2. 낙관적 UI 단독 완료 차단 가드 (서버 영속화 플래그 요구)
      if (isAuthoritativeServerConfirmed === false) {
        throw new DecisionIntegrityError(
          '낙관적 UI 단독 승인 차단: 서버 데이터베이스에 승인 원장이 영속되기 전에는 승인 완료로 확정할 수 없습니다.',
          'OPTIMISTIC_ONLY_APPROVAL_FORBIDDEN'
        );
      }

      return {
        decisionId: `decision_${card.cardId}_${Date.now()}`,
        cardId: card.cardId,
        workspaceId: card.workspaceId,
        missionId: card.missionId,
        status: 'APPROVED',
        approvedFingerprint: card.contentFingerprint,
        approvedBy: actorId,
        approvedAt: now,
        isAuthoritativeServerRecorded: !!isAuthoritativeServerConfirmed,
      };
    }

    if (action === 'REQUEST_REVISION') {
      return {
        decisionId: `decision_${card.cardId}_${Date.now()}`,
        cardId: card.cardId,
        workspaceId: card.workspaceId,
        missionId: card.missionId,
        status: 'REVISION_REQUESTED',
        approvedFingerprint: card.contentFingerprint,
        approvedBy: actorId,
        revisionFeedback: feedbackText || '원고 수정 요청',
        isAuthoritativeServerRecorded: !!isAuthoritativeServerConfirmed,
      };
    }

    return {
      decisionId: `decision_${card.cardId}_${Date.now()}`,
      cardId: card.cardId,
      workspaceId: card.workspaceId,
      missionId: card.missionId,
      status: 'CANCELLED',
      approvedFingerprint: card.contentFingerprint,
      approvedBy: actorId,
      rejectionReason: feedbackText || '사장님 취소',
      isAuthoritativeServerRecorded: !!isAuthoritativeServerConfirmed,
    };
  }
}
