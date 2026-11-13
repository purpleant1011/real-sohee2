import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  saveWorkspaceProfile,
  getWorkspaceProfile,
  type BusinessProfileInput,
  type BrandProfileInput,
} from '../workspace-profile-service'
import { SupabasePersistenceError } from '@/lib/supabase/require-success'

describe('Workspace Profile SSOT Service (ANI-991)', () => {
  const mockWorkspaceId = '00000000-0000-0000-0000-000000000001'

  const validBusinessInput: BusinessProfileInput = {
    businessName: '테스트 스튜디오',
    industry: '뷰티/헤어',
    location: '서울시 강남구 테헤란로 123',
    summary: '프리미엄 1:1 맞춤 헤어 살롱입니다.',
  }

  const validBrandInput: BrandProfileInput = {
    voice: '친절하고 전문적인 톤 (~해요)',
    keywords: ['맞춤 헤어', '강남 살롱', '프리미엄'],
    prohibitedTerms: ['최저가', '파격 할인'],
  }

  it('atomically saves business and brand profiles and verifies readback', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_profiles') {
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: mockWorkspaceId,
                    business_name: validBusinessInput.businessName,
                    industry: validBusinessInput.industry,
                    location: validBusinessInput.location,
                    summary: validBusinessInput.summary,
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: mockWorkspaceId,
                    business_name: validBusinessInput.businessName,
                    industry: validBusinessInput.industry,
                    location: validBusinessInput.location,
                    summary: validBusinessInput.summary,
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'brand_profiles') {
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: mockWorkspaceId,
                    voice: validBrandInput.voice,
                    keywords: validBrandInput.keywords,
                    prohibited_terms: validBrandInput.prohibitedTerms,
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: mockWorkspaceId,
                    voice: validBrandInput.voice,
                    keywords: validBrandInput.keywords,
                    prohibited_terms: validBrandInput.prohibitedTerms,
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const result = await saveWorkspaceProfile({
      workspaceId: mockWorkspaceId,
      business: validBusinessInput,
      brand: validBrandInput,
      client: mockSupabase as any,
    })

    expect(result.readbackVerified).toBe(true)
    expect(result.business.business_name).toBe('테스트 스튜디오')
    expect(result.brand.voice).toBe('친절하고 전문적인 톤 (~해요)')
    expect(result.brand.prohibited_terms).toEqual(['최저가', '파격 할인'])
  })

  it('fails closed and throws SupabasePersistenceError when business profile persistence fails', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_profiles') {
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Database connection failed', code: '500' },
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    await expect(
      saveWorkspaceProfile({
        workspaceId: mockWorkspaceId,
        business: validBusinessInput,
        brand: validBrandInput,
        client: mockSupabase as any,
      })
    ).rejects.toThrow(SupabasePersistenceError)
  })
})
