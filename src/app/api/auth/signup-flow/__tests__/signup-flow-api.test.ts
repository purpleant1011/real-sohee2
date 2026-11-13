import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  getUserMock,
  getOrCreateSignupApplicationMock,
  updateSignupBusinessInfoMock,
  submitSignupAgreementsMock,
  finalizeSignupAndActivateFreeTasteMock,
  queryNtsBusinessValidationMock,
  ensureUserProfileMock
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getOrCreateSignupApplicationMock: vi.fn(),
  updateSignupBusinessInfoMock: vi.fn(),
  submitSignupAgreementsMock: vi.fn(),
  finalizeSignupAndActivateFreeTasteMock: vi.fn(),
  queryNtsBusinessValidationMock: vi.fn(),
  ensureUserProfileMock: vi.fn()
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock
    }
  }))
}))

vi.mock('@/features/auth/signup-state-machine', () => ({
  getOrCreateSignupApplication: getOrCreateSignupApplicationMock,
  updateSignupBusinessInfo: updateSignupBusinessInfoMock,
  submitSignupAgreements: submitSignupAgreementsMock,
  finalizeSignupAndActivateFreeTaste: finalizeSignupAndActivateFreeTasteMock,
  finalizeSignupAndActivateTrial: finalizeSignupAndActivateFreeTasteMock,
  ensureUserProfile: ensureUserProfileMock
}))

vi.mock('@/lib/auth/business-verification', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/business-verification')
  return {
    ...actual,
    queryNtsBusinessValidation: queryNtsBusinessValidationMock
  }
})

import { GET, POST } from '../route'

describe('Signup Flow API Route Security [ANI-733, ANI-727, ANI-1334]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com', app_metadata: { provider: 'google' } } },
      error: null
    })
  })

  it('rejects unauthenticated requests with 401', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: new Error('unauth') })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('ensures user profile on GET and returns signup application', async () => {
    getOrCreateSignupApplicationMock.mockResolvedValueOnce({
      id: 'app-1',
      user_id: 'test-user-id',
      state: 'FORM_REQUIRED'
    })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(ensureUserProfileMock).toHaveBeenCalled()
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.application.state).toBe('FORM_REQUIRED')
  })

  it('ANI-733: returns 409 when submit_agreements is called directly on BUSINESS_PENDING application', async () => {
    const error: any = new Error('국세청 사업자 진위확인이 대기 중이거나 완료되지 않아 약관 동의를 완료할 수 없습니다. (ANI-733)')
    error.statusCode = 409
    submitSignupAgreementsMock.mockRejectedValueOnce(error)

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit_agreements',
        agreements: {
          termsOfService: true,
          privacyPolicy: true,
          aiDataProcessing: true,
          channelDelegation: true
        }
      })
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain('ANI-733')
  })

  it('ANI-1334: successfully submits agreements for MANUAL_REVIEW transition to VERIFICATION_PENDING', async () => {
    submitSignupAgreementsMock.mockResolvedValueOnce({
      id: 'app-1',
      user_id: 'test-user-id',
      state: 'VERIFICATION_PENDING',
      agreements_completed: true
    })

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit_agreements',
        agreements: {
          termsOfService: true,
          privacyPolicy: true,
          aiDataProcessing: true,
          channelDelegation: true
        }
      })
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.application.state).toBe('VERIFICATION_PENDING')
  })

  it('ANI-733: returns 403 when activate_taste is called before completing business verification and agreements', async () => {
    const error: any = new Error('현재 상태에서는 무료 맛보기 Energy를 활성화할 수 없습니다. (ANI-733)')
    error.statusCode = 403
    finalizeSignupAndActivateFreeTasteMock.mockRejectedValueOnce(error)

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({ action: 'activate_taste' })
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('ANI-733')
  })

  it('ANI-727: returns 200 with Free Taste Energy when activate_taste succeeds for verified business', async () => {
    finalizeSignupAndActivateFreeTasteMock.mockResolvedValueOnce({
      success: true,
      workspaceId: 'ws-active-123',
      energyGranted: 50,
      planTier: 'FREE_TASTE',
      isNewWorkspace: true,
      verificationStatus: 'VERIFIED'
    })

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({ action: 'activate_taste' })
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.energyGranted).toBe(50)
    expect(json.planTier).toBe('FREE_TASTE')
  })

  it('ANI-1334: returns 200 with 0 Energy when activate_taste succeeds for manual review fallback', async () => {
    finalizeSignupAndActivateFreeTasteMock.mockResolvedValueOnce({
      success: true,
      workspaceId: 'ws-pending-123',
      energyGranted: 0,
      planTier: 'FREE_TASTE',
      isNewWorkspace: true,
      verificationStatus: 'PENDING'
    })

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({ action: 'activate_taste' })
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.energyGranted).toBe(0)
    expect(json.verificationStatus).toBe('PENDING')
  })

  it('[P1-1] rejects invalid business number (checksum failure or length != 10) with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_business',
        businessNumber: '1234567890', // 유효하지 않은 체크섬
        companyName: '정상매장',
        representativeName: '홍길동'
      })
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('체크섬 오류')
    expect(updateSignupBusinessInfoMock).not.toHaveBeenCalled()
  })

  it('[P1-1] rejects short company name or representative name (< 2 chars) with 400', async () => {
    // 134-87-02941: 유효한 사업자번호
    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_business',
        businessNumber: '120-81-47521',
        companyName: '가',
        representativeName: '홍길동'
      })
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('상호명을 2자 이상')
  })

  it('[P1-1] rejects CLOSED_BUSINESS with 400 and blocks fallback to manual review', async () => {
    queryNtsBusinessValidationMock.mockResolvedValueOnce({
      success: true,
      status: 'CLOSED_BUSINESS',
      valid_msg: '폐업된 사업자등록번호입니다.'
    })

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_business',
        businessNumber: '120-81-47521',
        companyName: '폐업된매장',
        representativeName: '홍길동'
      })
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('폐업된 사업자')
    expect(updateSignupBusinessInfoMock).not.toHaveBeenCalled()
  })

  it('[P1-1] rejects MISMATCH with 400 and blocks fallback to manual review', async () => {
    queryNtsBusinessValidationMock.mockResolvedValueOnce({
      success: true,
      status: 'MISMATCH',
      valid_msg: '사업자등록정보 불일치'
    })

    const req = new NextRequest('http://localhost:3000/api/auth/signup-flow', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_business',
        businessNumber: '120-81-47521',
        companyName: '불일치매장',
        representativeName: '불일치대표'
      })
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('일치하지 않습니다')
    expect(updateSignupBusinessInfoMock).not.toHaveBeenCalled()
  })

  it('[P1-2] returns isNtsLiveAvailable boolean flag on GET', async () => {
    getOrCreateSignupApplicationMock.mockResolvedValueOnce({
      id: 'app-1',
      user_id: 'test-user-id',
      state: 'FORM_REQUIRED'
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('isNtsLiveAvailable')
    expect(typeof json.isNtsLiveAvailable).toBe('boolean')
  })
})
