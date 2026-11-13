import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const OTHER_WS = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const FILE_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const PATH = `${WS}/${FILE_ID}.pdf`

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  exists: vi.fn(),
  currentStatus: vi.fn(),
  nts: vi.fn(),
  auditInsert: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (v: any) => Boolean(v && typeof v.status === 'number' && typeof v.json === 'function'),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock('@/lib/auth/business-verification', () => ({
  verifyBusinessRegistration: vi.fn(() => ({
    isValidChecksum: true,
    status: 'PENDING',
    message: '접수',
    normalizedBusinessNumber: '1234567890',
  })),
  queryNtsBusinessValidation: mocks.nts,
}))

import { POST, GET } from '../route'

function adminStub() {
  return {
    storage: { from: () => ({ exists: mocks.exists }) },
    from: (table: string) => {
      if (table === 'business_verifications') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => mocks.currentStatus() }) }),
          insert: mocks.insert,
          update: (record: any) => ({
            eq: (_col1: string, _val1: any) => ({
              neq: (_col2: string, _val2: any) => ({
                select: async () => mocks.update(record),
              }),
            }),
          }),
        }
      }
      if (table === 'business_profiles') return { update: () => ({ eq: async () => ({ error: null }) }) }
      if (table === 'signup_applications') return { update: () => ({ eq: async () => ({ error: null }) }) }
      if (table === 'platform_audit_events') return { insert: mocks.auditInsert }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/auth/business-verification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const base = { businessNumber: '123-45-67890', companyName: '모모 카페', representativeName: '김소희', startDate: '20240101' }

beforeEach(() => {
  for (const m of [mocks.insert, mocks.update, mocks.exists, mocks.currentStatus, mocks.nts, mocks.authorize, mocks.auditInsert]) m.mockReset()
  mocks.authorize.mockResolvedValue({ userId: 'user-1', workspaceId: WS, role: 'owner', supabase: {}, admin: adminStub() })
  mocks.insert.mockResolvedValue({ error: null })
  mocks.update.mockResolvedValue({ data: [{ workspace_id: WS }], error: null })
  mocks.exists.mockResolvedValue({ data: true, error: null })
  mocks.currentStatus.mockReturnValue({ data: null, error: null })
  mocks.nts.mockResolvedValue({ success: true, status: 'VERIFIED', b_stt: '계속사업자' })
  mocks.auditInsert.mockResolvedValue({ error: null })
})

