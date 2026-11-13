import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  createUserMock,
  signInWithPasswordMock,
  upsertSignupAppMock,
  updateSignupAppMock,
  upsertAgreementsMock,
  updateAgreementsMock,
  selectBusinessVerificationsMock,
  updateBusinessVerificationsMock,
  selectWorkspaceMembersMock,
  prepareSignupApplicationAtomicMock,
  provisionEducationWorkspaceMock,
  finalizeEmailSignupAtomicMock,
  ensureSignupStarterCreditsMock,
  queryNtsBusinessValidationMock,
  selectSignupApplicationMock,
  rpcCallOrder,
} = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
  upsertSignupAppMock: vi.fn(),
  updateSignupAppMock: vi.fn(),
  upsertAgreementsMock: vi.fn(),
  updateAgreementsMock: vi.fn(),
  selectBusinessVerificationsMock: vi.fn(),
  updateBusinessVerificationsMock: vi.fn(),
  selectWorkspaceMembersMock: vi.fn(),
  prepareSignupApplicationAtomicMock: vi.fn(),
  provisionEducationWorkspaceMock: vi.fn(),
  finalizeEmailSignupAtomicMock: vi.fn(),
  ensureSignupStarterCreditsMock: vi.fn(),
  queryNtsBusinessValidationMock: vi.fn(),
  selectSignupApplicationMock: vi.fn(),
  rpcCallOrder: [] as string[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      admin: {
        createUser: createUserMock,
      },
    },
    from: vi.fn((table: string) => {
      if (table === 'signup_applications') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: selectSignupApplicationMock,
            })),
          })),
          upsert: upsertSignupAppMock.mockResolvedValue({ error: null }),
          update: updateSignupAppMock.mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'app-1', workspace_id: 'ws-new-456' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'user_agreements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          upsert: upsertAgreementsMock.mockResolvedValue({ error: null }),
          update: updateAgreementsMock.mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'business_verifications') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: selectBusinessVerificationsMock.mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
          update: updateBusinessVerificationsMock.mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [{ start_date: '20240101' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'workspace_members') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => {
                const p = selectWorkspaceMembersMock();
                p.limit = vi.fn(() => p);
                return p;
              }),
            })),
          })),
        }
      }
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
      }
    }),
    rpc: vi.fn((proc: string, args: any) => {
      rpcCallOrder.push(proc)
      if (proc === 'prepare_signup_application_atomic') {
        return prepareSignupApplicationAtomicMock(args)
      }
      if (proc === 'provision_education_workspace') {
        return provisionEducationWorkspaceMock(args)
      }
      if (proc === 'finalize_email_signup_atomic') {
        return finalizeEmailSignupAtomicMock(args)
      }
      if (proc === 'ensure_signup_starter_credits') {
        return ensureSignupStarterCreditsMock(args)
      }
      return Promise.resolve({ data: null, error: null })
    }),
  })),
}))

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<any>('@supabase/supabase-js')
  return {
    ...actual,
    createClient: vi.fn(() => ({
      auth: {
        signInWithPassword: signInWithPasswordMock,
      },
    })),
  }
})

vi.mock('@/lib/auth/business-verification', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/business-verification')
  return {
    ...actual,
    queryNtsBusinessValidation: queryNtsBusinessValidationMock,
  }
})

import { POST } from '../route'

