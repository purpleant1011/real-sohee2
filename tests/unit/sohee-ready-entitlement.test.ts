import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  grantSoheeReadyStarterEntitlement,
  provisionEducationWorkspace,
  EDUCATION_TEST_BUDGET_DEFAULTS,
} from '@/features/sohee-ready/entitlement'
import { SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'
import type { SoheeReadinessSnapshot, ReadinessBlocker, ReadinessFactProvenance } from '@/features/sohee-ready/types'

// Mock getSoheeReadiness
vi.mock('@/features/sohee-ready/read-model', () => ({
  getSoheeReadiness: vi.fn(),
}))

import { getSoheeReadiness } from '@/features/sohee-ready/read-model'

describe('HF-05: SOHEE_READY Entitlement & Starter Grant Exactly-Once', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeProvenance = (
    key: any,
    verified: boolean,
    status: any
  ): ReadinessFactProvenance => ({
    key,
    verified,
    status,
    source: 'db:test',
    evidenceId: null,
    version: null,
    verifiedAt: verified ? '2026-09-12T00:00:00.000Z' : null,
    freshness: 'FRESH',
  })

  const mockPreReadySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-pre-ready-001',
    ready: false,
    evaluatedAt: '2026-09-12T00:00:00.000Z',
    blockers: [
      {
        code: 'INSTAGRAM_NOT_VERIFIED',
        factKey: 'INSTAGRAM_VERIFIED',
        message: '인스타그램 비즈니스 계정 인증 증거가 없습니다.',
        remediationAction: '인스타그램 연동하기',
        remediationHref: '/settings/channels',
      },
      {
        code: 'THREADS_NOT_VERIFIED',
        factKey: 'THREADS_VERIFIED',
        message: '스레드 비즈니스 계정 인증 증거가 없습니다.',
        remediationAction: '스레드 연동하기',
        remediationHref: '/settings/channels',
      },
    ],
    facts: {
      BUSINESS_VERIFIED: makeProvenance('BUSINESS_VERIFIED', true, 'VERIFIED'),
      INSTAGRAM_VERIFIED: makeProvenance('INSTAGRAM_VERIFIED', false, 'MISSING'),
      THREADS_VERIFIED: makeProvenance('THREADS_VERIFIED', false, 'MISSING'),
      BUSINESS_KNOWLEDGE_CONFIRMED: makeProvenance('BUSINESS_KNOWLEDGE_CONFIRMED', true, 'CONFIRMED'),
      TEXT_HARNESS_CONFIRMED: makeProvenance('TEXT_HARNESS_CONFIRMED', false, 'MISSING'),
      IMAGE_HARNESS_CONFIRMED: makeProvenance('IMAGE_HARNESS_CONFIRMED', false, 'MISSING'),
      OPERATING_POLICY_CONFIRMED: makeProvenance('OPERATING_POLICY_CONFIRMED', true, 'CONFIRMED'),
    },
  }

  const mockFullyReadySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-fully-ready-001',
    ready: true,
    evaluatedAt: '2026-09-12T00:00:00.000Z',
    blockers: [],
    facts: {
      BUSINESS_VERIFIED: makeProvenance('BUSINESS_VERIFIED', true, 'VERIFIED'),
      INSTAGRAM_VERIFIED: makeProvenance('INSTAGRAM_VERIFIED', true, 'VERIFIED'),
      THREADS_VERIFIED: makeProvenance('THREADS_VERIFIED', true, 'VERIFIED'),
      BUSINESS_KNOWLEDGE_CONFIRMED: makeProvenance('BUSINESS_KNOWLEDGE_CONFIRMED', true, 'CONFIRMED'),
      TEXT_HARNESS_CONFIRMED: makeProvenance('TEXT_HARNESS_CONFIRMED', true, 'CONFIRMED'),
      IMAGE_HARNESS_CONFIRMED: makeProvenance('IMAGE_HARNESS_CONFIRMED', true, 'CONFIRMED'),
      OPERATING_POLICY_CONFIRMED: makeProvenance('OPERATING_POLICY_CONFIRMED', true, 'CONFIRMED'),
    },
  }

  it('RED-01: Pre-ready workspace MUST fail-closed with 403 when requesting production starter entitlement', async () => {
    vi.mocked(getSoheeReadiness).mockResolvedValueOnce(mockPreReadySnapshot)

    const mockSupabase = {} as any

    await expect(
      grantSoheeReadyStarterEntitlement(mockSupabase, 'ws-pre-ready-001', 'user-001')
    ).rejects.toThrow(SoheeNotReadyError)

    // Ensure getSoheeReadiness was called with correct workspace ID
    expect(getSoheeReadiness).toHaveBeenCalledWith('ws-pre-ready-001', {
      supabaseClient: mockSupabase,
    })
  })

  it('RED-02: Fully-ready workspace receives exactly-once starter entitlement (50 Energy / 40,000 Credits)', async () => {
    vi.mocked(getSoheeReadiness).mockResolvedValueOnce(mockFullyReadySnapshot)

    const mockRpc = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        already_granted: false,
        energy_granted: 50,
        credits_granted: 40000,
        benefit_type: 'FREE_TASTE_50',
      },
      error: null,
    })

    const mockSupabase = {
      rpc: mockRpc,
    } as any

    const result = await grantSoheeReadyStarterEntitlement(
      mockSupabase,
      'ws-fully-ready-001',
      'user-001'
    )

    expect(result.granted).toBe(true)
    expect(result.alreadyGranted).toBe(false)
    expect(result.energyGranted).toBe(50)
    expect(result.creditsGranted).toBe(40000)
    expect(result.benefitType).toBe('FREE_TASTE_50')

    expect(mockRpc).toHaveBeenCalledWith('grant_sohee_ready_starter_entitlement', {
      p_workspace_id: 'ws-fully-ready-001',
      p_operator_id: 'user-001',
    })
  })

  it('RED-03: Repeated call for already-granted workspace returns idempotent success without duplicate grant', async () => {
    vi.mocked(getSoheeReadiness).mockResolvedValueOnce(mockFullyReadySnapshot)

    const mockRpc = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        already_granted: true,
        energy_granted: 0,
        credits_granted: 0,
        benefit_type: 'FREE_TASTE_50',
      },
      error: null,
    })

    const mockSupabase = {
      rpc: mockRpc,
    } as any

    const result = await grantSoheeReadyStarterEntitlement(
      mockSupabase,
      'ws-fully-ready-001',
      'user-001'
    )

    expect(result.granted).toBe(true)
    expect(result.alreadyGranted).toBe(true)
    expect(result.energyGranted).toBe(0)
    expect(result.creditsGranted).toBe(0)
  })

  it('RED-04: Provisioning an Education Workspace sets production energy = 0 and provides bounded EDUCATION_TEST_BUDGET', async () => {
    const mockRpc = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        workspace_id: 'ws-edu-001',
        is_new_workspace: true,
        energy_granted: 0,
        commercial_state: 'EDUCATION_MODE',
        education_budget: EDUCATION_TEST_BUDGET_DEFAULTS,
      },
      error: null,
    })

    const mockSupabase = {
      rpc: mockRpc,
    } as any

    const result = await provisionEducationWorkspace(mockSupabase, {
      userId: 'user-edu-001',
      workspaceName: '소희 테스트 매장',
      provider: 'google',
    })

    expect(result.success).toBe(true)
    expect(result.workspaceId).toBe('ws-edu-001')
    expect(result.energyGranted).toBe(0)
    expect(result.commercialState).toBe('EDUCATION_MODE')
    expect(result.educationBudget.textHarnessTestRuns).toBe(20)
    expect(result.educationBudget.imageHarnessTestRuns).toBe(10)

    expect(mockRpc).toHaveBeenCalledWith('provision_education_workspace', {
      p_user_id: 'user-edu-001',
      p_workspace_name: '소희 테스트 매장',
      p_provider: 'google',
    })
  })

  it('P0-2 Exactly-once Concurrency Test: 10 concurrent starter grant calls result in exactly 1 grant and 9 already_granted', async () => {
    vi.mocked(getSoheeReadiness).mockResolvedValue(mockFullyReadySnapshot)

    let grantCount = 0
    const mockRpc = vi.fn().mockImplementation(async () => {
      // Simulate DB atomic serialization: first call wins, concurrent duplicates see already_granted
      grantCount++
      if (grantCount === 1) {
        return {
          data: {
            success: true,
            already_granted: false,
            energy_granted: 50,
            credits_granted: 40000,
            benefit_type: 'FREE_TASTE_50',
          },
          error: null,
        }
      }
      return {
        data: {
          success: true,
          already_granted: true,
          energy_granted: 0,
          credits_granted: 0,
          benefit_type: 'FREE_TASTE_50',
        },
        error: null,
      }
    })

    const mockSupabase = {
      rpc: mockRpc,
    } as any

    // Run 10 concurrent requests
    const promises = Array.from({ length: 10 }, (_, i) =>
      grantSoheeReadyStarterEntitlement(mockSupabase, 'ws-fully-ready-001', `user-${i}`)
    )

    const results = await Promise.all(promises)

    // Verify exactly 1 grant and 9 duplicates
    const newlyGranted = results.filter((r) => r.granted && !r.alreadyGranted)
    const alreadyGranted = results.filter((r) => r.alreadyGranted)
    const totalEnergy = results.reduce((sum, r) => sum + r.energyGranted, 0)
    const totalCredits = results.reduce((sum, r) => sum + r.creditsGranted, 0)

    expect(newlyGranted.length).toBe(1)
    expect(alreadyGranted.length).toBe(9)
    expect(totalEnergy).toBe(50)
    expect(totalCredits).toBe(40000)
    expect(mockRpc).toHaveBeenCalledTimes(10)
  })
})
