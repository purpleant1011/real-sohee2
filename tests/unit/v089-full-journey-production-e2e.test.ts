import { describe, it, expect, vi } from 'vitest';
import {
  validateBusinessNumberChecksum
} from '@/lib/auth/business-verification';
import {
  getOrCreateSignupApplication,
  updateSignupBusinessInfo,
  submitSignupAgreements,
  finalizeSignupAndActivateTrial
} from '@/features/auth/signup-state-machine';

describe('V0.8.9 Full-Journey Production E2E Suite (ANI-567: Release Gate)', () => {
  const mockUserId = 'usr-e2e-test-1011';
  const mockWorkspaceId = 'ws-e2e-test-1011';
  const validBusinessNumber = '120-81-47521';

  let currentApp = {
    id: 'app-e2e-01',
    user_id: mockUserId,
    state: 'FORM_REQUIRED',
    business_number: null as string | null,
    company_name: null as string | null,
    representative_name: null as string | null,
    agreements_completed: false,
    completed_at: null as string | null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workspace_id: null as string | null
  };

  const createMockChain = () => {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: currentApp, error: null })),
      single: vi.fn(async () => ({ data: currentApp, error: null })),
      insert: vi.fn(async (row: any) => {
        currentApp = { ...currentApp, ...row };
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn(async () => ({ data: currentApp, error: null }))
          })
        };
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn((updates: any) => {
        currentApp = { ...currentApp, ...updates };
        return {
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn(async () => ({ data: currentApp, error: null }))
            })
          })
        };
      })
    };
  };

  const mockSupabase = {
    from: vi.fn((table: string) => createMockChain()),
    rpc: vi.fn(async (fn: string, args: any) => {
      if (fn === 'bootstrap_workspace_trial' || fn === 'finalize_signup_and_grant_taste' || fn === 'provision_education_workspace') {
        return {
          data: {
            workspace_id: mockWorkspaceId,
            trial_id: 'trial-e2e-01',
            energy_granted: 50,
            initial_credits: 40000,
            status: 'ACTIVE',
            plan_tier: 'FREE_TASTE',
            is_new_workspace: true,
            verification_status: 'VERIFIED'
          },
          error: null
        };
      }
      return { data: null, error: null };
    })
  };

  it('Step 1: 본인 인증 완료 후 초기 가입 상태는 FORM_REQUIRED 여야 한다', async () => {
    const app = await getOrCreateSignupApplication(mockSupabase as any, mockUserId);
    expect(app.state).toBe('FORM_REQUIRED');
  });

  it('Step 2: 사업자번호 체크섬 및 진위확인 통과 시 AGREEMENT_REQUIRED로 전이되어야 한다', async () => {
    expect(validateBusinessNumberChecksum(validBusinessNumber)).toBe(true);

    const updatedApp = await updateSignupBusinessInfo(mockSupabase as any, mockUserId, {
      businessNumber: validBusinessNumber,
      companyName: '소희테스트컴퍼니',
      representativeName: '김대표',
      isVerified: true
    });

    expect(updatedApp.state).toBe('AGREEMENT_REQUIRED');
    expect(updatedApp.business_number).toBe(validBusinessNumber);
  });

  it('Step 3: 4대 법적 약관 및 채널 위임 개별 동의 시 TASTE_READY로 전이되어야 한다', async () => {
    const updatedApp = await submitSignupAgreements(mockSupabase as any, mockUserId, {
      termsOfService: true,
      privacyPolicy: true,
      aiDataProcessing: true,
      channelDelegation: true
    }, '127.0.0.1');

    expect(updatedApp.state).toBe('TASTE_READY');
  });

  it('Step 4: 트라이얼 활성화 시 bootstrap_workspace_trial RPC를 통해 50 Energy가 원자적으로 지급되고 상태는 COMPLETED가 되어야 한다', async () => {
    const result = await finalizeSignupAndActivateTrial(mockSupabase as any, mockUserId, 'google');
    expect(result.success).toBe(true);
    expect(result.workspaceId).toBe(mockWorkspaceId);
    expect(result.planTier).toBe('FREE_TASTE');
    expect(result.energyGranted).toBe(50);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(expect.stringMatching(/bootstrap_workspace_trial|finalize_signup_and_grant_taste|provision_education_workspace/), expect.objectContaining({
      p_user_id: mockUserId,
      p_provider: 'google'
    }));
  });
});