describe('Email Registration API (POST /api/auth/register-email)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcCallOrder.length = 0
    selectSignupApplicationMock.mockResolvedValue({ data: null, error: null })
    createUserMock.mockResolvedValue({
      data: { user: { id: 'usr-new-123', email: 'owner@example.com' } },
      error: null,
    })
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid credentials' },
    })
    prepareSignupApplicationAtomicMock.mockResolvedValue({
      data: { success: true },
      error: null,
    })
    provisionEducationWorkspaceMock.mockResolvedValue({
      data: { success: true, workspace_id: 'ws-new-456' },
      error: null,
    })
    finalizeEmailSignupAtomicMock.mockResolvedValue({
      data: {
        success: true,
        workspace_id: 'ws-new-456',
        user_id: 'usr-new-123',
        agreements_saved_count: 5,
        start_date_saved: true,
        is_verified: true,
      },
      error: null,
    })
    ensureSignupStarterCreditsMock.mockResolvedValue({
      data: { success: true },
      error: null,
    })
    queryNtsBusinessValidationMock.mockResolvedValue({
      success: true,
      status: 'VERIFIED',
      valid_msg: '국세청 정상 확인',
    })
  })

  const validPayload = {
    email: 'owner@example.com',
    password: 'Password123!',
    representativeName: '홍길동',
    phone: '010-1234-5678',
    companyName: '소희카페 강남본점',
    businessNumber: '120-81-47521',
    startDate: '20240101',
    agreements: {
      termsOfService: true,
      privacyPolicy: true,
      aiDataProcessing: true,
      channelDelegation: true,
      marketingConsent: false,
    },
  }

  it('올바른 회원 정보 및 사업자등록번호 입력 시 회원가입 및 워크스페이스 생성을 성공한다', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.workspaceId).toBe('ws-new-456')
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        email_confirm: true,
        user_metadata: expect.objectContaining({
          full_name: '홍길동',
          company_name: '소희카페 강남본점',
          business_number: '1208147521',
        }),
      })
    )
    expect(provisionEducationWorkspaceMock).toHaveBeenCalledWith({
      p_user_id: 'usr-new-123',
      p_workspace_name: '소희카페 강남본점',
      p_provider: 'email',
    })
  })

  it('비밀번호가 8자 미만이면 400 에러를 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify({ ...validPayload, password: 'short' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/8자 이상/)
  })

  it('사업자등록번호 체크섬이 올바르지 않으면 400 에러를 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify({ ...validPayload, businessNumber: '123-45-67890' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/사업자등록번호/)
  })

  it('필수 약관 동의가 누락되면 400 에러를 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify({
        ...validPayload,
        agreements: { ...validPayload.agreements, channelDelegation: false },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/약관/)
  })

  it('이미 존재하는 이메일이면 409 에러를 반환한다', async () => {
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/이미 가입된 이메일/)
  })

  it('가입 완료 시 finalize_email_signup_atomic RPC를 통해 워크스페이스 ID가 원자적으로 결합된다', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_workspace_id: 'ws-new-456',
        p_user_id: 'usr-new-123',
      })
    )
  })

  it('marketingConsent가 false이면 p_marketing_agreed: false로 전달되고, true이면 p_marketing_agreed: true로 전달된다', async () => {
    // 1) marketingConsent: false
    const reqFalse = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify({
        ...validPayload,
        agreements: { ...validPayload.agreements, marketingConsent: false },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(reqFalse)
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_marketing_agreed: false,
      })
    )

    // 2) marketingConsent: true
    finalizeEmailSignupAtomicMock.mockClear()
    const reqTrue = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify({
        ...validPayload,
        agreements: { ...validPayload.agreements, marketingConsent: true },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(reqTrue)
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_marketing_agreed: true,
      })
    )
  })

  it('가입 신청서(signup_applications) 저장 실패 시 500 에러를 반환하고 사용자 삭제 롤백을 수행하지 않는다', async () => {
    prepareSignupApplicationAtomicMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database constraint failure on signup_applications' },
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/신청서/)
  })

  it('교육용 워크스페이스 프로비저닝 실패 시 500 에러를 반환하고 복구 가능한 에러를 제공한다', async () => {
    provisionEducationWorkspaceMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Provisioning RPC execution failed' },
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/워크스페이스/)
  })

  it('개업일자(startDate)가 제공되면 finalize_email_signup_atomic에 안전하게 전달된다', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_start_date: '20240101',
      })
    )
  })

  it('marketingConsent가 생략(omitted)되면 p_marketing_agreed: null로 전달되어 미제출 동의를 false로 강제 추정하지 않는다', async () => {
    finalizeEmailSignupAtomicMock.mockClear()
    const payloadWithoutMarketing = {
      ...validPayload,
      agreements: {
        termsOfService: true,
        privacyPolicy: true,
        aiDataProcessing: true,
        channelDelegation: true,
      },
    }

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(payloadWithoutMarketing),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_marketing_agreed: null,
      })
    )
  })

  it('중단된 가입 재시도 시 올바른 비밀번호이고 활성 워크스페이스가 없으면 안전하게 복구 재개한다', async () => {
    // 1) createUser는 already registered 반환
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    })

    // 2) signInWithPassword는 자격증명 일치하여 user 반환
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: { id: 'usr-resumed-789', email: 'owner@example.com' } },
      error: null,
    })

    // 3) workspace_members는 빈 배열 (워크스페이스 없음)
    selectWorkspaceMembersMock.mockResolvedValueOnce({
      data: [],
      error: null,
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(provisionEducationWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_user_id: 'usr-resumed-789',
      })
    )
  })

  it('원자적 가입 정보 저장(finalize_email_signup_atomic) RPC 실패 시 500 에러를 반환한다', async () => {
    finalizeEmailSignupAtomicMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Atomic transaction failed' },
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/가입 정보 및 약관 동의를 저장하지 못했습니다/)
  })

  it('회원 가입 상태 확인 중 memErr 발생 시 503 에러로 즉시 fail-closed 중단한다', async () => {
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    })

    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: { id: 'usr-resumed-789', email: 'owner@example.com' } },
      error: null,
    })

    selectWorkspaceMembersMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB connection error' },
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toMatch(/확인하지 못했습니다/)
  })

  it('endpoint 실패(finalize 에러) 후 동일 계정 재시도 시 도중 상태를 감지하여 409 대신 안전하게 재개 및 완결한다', async () => {
    // === 1차 시도: finalize_email_signup_atomic 실패 ===
    finalizeEmailSignupAtomicMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database transaction aborted' },
    })

    const req1 = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res1 = await POST(req1)
    expect(res1.status).toBe(500)
    expect(createUserMock).toHaveBeenCalled()

    // === 2차 시도: 동일 이메일/비밀번호로 재시도 ===
    // Auth 계정이 이미 존재하므로 createUser는 already registered 반환
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    })

    // 독립 authClient는 비밀번호 일치 확인
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: { id: 'usr-new-123', email: 'owner@example.com' } },
      error: null,
    })

    // 1차 시도의 부작용으로 workspace_members는 존재함
    selectWorkspaceMembersMock.mockResolvedValueOnce({
      data: [{ workspace_id: 'ws-new-456' }],
      error: null,
    })

    // 하지만 user_agreements 조회가 아직 미결합 상태임
    // (route 내부에서 isAgreementsFullyBound 검증 시 아직 불완전하여 409가 아닌 재개 대상으로 승계)
    finalizeEmailSignupAtomicMock.mockResolvedValueOnce({
      data: {
        success: true,
        workspace_id: 'ws-new-456',
        user_id: 'usr-new-123',
        agreements_saved_count: 5,
        start_date_saved: true,
        is_verified: true,
      },
      error: null,
    })

    const req2 = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res2 = await POST(req2)
    const json2 = await res2.json()

    expect(res2.status).toBe(200)
    expect(json2.success).toBe(true)
    expect(json2.workspaceId).toBe('ws-new-456')
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_user_id: 'usr-new-123',
        p_workspace_id: 'ws-new-456',
      })
    )
  })

  // [P0 ANI-1354] provision_education_workspace 는 agreements_completed = true 를 요구한다.
  // prepare 는 false 로 INSERT 하므로, provision 이전에 약관을 먼저 저장해야 가입이 성립한다.
  it('약관 저장(finalize)이 워크스페이스 프로비저닝보다 먼저 실행된다: prepare → finalize(null) → provision → finalize(workspace)', async () => {
    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(rpcCallOrder).toEqual([
      'prepare_signup_application_atomic',
      'finalize_email_signup_atomic',
      'provision_education_workspace',
      'finalize_email_signup_atomic',
      'ensure_signup_starter_credits',
    ])

    const finalizeArgs = finalizeEmailSignupAtomicMock.mock.calls.map((call) => call[0])
    // 1차: 워크스페이스 없이 약관·개업일자만 먼저 저장 (agreements_completed = true 확보)
    expect(finalizeArgs[0]).toMatchObject({
      p_user_id: 'usr-new-123',
      p_workspace_id: null,
      p_start_date: '20240101',
      p_marketing_agreed: false,
      p_is_verified: true,
    })
    // 2차: 프로비저닝된 워크스페이스 결합(business_verifications·audit 은 workspace 필수)
    expect(finalizeArgs[1]).toMatchObject({
      p_user_id: 'usr-new-123',
      p_workspace_id: 'ws-new-456',
    })
  })

  it('워크스페이스가 이미 있는 재개 케이스에서는 첫 finalize(null)을 건너뛰고 워크스페이스 결합만 수행한다', async () => {
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    })
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: { id: 'usr-resumed-789', email: 'owner@example.com' } },
      error: null,
    })
    selectWorkspaceMembersMock.mockResolvedValueOnce({
      data: [{ workspace_id: 'ws-existing-111' }],
      error: null,
    })
    selectSignupApplicationMock.mockResolvedValueOnce({
      data: { id: 'app-1', workspace_id: 'ws-existing-111', state: 'VERIFICATION_PENDING', agreements_completed: false },
      error: null,
    })

    const req = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.workspaceId).toBe('ws-existing-111')
    expect(provisionEducationWorkspaceMock).not.toHaveBeenCalled()
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledTimes(1)
    expect(finalizeEmailSignupAtomicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_user_id: 'usr-resumed-789',
        p_workspace_id: 'ws-existing-111',
      })
    )
  })

  it('프로비저닝이 실패해도 약관은 이미 저장되어 있어, 동일 계정 재시도 시 교착 없이 가입이 완결된다', async () => {
    // === 1차 시도: 약관 저장은 성공하고 provision 이 실패한다 ===
    provisionEducationWorkspaceMock.mockResolvedValueOnce({
      data: null,
      error: { message: '필수 약관 및 채널 위임 동의가 완료되지 않았습니다. (ANI-1354)' },
    })

    const req1 = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res1 = await POST(req1)
    const json1 = await res1.json()

    expect(res1.status).toBe(500)
    // 사장님 화면에는 기술 원문(P0001/ANI-1354) 없이 기존 한국어 안내만 노출한다
    expect(json1.error).toBe('교육용 워크스페이스를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(json1.error).not.toMatch(/ANI-1354|P0001|agreements_completed/)

    // 실패 시점에도 약관 저장은 provision 보다 먼저 끝나 있었다
    expect(rpcCallOrder.slice(0, 3)).toEqual([
      'prepare_signup_application_atomic',
      'finalize_email_signup_atomic',
      'provision_education_workspace',
    ])
    const firstAttemptFinalize = finalizeEmailSignupAtomicMock.mock.calls.map((call) => call[0])
    expect(firstAttemptFinalize).toHaveLength(1)
    expect(firstAttemptFinalize[0].p_workspace_id).toBeNull()

    // === 2차 시도: 같은 이메일/비밀번호. auth.users 는 이미 존재하고 신청서는 약관 완료·워크스페이스 없음 ===
    rpcCallOrder.length = 0
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    })
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: { id: 'usr-new-123', email: 'owner@example.com' } },
      error: null,
    })
    selectWorkspaceMembersMock.mockResolvedValueOnce({ data: [], error: null })
    selectSignupApplicationMock.mockResolvedValueOnce({
      data: { id: 'app-1', workspace_id: null, state: 'VERIFICATION_PENDING', agreements_completed: true },
      error: null,
    })

    const req2 = new NextRequest('http://localhost/api/auth/register-email', {
      method: 'POST',
      body: JSON.stringify(validPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res2 = await POST(req2)
    const json2 = await res2.json()

    expect(res2.status).toBe(200)
    expect(json2.success).toBe(true)
    expect(json2.workspaceId).toBe('ws-new-456')
    expect(rpcCallOrder).toEqual([
      'prepare_signup_application_atomic',
      'finalize_email_signup_atomic',
      'provision_education_workspace',
      'finalize_email_signup_atomic',
      'ensure_signup_starter_credits',
    ])
  })
})
