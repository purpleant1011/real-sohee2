import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  submitSignupAgreements,
  finalizeSignupAndActivateTrial,
  finalizeSignupAndActivateFreeTaste,
  ensureUserProfile,
  type SignupApplicationRecord,
  type AgreementSubmission
} from '../signup-state-machine'

// Mock trial-bootstrap
vi.mock('../trial-bootstrap', () => ({
  bootstrapWorkspaceTrial: vi.fn(async () => ({
    success: true,
    workspaceId: 'ws-test-new-123',
    isNewTrial: true
  }))
}))

describe('Signup State Machine & Security Invariants [ANI-733, ANI-727]', () => {
  const validAgreements: AgreementSubmission = {
    termsOfService: true,
    privacyPolicy: true,
    aiDataProcessing: true,
    channelDelegation: true
  }

  function createMockSupabase(appRecord: Partial<SignupApplicationRecord>, existingVerifiedInOtherWs: boolean = false) {
    const currentApp = {
      id: 'app-1',
      user_id: 'user-1',
      workspace_id: null,
      state: 'AGREEMENT_REQUIRED',
      business_number: '1234567890',
      company_name: '테스트상호',
      representative_name: '홍길동',
      agreements_completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...appRecord
    }

    return {
      from: vi.fn((table: string) => {
        if (table === 'signup_applications') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: currentApp, error: null }),
            single: vi.fn().mockResolvedValue({ data: currentApp, error: null }),
            update: vi.fn((updates: any) => ({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { ...currentApp, ...updates },
                error: null
              })
            }))
          }
        }
        if (table === 'user_agreements') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: existingVerifiedInOtherWs ? [{ workspace_id: 'ws-other-999', status: 'VERIFIED' }] : [],
              error: null
            }),
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'business_profiles' || table === 'agent_energy_ledgers' || table === 'agent_energy_transactions') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            insert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null })
        }
      }),
      rpc: vi.fn(async (fnName: string, args: any) => {
        if (fnName === 'finalize_signup_and_grant_taste' || fnName === 'provision_education_workspace') {
          const isVerified = currentApp.state === 'TASTE_READY'
          return {
            data: {
              success: true,
              workspace_id: 'ws-test-new-123',
              is_new_workspace: true,
              energy_granted: isVerified ? 50 : 0,
              plan_tier: 'FREE_TASTE',
              verification_status: isVerified ? 'VERIFIED' : 'PENDING'
            },
            error: null
          }
        }
        return { data: null, error: null }
      })
    } as any
  }

  describe('ANI-733: NTS PENDING_REVIEW -> Taste Grant Bypass Prevention', () => {
    it('STRICTLY BLOCKS agreement submission when state is BUSINESS_PENDING (NTS unverified)', async () => {
      const mockSupabase = createMockSupabase({
        state: 'BUSINESS_PENDING',
        business_number: '1234567890',
        company_name: '대기매장'
      })

      await expect(
        submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      ).rejects.toThrow(/BUSINESS_PENDING|ANI-733/)
    })

    it('STRICTLY BLOCKS agreement submission when state is FORM_REQUIRED', async () => {
      const mockSupabase = createMockSupabase({
        state: 'FORM_REQUIRED'
      })

      await expect(
        submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      ).rejects.toThrow(/ANI-733/)
    })

    it('STRICTLY BLOCKS agreement submission if business number is invalid or placeholder', async () => {
      const mockSupabase = createMockSupabase({
        state: 'AGREEMENT_REQUIRED',
        business_number: '0000000000'
      })

      await expect(
        submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      ).rejects.toThrow(/ANI-603/)
    })

    it('allows agreement submission and transitions to TASTE_READY when AGREEMENT_REQUIRED and verified', async () => {
      const mockSupabase = createMockSupabase({
        state: 'AGREEMENT_REQUIRED',
        business_number: '1234567890',
        company_name: '검증매장'
      })

      const res = await submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      expect(res.state).toBe('TASTE_READY')
      expect(res.agreements_completed).toBe(true)
    })

    it('ANI-1334 REG-ANI-733: allows agreement submission and transitions to VERIFICATION_PENDING when MANUAL_REVIEW', async () => {
      const mockSupabase = createMockSupabase({
        state: 'MANUAL_REVIEW',
        business_number: '1234567890',
        company_name: '수동심사매장'
      })

      const res = await submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      expect(res.state).toBe('VERIFICATION_PENDING')
      expect(res.agreements_completed).toBe(true)
    })

    it('ANI-1424: allows idempotent re-submission when state is already VERIFICATION_PENDING (prevents deadlock on retry)', async () => {
      const mockSupabase = createMockSupabase({
        state: 'VERIFICATION_PENDING',
        business_number: '0000000000',
        company_name: '예시회사',
        agreements_completed: true,
        workspace_id: null
      })

      const res = await submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      expect(res.state).toBe('VERIFICATION_PENDING')
      expect(res.agreements_completed).toBe(true)
    })

    it('ANI-1424: allows idempotent re-submission when state is already TASTE_READY (prevents deadlock on retry)', async () => {
      const mockSupabase = createMockSupabase({
        state: 'TASTE_READY',
        business_number: '1234567890',
        company_name: '검증매장',
        agreements_completed: true,
        workspace_id: null
      })

      const res = await submitSignupAgreements(mockSupabase, 'user-1', validAgreements)
      expect(res.state).toBe('TASTE_READY')
      expect(res.agreements_completed).toBe(true)
    })
  })

  describe('ANI-727 & ANI-733: Free Taste Activation & Anti-Abuse Invariants', () => {
    it('BLOCKS Free Taste activation if application state is not TASTE_READY / TRIAL_READY', async () => {
      const mockSupabase = createMockSupabase({
        state: 'BUSINESS_PENDING',
        agreements_completed: false
      })

      await expect(
        finalizeSignupAndActivateFreeTaste(mockSupabase, 'user-1')
      ).rejects.toThrow(/무료 맛보기 Energy|ANI-733/)
    })

    it('BLOCKS Free Taste activation if agreements were not completed', async () => {
      const mockSupabase = createMockSupabase({
        state: 'TASTE_READY',
        agreements_completed: false
      })

      await expect(
        finalizeSignupAndActivateFreeTaste(mockSupabase, 'user-1')
      ).rejects.toThrow(/필수 약관 및 채널 위임/)
    })

    it('ANTI-ABUSE: BLOCKS duplicate subsidy if the same verified business number already received Free Taste in another workspace', async () => {
      const mockSupabase = createMockSupabase(
        {
          state: 'TASTE_READY',
          agreements_completed: true,
          business_number: '1234567890'
        },
        true // already verified in another workspace
      )

      await expect(
        finalizeSignupAndActivateFreeTaste(mockSupabase, 'user-1')
      ).rejects.toThrow(/이미 소희 무료 맛보기 혜택이 지급된 사업자등록번호|ANI-733/)
    })

    it('SUCCESS: Grants Free Taste Energy (50 units) exactly once for genuine verified business and completes state machine', async () => {
      const mockSupabase = createMockSupabase(
        {
          state: 'TASTE_READY',
          agreements_completed: true,
          business_number: '1234567890',
          company_name: '소희카페',
          representative_name: '홍길동'
        },
        false // genuine new business
      )

      const result = await finalizeSignupAndActivateFreeTaste(mockSupabase, 'user-1')
      expect(result.success).toBe(true)
      expect(result.workspaceId).toBe('ws-test-new-123')
      expect(result.energyGranted).toBe(50)
      expect(result.planTier).toBe('FREE_TASTE')
    })

    it('ANI-1334 REG-ANI-733: Activates Free Taste workspace with 0 units for VERIFICATION_PENDING (manual review)', async () => {
      const mockSupabase = createMockSupabase(
        {
          state: 'VERIFICATION_PENDING',
          agreements_completed: true,
          business_number: '1234567890',
          company_name: '수동심사매장',
          representative_name: '이순신'
        },
        false
      )

      const result = await finalizeSignupAndActivateFreeTaste(mockSupabase, 'user-1')
      expect(result.success).toBe(true)
      expect(result.workspaceId).toBe('ws-test-new-123')
      expect(result.energyGranted).toBe(0)
      expect(result.verificationStatus).toBe('PENDING')
    })
  })

  describe('ANI-1334: ensureUserProfile DB Invariant', () => {
    it('upserts profile using full_name or email prefix as default display_name', async () => {
      let upsertPayload: any = null
      const mockSupabase: any = {
        from: (table: string) => {
          if (table === 'profiles') {
            return {
              upsert: vi.fn(async (payload) => {
                upsertPayload = payload
                return { error: null }
              })
            }
          }
          return {}
        }
      }

      await ensureUserProfile(mockSupabase, {
        id: 'user-google-123',
        user_metadata: { full_name: '홍길동 원장' },
        email: 'hong@example.com'
      })

      expect(upsertPayload).not.toBeNull()
      expect(upsertPayload.id).toBe('user-google-123')
      expect(upsertPayload.display_name).toBe('홍길동 원장')
    })
  })
})

