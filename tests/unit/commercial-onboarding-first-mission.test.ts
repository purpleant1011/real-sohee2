import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FirstMissionRunner,
  type FirstMissionBusinessProfile,
  type FirstMissionResult,
} from '@/features/onboarding/first-mission-runner';
import {
  completeCommercialOnboarding,
  isOnboardingCompleted,
  canCompleteOnboarding,
  resetOnboardingStoreForTesting,
  OnboardingFlow,
} from '@/features/onboarding/onboarding-flow';
import { ContentDraftService } from '@/features/content/content-draft-service';
import { AgentApprovalService } from '@/features/agent-session/agent-approval-service';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ANI-1753: FirstMissionRunner / OnboardingFlow 가 createServerSupabaseClient() 로 상태를
// 영속화한다. 대역이 없으면 테스트 프로세스가 실제 Supabase 로 요청을 보내 5초 타임아웃에 걸린다.
// 이 테스트는 인메모리 스토어 동작을 검증하므로 DB 대역은 빈 결과를 돌려주면 충분하다.
vi.mock('@/lib/supabase/server', async () => (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule());
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule());

describe('ANI-988: Commercial Onboarding & First Safe Mission (Fail-Closed Gate)', () => {
  const TEST_WORKSPACE = '11111111-2222-3333-4444-555555555555';
  const validProfile: FirstMissionBusinessProfile = {
    businessName: '바이름 헤어살롱 강남점',
    category: '헤어/미용',
    signatureService: '시그니처 볼륨매직 & 두피 스파',
    targetAudience: '인근 2030 직장인 여성',
    brandTone: '따뜻하고 세련되며 전문적인',
    channels: ['INSTAGRAM', 'NAVER_BLOG'],
    marketingGoal: '첫 방문 고객 유치 및 웰컴 프로모션',
  };

  beforeEach(() => {
    FirstMissionRunner.resetStoreForTesting();
    resetOnboardingStoreForTesting();
    ContentDraftService.resetStoreForTesting();
    AgentApprovalService.resetMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  describe('1. FirstMissionRunner: Safe E4 Mission Formulation & Durable Proof', () => {
    it('fails closed and rejects mission formulation when business profile is missing or invalid', async () => {
      await expect(
        FirstMissionRunner.executeFirstSafeMission(TEST_WORKSPACE, {
          businessName: '',
        })
      ).rejects.toThrow(/INVALID_BUSINESS_PROFILE/);

      await expect(
        FirstMissionRunner.executeFirstSafeMission('', validProfile)
      ).rejects.toThrow(/INVALID_WORKSPACE/);
    });

    it('executes first safe mission, generates durable ContentDraft and issues AWAITING_APPROVAL card', async () => {
      const result = await FirstMissionRunner.executeFirstSafeMission(TEST_WORKSPACE, validProfile);

      expect(result.success).toBe(true);
      expect(result.workspaceId).toBe(TEST_WORKSPACE);
      expect(result.missionId).toBeDefined();
      expect(result.missionId.length).toBeGreaterThan(5);

      // Durable Draft verification
      expect(result.draftId).toBeDefined();
      expect(result.draftId.length).toBeGreaterThanOrEqual(10);
      expect(result.draft.topic).toContain('바이름 헤어살롱 강남점');
      expect(result.draft.channel).toBe('INSTAGRAM');
      expect(result.draft.content.length).toBeGreaterThanOrEqual(20);
      expect(result.draft.hashtags.length).toBeGreaterThan(0);

      // Verify draft is durably persisted in ContentDraftService
      const persistedDraft = await ContentDraftService.getDraft(result.draftId, TEST_WORKSPACE);
      expect(persistedDraft).not.toBeNull();
      expect(persistedDraft?.draftId).toBe(result.draftId);
      expect(persistedDraft?.content).toBe(result.draft.content);

      // 사장님 승인 대기 카드 (AWAITING_APPROVAL) verification
      expect(result.approvalStatus).toBe('AWAITING_APPROVAL');
      expect(result.approvalCard).toBeDefined();
      expect(result.approvalCard.status).toBe('AWAITING_APPROVAL');
      expect(result.approvalCard.draftId).toBe(result.draftId);
      expect(result.approvalCard.title).toContain('첫 안전 미션');

      // Proof ID & Cryptographic Proof Verification
      expect(result.proofId).toBeDefined();
      expect(result.proofId.startsWith('proof_') || result.proofId.startsWith('ev_proof_')).toBe(true);

      // Multi-session Same Truth: Can retrieve first mission by workspace
      const retrieved = await FirstMissionRunner.getFirstMission(TEST_WORKSPACE);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.draftId).toBe(result.draftId);
      expect(retrieved?.proofId).toBe(result.proofId);
    });

    it('rejects synthetic banned templates and ensures genuine copywriting for first mission', async () => {
      // Custom generator attempting synthetic banned output
      await expect(
        FirstMissionRunner.executeFirstSafeMission(TEST_WORKSPACE, validProfile, {
          generatorFn: async () => ({
            draftId: 'test-fake',
            topic: '테스트',
            channel: 'INSTAGRAM',
            caption: '맞춤형 마케팅 원고가 생성되었습니다. 사장님 확인 바랍니다.',
            hashtags: ['#테스트'],
          }),
        })
      ).rejects.toThrow(/SYNTHETIC_CONTENT_REJECTED/);
    });
  });

  describe('2. Fail-Closed Onboarding Gate: Proof Requirement', () => {
    it('blocks marking onboarding complete before first safe mission is executed and verified', async () => {
      // Workspace has not executed any mission
      const check = await canCompleteOnboarding(TEST_WORKSPACE);
      expect(check.canComplete).toBe(false);
      expect(check.reason).toContain('FIRST_SAFE_MISSION_PROOF_REQUIRED');

      // Attempting to complete onboarding must fail closed
      const attempt = await completeCommercialOnboarding(TEST_WORKSPACE);
      expect(attempt.success).toBe(false);
      expect(attempt.onboardingCompleted).toBe(false);
      expect(attempt.error).toContain('FIRST_SAFE_MISSION_PROOF_REQUIRED');

      // Onboarding status must remain false
      const isCompleted = await isOnboardingCompleted(TEST_WORKSPACE);
      expect(isCompleted).toBe(false);
    });

    it('rejects forged or non-matching proofId when completing onboarding', async () => {
      // Execute mission to generate real proof
      await FirstMissionRunner.executeFirstSafeMission(TEST_WORKSPACE, validProfile);

      // Attempt completion with forged proof
      const forgedAttempt = await completeCommercialOnboarding(TEST_WORKSPACE, {
        proofId: 'proof_forged_fake_12345',
      });
      expect(forgedAttempt.success).toBe(false);
      expect(forgedAttempt.onboardingCompleted).toBe(false);
      expect(forgedAttempt.error).toContain('INVALID_PROOF');

      // Still not completed
      expect(await isOnboardingCompleted(TEST_WORKSPACE)).toBe(false);
    });

    it('successfully completes onboarding once valid first mission proof is verified', async () => {
      // 1. Execute first mission
      const mission = await FirstMissionRunner.executeFirstSafeMission(TEST_WORKSPACE, validProfile);
      expect(mission.proofId).toBeDefined();

      // 2. Pre-check passes
      const check = await canCompleteOnboarding(TEST_WORKSPACE);
      expect(check.canComplete).toBe(true);

      // 3. Complete onboarding with verified proof
      const completion = await completeCommercialOnboarding(TEST_WORKSPACE, {
        proofId: mission.proofId,
      });

      expect(completion.success).toBe(true);
      expect(completion.onboardingCompleted).toBe(true);
      expect(completion.proofId).toBe(mission.proofId);
      expect(completion.draftId).toBe(mission.draftId);
      expect(completion.completedAt).toBeDefined();

      // 4. Verification from DB/SSOT
      const isDone = await isOnboardingCompleted(TEST_WORKSPACE);
      expect(isDone).toBe(true);
    });
  });

  describe('3. OnboardingFlow Component Integration', () => {
    it('displays first safe mission result card with AWAITING_APPROVAL badge and blocks premature completion', async () => {
      const onCompleteMock = vi.fn();

      render(
        React.createElement(OnboardingFlow, {
          workspaceId: TEST_WORKSPACE,
          initialProfile: validProfile,
          onComplete: onCompleteMock,
        })
      );

      // Check initial screen
      expect(screen.getAllByText(/비즈니스 프로필/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(validProfile.businessName)).toBeInTheDocument();

      // Before mission execution, Complete button triggers fail-closed error
      const completeBtn = screen.getByTestId('complete-onboarding-btn');
      fireEvent.click(completeBtn);

      await waitFor(() => {
        expect(screen.getByTestId('onboarding-error-banner')).toBeInTheDocument();
        expect(screen.getByTestId('onboarding-error-banner')).toHaveTextContent(/첫 안전 미션/);
      });
      expect(onCompleteMock).not.toHaveBeenCalled();

      // Click "첫 안전 미션 실행"
      const executeBtn = screen.getByTestId('execute-first-mission-btn');
      fireEvent.click(executeBtn);

      // Result card should appear with AWAITING_APPROVAL badge, draft ID, and proof ID
      await waitFor(() => {
        expect(screen.getByTestId('first-mission-result-card')).toBeInTheDocument();
      }, { timeout: 10000 });

      expect(screen.getByTestId('mission-approval-badge')).toHaveTextContent('AWAITING_APPROVAL');
      expect(screen.getByTestId('mission-draft-id')).toBeInTheDocument();
      expect(screen.getByTestId('mission-proof-id')).toBeInTheDocument();

      // Now click "온보딩 완료"
      fireEvent.click(screen.getByTestId('complete-onboarding-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('onboarding-success-banner')).toBeInTheDocument();
      }, { timeout: 10000 });
      expect(onCompleteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          onboardingCompleted: true,
        })
      );
    });
  });
});
