import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateSignupBusinessInfo } from '@/features/auth/signup-state-machine'
import { GET as getBusinessVerification } from '@/app/api/auth/business-verification/route'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

describe('ANI-1478 / R4-13: NTS Business Verification & Carry-Forward', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves and carries forward startDate in updateSignupBusinessInfo', async () => {
    let updatedPayload: any = null
    const mockSupabase: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'signup_applications') {
          return {
            update: vi.fn().mockImplementation((payload: any) => {
              updatedPayload = payload
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'app_1', ...payload },
                      error: null,
                    }),
                  }),
                }),
              }
            }),
          }
        }
        return {}
      }),
    }

    await updateSignupBusinessInfo(mockSupabase, 'user_123', {
      businessNumber: '0000000000',
      companyName: '예시회사',
      representativeName: '이윤규',
      startDate: '2025-01-02',
      isVerified: true,
      validationStatus: 'VERIFIED',
    })

    expect(updatedPayload).not.toBeNull()
    expect(updatedPayload.start_date).toBe('20250102')
  })

  it('GET /api/auth/business-verification returns identity carried forward from signup application without start_date column error', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws_1' }] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
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
                  data: {
                    company_name: '예시회사',
                    business_number: '0000000000',
                    representative_name: '이윤규',
                    state: 'TASTE_READY',
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
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient)

    const req = new Request('http://localhost/api/auth/business-verification', { method: 'GET' })
    const res = await (getBusinessVerification as any)(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.verification.companyName).toBe('예시회사')
    expect(json.verification.businessNumber).toBe('0000000000')
    expect(json.verification.representativeName).toBe('이윤규')
    expect(json.verification.startDate).toBe('')
  })

  it('retains PENDING status (no auto-granting VERIFIED) upon GET request when provider confirms active business', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    let updatedPayload: any = null

    const mockAdminClient: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_verifications') {
          return {
            update: vi.fn().mockImplementation((payload: any) => {
              updatedPayload = payload
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdminClient)

    // Mock global fetch for NTS API response
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('nts-businessman/v1/status') || url.includes('nts-businessman/v1/validate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status_code: 'OK',
            data: [
              {
                b_no: '0000000000',
                b_stt: '계속사업자',
                b_stt_cd: '01',
                tax_type: '부가가치세 일반과세자',
                valid: '01',
                status: { b_stt: '계속사업자', b_stt_cd: '01' },
              },
            ],
          }),
        }
      }
      return { ok: false, status: 404 }
    }) as any

    process.env.NTS_API_KEY = 'test-key'

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws_1' }] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'd5449dd4-1c82-46b9-bdbe-b89d68e8d15e',
                        workspace_id: 'ws_1',
                        business_number: '0000000000',
                        company_name: '예시회사',
                        representative_name: '이윤규',
                        start_date: '20250102',
                        status: 'PENDING',
                        verified_at: null,
                        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient)

    try {
      const req = new Request('http://localhost/api/auth/business-verification', { method: 'GET' })
      const res = await (getBusinessVerification as any)(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.verification.status).toBe('PENDING')
      expect(json.verification.isVerified).toBe(false)
      expect(json.verification.verifiedAt).toBeNull()
      expect(updatedPayload).toEqual({ updated_at: expect.any(String) })
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.NTS_API_KEY
    }
  })

  it('reconciles PENDING verification to REJECTED with server-defined reason on MISMATCH', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    let updatedPayload: any = null

    const mockAdminClient: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_verifications') {
          return {
            update: vi.fn().mockImplementation((payload: any) => {
              updatedPayload = payload
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdminClient)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('nts-businessman/v1/validate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status_code: 'OK',
            data: [
              {
                b_no: '0000000000',
                valid: '02',
                valid_msg: '불일치',
              },
            ],
          }),
        }
      }
      if (url.includes('nts-businessman/v1/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status_code: 'OK',
            data: [
              {
                b_no: '0000000000',
                tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.',
              },
            ],
          }),
        }
      }
      return { ok: false, status: 404 }
    }) as any

    process.env.NTS_API_KEY = 'test-key'

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws_1' }] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'd5449dd4-1c82-46b9-bdbe-b89d68e8d15e',
                        workspace_id: 'ws_1',
                        business_number: '0000000000',
                        company_name: '예시회사',
                        representative_name: '이윤규',
                        start_date: '20250102',
                        status: 'PENDING',
                        verified_at: null,
                        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient)

    try {
      const req = new Request('http://localhost/api/auth/business-verification', { method: 'GET' })
      const res = await (getBusinessVerification as any)(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.verification.status).toBe('REJECTED')
      expect(json.verification.rejectionReason).toBe('국세청 등록정보와 입력하신 대표자명 또는 상호명이 일치하지 않습니다.')
      expect(updatedPayload).not.toBeNull()
      expect(updatedPayload.status).toBe('REJECTED')
      expect(updatedPayload.rejection_reason).toBe('국세청 등록정보와 입력하신 대표자명 또는 상호명이 일치하지 않습니다.')
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.NTS_API_KEY
    }
  })

  it('5분 안에 갱신된 PENDING 은 국세청을 다시 호출하지 않는다', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any
    process.env.NTS_API_KEY = 'test-key'

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws_1' }] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'd5449dd4-1c82-46b9-bdbe-b89d68e8d15e',
                        workspace_id: 'ws_1',
                        business_number: '0000000000',
                        company_name: '예시회사',
                        representative_name: '이윤규',
                        start_date: '20250102',
                        status: 'PENDING',
                        verified_at: null,
                        updated_at: new Date().toISOString(),
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient)

    try {
      const req = new Request('http://localhost/api/auth/business-verification', { method: 'GET' })
      const res = await (getBusinessVerification as any)(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.verification.status).toBe('PENDING')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.NTS_API_KEY
    }
  })

  it('상태 불변이면 updated_at 만 갱신하여 5분 쓰로틀을 유지한다', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    let updatedPayload: any = null

    const mockAdminClient: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_verifications') {
          return {
            update: vi.fn().mockImplementation((payload: any) => {
              updatedPayload = payload
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdminClient)

    const originalFetch = globalThis.fetch
    // PENDING_REVIEW (상태 불변) 응답 모의
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('nts-businessman/v1/validate')) {
        return {
          ok: false,
          status: 500,
        }
      }
      if (url.includes('nts-businessman/v1/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status_code: 'OK',
            data: [
              {
                b_no: '0000000000',
                b_stt_cd: '01',
                b_stt: '계속사업자',
              },
            ],
          }),
        }
      }
      return { ok: false, status: 404 }
    }) as any

    process.env.NTS_API_KEY = 'test-key'

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws_1' }] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'd5449dd4-1c82-46b9-bdbe-b89d68e8d15e',
                        workspace_id: 'ws_1',
                        business_number: '0000000000',
                        company_name: '예시회사',
                        representative_name: '이윤규',
                        start_date: '20250102',
                        status: 'PENDING',
                        verified_at: null,
                        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient)

    try {
      const req = new Request('http://localhost/api/auth/business-verification', { method: 'GET' })
      const res = await (getBusinessVerification as any)(req)
      const json = await res.json()

      expect(json.success).toBe(true)
      expect(json.verification.status).toBe('PENDING')
      expect(updatedPayload).not.toBeNull()
      expect(updatedPayload.updated_at).toBeDefined()
      expect(updatedPayload.status).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.NTS_API_KEY
    }
  })
})
