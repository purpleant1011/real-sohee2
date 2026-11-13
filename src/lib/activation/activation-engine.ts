/**
 * Sohee V0.9 Actual Customer Activation & Free Taste WOW Engine (ANI-735)
 * 
 * Manages:
 * 1. NTS BUSINESS_VERIFIED invariant before Free Taste grant.
 * 2. Chat-First WOW loop: One sentence goal -> Structured Proposal -> Action -> Proof of Work.
 * 3. Exact-once Free Taste (50 Energy, ~₩5,000 subsidy ceiling) progression.
 * 4. Zero legacy SC / 14-day trial copy. Honest non-running state until activated.
 */

export interface ActivationScoreBreakdown {
  businessVerified: boolean;
  agreementsAccepted: boolean;
  storeProfileComplete: boolean;
  channelConnected: boolean;
  firstTestPublished: boolean;
  totalScore: number;
  isFullyActivated: boolean;
  nextBestAction: string;
}

export function calculateActivationScore(context: {
  businessVerified: boolean;
  agreementsAccepted: boolean;
  storeProfileComplete: boolean;
  channelConnected: boolean;
  firstTestPublished: boolean;
}): ActivationScoreBreakdown {
  let score = 0;
  if (context.businessVerified) score += 25;
  if (context.agreementsAccepted) score += 15;
  if (context.storeProfileComplete) score += 20;
  if (context.channelConnected) score += 20;
  if (context.firstTestPublished) score += 20;

  let nextAction = '사업자등록 정보를 검증해 주세요.';
  if (!context.businessVerified) {
    nextAction = '사업자등록 정보 심사를 완료해 주세요.';
  } else if (!context.agreementsAccepted) {
    nextAction = 'AI 에이전트 위임 약관에 동의해 주세요.';
  } else if (!context.storeProfileComplete) {
    nextAction = '매장 대표 메뉴와 영업시간을 등록해 주세요.';
  } else if (!context.channelConnected) {
    nextAction = '인스타그램 또는 네이버 블로그 채널을 연결해 주세요.';
  } else if (!context.firstTestPublished) {
    nextAction = '첫 번째 무료 테스트 마케팅 포스팅을 발행해 보세요!';
  } else {
    nextAction = '축하합니다! 소희가 24시간 자율 마케팅을 시작했습니다.';
  }

  return {
    ...context,
    totalScore: score,
    isFullyActivated: score >= 80,
    nextBestAction: nextAction
  };
}

export type V09ActivationStage =
  | 'BUSINESS_REQUIRED'
  | 'BUSINESS_PENDING'
  | 'BUSINESS_VERIFIED'
  | 'AGREEMENT_REQUIRED'
  | 'TASTE_READY'
  | 'TASTE_ACTIVE'
  | 'FIRST_CHAT_PLAN'
  | 'FIRST_PROPOSAL'
  | 'FIRST_VERIFIED_ACTION'
  | 'PROOF_OF_WORK_DELIVERED'
  | 'TASTE_EXHAUSTED'
  | 'PAID_ACTIVE';

export interface V09ActivationState {
  workspaceId: string;
  stage: V09ActivationStage;
  businessVerified: boolean;
  ntsStatus: 'VERIFIED' | 'PENDING_REVIEW' | 'REJECTED' | 'NOT_SUBMITTED';
  agreementsAccepted: boolean;
  freeTasteGranted: boolean;
  remainingEnergy: number;
  totalEnergyCap: number; // default 50
  firstGoalText?: string;
  hasFirstProposal: boolean;
  firstActionVerified: boolean;
  verifiedReceiptId?: string;
  proofOfWorkSummary?: {
    actionsCount: number;
    usedEnergy: number;
    verifiedChannel: string;
    verifiedOutcome: string;
    nextRecommendedAction: string;
  };
}

export function evaluateActivationJourney(context: {
  workspaceId: string;
  ntsStatus: 'VERIFIED' | 'PENDING_REVIEW' | 'REJECTED' | 'NOT_SUBMITTED';
  agreementsAccepted: boolean;
  freeTasteGranted: boolean;
  remainingEnergy: number;
  firstGoalText?: string;
  hasFirstProposal: boolean;
  firstActionVerified: boolean;
  verifiedReceiptId?: string;
}): V09ActivationState {
  const businessVerified = context.ntsStatus === 'VERIFIED';
  let stage: V09ActivationStage = 'BUSINESS_REQUIRED';

  if (!businessVerified) {
    stage = context.ntsStatus === 'PENDING_REVIEW' ? 'BUSINESS_PENDING' : 'BUSINESS_REQUIRED';
  } else if (!context.agreementsAccepted) {
    stage = 'AGREEMENT_REQUIRED';
  } else if (!context.freeTasteGranted) {
    stage = 'TASTE_READY';
  } else if (context.firstActionVerified) {
    stage = 'FIRST_VERIFIED_ACTION';
  } else if (context.hasFirstProposal) {
    stage = 'FIRST_PROPOSAL';
  } else if (context.firstGoalText) {
    stage = 'FIRST_CHAT_PLAN';
  } else {
    stage = 'TASTE_ACTIVE';
  }

  const usedEnergy = Math.max(0, 50 - context.remainingEnergy);

  let proofOfWorkSummary = undefined;
  if (context.firstActionVerified && context.verifiedReceiptId) {
    proofOfWorkSummary = {
      actionsCount: 1,
      usedEnergy,
      verifiedChannel: 'INSTAGRAM',
      verifiedOutcome: '실측 Read-After-Write 검증 영수증 확보',
      nextRecommendedAction: context.remainingEnergy > 10
        ? '다음 주간 예약 유치를 위한 블로그 자동 발행 예약'
        : '스타터 플랜 (₩150,000 / 월 1,500 Energy) 전환하여 24시간 자율 가동 유지'
    };
  }

  return {
    workspaceId: context.workspaceId,
    stage,
    businessVerified,
    ntsStatus: context.ntsStatus,
    agreementsAccepted: context.agreementsAccepted,
    freeTasteGranted: context.freeTasteGranted,
    remainingEnergy: context.remainingEnergy,
    totalEnergyCap: 50,
    firstGoalText: context.firstGoalText,
    hasFirstProposal: context.hasFirstProposal,
    firstActionVerified: context.firstActionVerified,
    verifiedReceiptId: context.verifiedReceiptId,
    proofOfWorkSummary
  };
}
