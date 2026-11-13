import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistKnowledgeHarness } from '@/features/knowledge/knowledge-server'
import type { KnowledgeHarnessVersion } from '@/features/knowledge/knowledge-manager'
import { GET as getCurrentKnowledge } from '@/app/api/onboarding/knowledge/current/route'
import { POST as generateTextHarness } from '@/app/api/onboarding/text-harness/generate/route'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/features/text-harness/provider-text-calibration-service', () => ({
  generateTextCalibrationSamples: vi.fn().mockImplementation((params) => {
    if (!params.businessType) {
      const err = new Error('Business type must be specified for text calibration grounding')
      ;(err as any).code = 'MISSING_BUSINESS_TYPE'
      throw err
    }
    return Promise.resolve({
      success: true,
      model: 'gemini-3.5-flash-lite',
      styleSummary: '테스트 스타일',
      samples: [
        { id: '1', headline: '제목1', body: '본문1', channel: 'instagram', hashtags: [] },
        { id: '2', headline: '제목2', body: '본문2', channel: 'instagram', hashtags: [] },
        { id: '3', headline: '제목3', body: '본문3', channel: 'instagram', hashtags: [] },
      ],
      extractedRules: {},
    })
  }),
  TextCalibrationProviderError: class TextCalibrationProviderError extends Error {
    constructor(message: string, public readonly code = 'PROVIDER_ERROR') {
      super(message)
      this.name = 'TextCalibrationProviderError'
    }
  },
}))

describe('ANI-1474 / R4-09: Business Knowledge Differentiator & Text Grounding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists DIFFERENTIATOR facts into active knowledge harness so businessType is retained', async () => {
    let insertedRow: any = null
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_knowledge_harnesses') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
            insert: vi.fn().mockImplementation((row: any) => {
              insertedRow = row
              return Promise.resolve({ error: null })
            }),
          }
        }
        return {}
      }),
    }

    const version: KnowledgeHarnessVersion = {
      id: 'bkh_test_01',
      workspaceId: 'ws_test_01',
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      createdBy: 'user_01',
      factsSnapshot: [
        {
          id: 'ckf_1',
          workspaceId: 'ws_test_01',
          candidateId: 'cand_1',
          category: 'MENU',
          factKey: '대표 시술',
          factValue: '1:1 맞춤형 레이어드 컷',
          status: 'ACTIVE',
          confirmedBy: 'user_01',
          confirmedAt: new Date().toISOString(),
        },
        {
          id: 'ckf_2',
          workspaceId: 'ws_test_01',
          candidateId: 'cand_2',
          category: 'DIFFERENTIATOR',
          factKey: '매장 특징',
          factValue: '청라 1인 미용실 헤어살롱',
          status: 'ACTIVE',
          confirmedBy: 'user_01',
          confirmedAt: new Date().toISOString(),
        },
      ],
    }

    await persistKnowledgeHarness(version, mockSupabase)

    expect(insertedRow).not.toBeNull()
    const hasDifferentiatorInPolicies = insertedRow.policies?.some(
      (p: any) => p.key === '매장 특징' || p.category === 'DIFFERENTIATOR'
    )
    const hasDifferentiatorInIdentity = Boolean(
      insertedRow.business_identity?.businessType ||
      insertedRow.business_identity?.differentiators?.length
    )

    expect(hasDifferentiatorInPolicies || hasDifferentiatorInIdentity).toBe(true)
  })

  it('resolves businessType from active knowledge harness when calling text-harness/generate without businessType in body', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr_01' } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws_01' }] }),
              }),
            }),
          }
        }
        if (table === 'workspace_knowledge_harnesses') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      harness_version_id: 'bkh_1',
                      version_no: 1,
                      is_active: true,
                      business_identity: { businessType: '헤어살롱' },
                      offerings: [{ key: '메뉴', value: '레이어드컷' }],
                      policies: [{ key: '특징', value: '헤어살롱', category: 'DIFFERENTIATOR' }],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'workspaces' || table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { name: '청라살롱', business_name: '청라살롱', industry: '미용업' } }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient as any)

    // Request with empty body (no businessType provided)
    const req = new Request('http://localhost/api/onboarding/text-harness/generate', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const res = await generateTextHarness(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.samples.length).toBe(3)
  })

  it('carries forward businessType from signup/business truth into confirmed knowledge when facts lack differentiator', async () => {
    let insertedRow: any = null
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_knowledge_harnesses') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
            insert: vi.fn().mockImplementation((row: any) => {
              insertedRow = row
              return Promise.resolve({ error: null })
            }),
          }
        }
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { business_name: '예시회사', industry: '주택 및 분양 대행업' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'signup_applications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { company_name: '예시회사', business_type: '분양 서비스' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { name: '예시회사' },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    // Facts snapshot without any DIFFERENTIATOR (exactly matching Controller production case)
    const version: KnowledgeHarnessVersion = {
      id: 'bkh_1789631891165_f1wbi',
      workspaceId: 'ws_controller_test',
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      createdBy: 'user_controller',
      factsSnapshot: [
        {
          id: 'ckf_1',
          workspaceId: 'ws_controller_test',
          candidateId: 'cand_1',
          category: 'MENU',
          factKey: '대표 서비스',
          factValue: '아파트 분양 서비스, 주택 신규 분양 정보 제공',
          status: 'ACTIVE',
          confirmedBy: 'user_controller',
          confirmedAt: new Date().toISOString(),
        },
        {
          id: 'ckf_2',
          workspaceId: 'ws_controller_test',
          candidateId: 'cand_2',
          category: 'HOURS',
          factKey: '위치',
          factValue: '대구광역시',
          status: 'ACTIVE',
          confirmedBy: 'user_controller',
          confirmedAt: new Date().toISOString(),
        },
      ],
    }

    await persistKnowledgeHarness(version, mockSupabase)

    expect(insertedRow).not.toBeNull()
    expect(insertedRow.business_identity?.businessType).toBe('주택 및 분양 대행업')
    const hasDifferentiator = insertedRow.policies?.some(
      (p: any) => p.category === 'DIFFERENTIATOR' && p.value === '주택 및 분양 대행업'
    )
    expect(hasDifferentiator).toBe(true)
  })
})
