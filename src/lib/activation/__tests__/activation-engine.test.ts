import { describe, it, expect } from 'vitest';
import { evaluateActivationJourney, calculateActivationScore } from '../activation-engine';

describe('V0.9 Actual Customer Activation & Free Taste WOW Engine (ANI-735)', () => {
  const mockWorkspaceId = 'ws-activation-prod-01';

  it('blocks Free Taste and stays in BUSINESS_PENDING when NTS is pending review', () => {
    const result = evaluateActivationJourney({
      workspaceId: mockWorkspaceId,
      ntsStatus: 'PENDING_REVIEW',
      agreementsAccepted: false,
      freeTasteGranted: false,
      remainingEnergy: 0,
      hasFirstProposal: false,
      firstActionVerified: false,
    });

    expect(result.stage).toBe('BUSINESS_PENDING');
    expect(result.businessVerified).toBe(false);
    expect(result.freeTasteGranted).toBe(false);
  });

  it('requires agreements after NTS is VERIFIED before taste grant', () => {
    const result = evaluateActivationJourney({
      workspaceId: mockWorkspaceId,
      ntsStatus: 'VERIFIED',
      agreementsAccepted: false,
      freeTasteGranted: false,
      remainingEnergy: 0,
      hasFirstProposal: false,
      firstActionVerified: false,
    });

    expect(result.stage).toBe('AGREEMENT_REQUIRED');
    expect(result.businessVerified).toBe(true);
    expect(result.freeTasteGranted).toBe(false);
  });

  it('progresses to TASTE_ACTIVE with 50 Energy once agreements and grant are complete', () => {
    const result = evaluateActivationJourney({
      workspaceId: mockWorkspaceId,
      ntsStatus: 'VERIFIED',
      agreementsAccepted: true,
      freeTasteGranted: true,
      remainingEnergy: 50,
      hasFirstProposal: false,
      firstActionVerified: false,
    });

    expect(result.stage).toBe('TASTE_ACTIVE');
    expect(result.remainingEnergy).toBe(50);
  });

  it('transitions to FIRST_CHAT_PLAN and then FIRST_PROPOSAL during Chat-First onboarding', () => {
    const step1 = evaluateActivationJourney({
      workspaceId: mockWorkspaceId,
      ntsStatus: 'VERIFIED',
      agreementsAccepted: true,
      freeTasteGranted: true,
      remainingEnergy: 50,
      firstGoalText: '9월 평일 주간 신규 고객 10명 유치하고 싶어요',
      hasFirstProposal: false,
      firstActionVerified: false,
    });
    expect(step1.stage).toBe('FIRST_CHAT_PLAN');

    const step2 = evaluateActivationJourney({
      workspaceId: mockWorkspaceId,
      ntsStatus: 'VERIFIED',
      agreementsAccepted: true,
      freeTasteGranted: true,
      remainingEnergy: 50,
      firstGoalText: '9월 평일 주간 신규 고객 10명 유치하고 싶어요',
      hasFirstProposal: true,
      firstActionVerified: false,
    });
    expect(step2.stage).toBe('FIRST_PROPOSAL');
  });

  it('delivers Proof of Work and recommends paid conversion when action is verified', () => {
    const result = evaluateActivationJourney({
      workspaceId: mockWorkspaceId,
      ntsStatus: 'VERIFIED',
      agreementsAccepted: true,
      freeTasteGranted: true,
      remainingEnergy: 5, // 45 energy spent
      firstGoalText: '9월 예약 유치',
      hasFirstProposal: true,
      firstActionVerified: true,
      verifiedReceiptId: 'rcpt_meta_live_123',
    });

    expect(result.stage).toBe('FIRST_VERIFIED_ACTION');
    expect(result.proofOfWorkSummary).toBeDefined();
    expect(result.proofOfWorkSummary?.actionsCount).toBe(1);
    expect(result.proofOfWorkSummary?.usedEnergy).toBe(45);
    expect(result.proofOfWorkSummary?.nextRecommendedAction).toContain('스타터 플랜');
  });

  it('maintains backwards compatibility for calculateActivationScore', () => {
    const score = calculateActivationScore({
      businessVerified: true,
      agreementsAccepted: true,
      storeProfileComplete: true,
      channelConnected: true,
      firstTestPublished: true,
    });
    expect(score.totalScore).toBe(100);
    expect(score.isFullyActivated).toBe(true);
  });
});