describe('POST /api/auth/business-verification', () => {
  it('로그인·권한 실패 응답을 그대로 돌려준다', async () => {
    mocks.authorize.mockResolvedValue(NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 }))
    expect((await POST(post({ ...base, documentPath: PATH }))).status).toBe(401)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('서류 경로가 없거나 남의 워크스페이스 경로면 400', async () => {
    expect((await POST(post(base))).status).toBe(400)
    expect((await POST(post({ ...base, documentPath: `${OTHER_WS}/${FILE_ID}.pdf` }))).status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('실제로 업로드되지 않은 서류 경로는 거절한다', async () => {
    mocks.exists.mockResolvedValue({ data: false, error: null })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('개업일자가 8자리 숫자가 아니면 400', async () => {
    const res = await POST(post({ ...base, startDate: '', documentPath: PATH }))
    expect(res.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('상호명이 60자를 초과하면 400', async () => {
    const res = await POST(post({ ...base, companyName: 'a'.repeat(61), documentPath: PATH }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '상호는 2~60자로 입력해 주세요.' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('개업일자가 유효하지 않은 가짜 날짜(예: 2월 30일)면 400', async () => {
    const res = await POST(post({ ...base, startDate: '20240230', documentPath: PATH }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '개업일자를 8자리 숫자로 입력해 주세요. (예: 20240101)' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('기존 인증 정보 조회 실패 시 500', async () => {
    mocks.currentStatus.mockReturnValue({ data: null, error: { message: 'db error' } })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: '인증 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('이미 인증 완료된 매장은 덮어쓸 수 없다(409)', async () => {
    mocks.currentStatus.mockReturnValue({ data: { status: 'VERIFIED' }, error: null })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(409)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('내 서류 + 국세청 일치면 신규 시 PENDING 으로 insert 하고 서류 경로를 남긴다', async () => {
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.verification.status).toBe('PENDING')
    expect(json.verification.message).toBe('국세청 정보 확인이 완료되어 운영팀 최종 심사 대기 중입니다.')
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: WS, status: 'PENDING', document_url: PATH, start_date: '20240101', verified_at: null }),
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('기존 행(PENDING)이 있으면 update(.neq status VERIFIED)로 갱신한다', async () => {
    mocks.currentStatus.mockReturnValue({ data: { status: 'PENDING' }, error: null })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(200)
    expect((await res.json()).verification.status).toBe('PENDING')
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: WS, status: 'PENDING', document_url: PATH, start_date: '20240101', verified_at: null }),
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('기존 행(PENDING)에서 update가 0행을 돌려주면 409(동시에 VERIFIED가 된 경우)', async () => {
    mocks.currentStatus.mockReturnValue({ data: { status: 'PENDING' }, error: null })
    mocks.update.mockResolvedValue({ data: [], error: null })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: '이미 사업자 인증이 완료되었어요. 정보를 바꾸려면 고객센터로 문의해 주세요.' })
  })

  it('insert 가 code 23505(unique conflict) 오류면 409', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: '이미 사업자 인증이 완료되었어요. 정보를 바꾸려면 고객센터로 문의해 주세요.' })
  })

  it('국세청이 일치를 확인하지 못하면 서류와 함께 PENDING(수동 심사)으로 저장한다', async () => {
    mocks.nts.mockResolvedValue({ success: true, status: 'PENDING_REVIEW' })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect((await res.json()).verification.status).toBe('PENDING')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', document_url: PATH }))
  })

  it('불일치는 사유와 함께 REJECTED 로 저장한다', async () => {
    mocks.nts.mockResolvedValue({ success: true, status: 'MISMATCH' })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect((await res.json()).verification.status).toBe('REJECTED')
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED', rejection_reason: expect.stringContaining('일치하지 않') }),
    )
  })

  it('사업자 인증 요청 성공 시 platform_audit_events에 정합 규격(fact_kind, request_id, 64-char hex)으로 감사 기록을 남기고 원문 PII를 복제하지 않는다', async () => {
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(200)
    expect(mocks.auditInsert).toHaveBeenCalledTimes(1)
    const auditArg = mocks.auditInsert.mock.calls[0][0]
    expect(auditArg.action).toBe('agreement.verify.requested')
    expect(auditArg.target_type).toBe('business_verification')
    expect(auditArg.fact_kind).toBe('user_claim')
    expect(auditArg.idempotency_key).toMatch(/^[a-f0-9]{64}$/)
    expect(auditArg.request_id).toMatch(/^bv-req-[a-f0-9]{24}$/)
    // Verify no raw business number or representative name in audit payload
    const auditJson = JSON.stringify(auditArg)
    expect(auditJson).not.toContain('123-45-67890')
    expect(auditJson).not.toContain('김소희')
  })

  it('DB 저장이 실패하면 성공으로 응답하지 않고(500) 내부 메시지를 숨긴다', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'permission denied for table business_verifications' } })
    const res = await POST(post({ ...base, documentPath: PATH }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('permission denied')
  })
})

describe('GET /api/auth/business-verification', () => {
  it('소속이 비활성/후순위여도 활성·가장 오래된 매장의 상태를 돌려준다 (필터 및 정렬 인자 검증)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const membersSelect = vi.fn()
    const membersEq = vi.fn()
    const membersOrder = vi.fn()
    const membersLimit = vi.fn().mockResolvedValue({
      data: [{ workspace_id: 'ws-oldest-active', status: 'active' }],
      error: null,
    })

    membersOrder.mockReturnValue({ limit: membersLimit })
    membersEq.mockReturnValue({
      eq: membersEq,
      order: membersOrder,
    })
    membersSelect.mockReturnValue({ eq: membersEq })

    const bvMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'bv-1',
        workspace_id: 'ws-oldest-active',
        business_number: '1234567890',
        company_name: '활성 매장',
        representative_name: '대표자',
        status: 'VERIFIED',
        verified_at: '2026-10-01T00:00:00Z',
      },
      error: null,
    })

    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-multi' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: membersSelect,
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: bvMaybeSingle,
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockServerClient as any)

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.verification.companyName).toBe('활성 매장')
    expect(json.verification.status).toBe('VERIFIED')

    // 필터 및 정렬 체인 인자 검증
    expect(membersSelect).toHaveBeenCalledWith(expect.stringContaining('status'))
    expect(membersEq).toHaveBeenCalledWith('user_id', 'usr-multi')
    expect(membersEq).toHaveBeenCalledWith('status', 'active')
    expect(membersOrder).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(membersLimit).toHaveBeenCalledWith(1)
  })
})

