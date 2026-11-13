import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import * as workspaceGuard from '@/lib/auth/workspace-guard'
import * as billingRepository from '@/features/billing/repository'

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: vi.fn(),
}))

vi.mock('@/features/billing/repository', () => ({
  createCheckoutIntent: vi.fn(),
}))

const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
const VALID_UUID = 'a0000000-0000-4000-8000-000000000001'
const CHECKOUT_INTENT_ID = 'c0000000-0000-4000-8000-000000000001'

function createRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createContext(workspaceId: string = WORKSPACE_ID) {
  return {
    params: Promise.resolve({ workspaceId }),
  }
}

describe('POST /api/workspaces/[workspaceId]/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. auth 없음: 로그인되지 않았으면 401을 반환한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'AUTH_REQUIRED',
      message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
    })

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('AUTH_REQUIRED')
  })

  it('2. 타사업장 guard 차단: 접근 권한이 없으면 403을 반환한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'WORKSPACE_FORBIDDEN',
      message: '해당 작업공간에 대한 접근 권한이 없습니다.',
    })

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('WORKSPACE_FORBIDDEN')
  })

  it('3. read-only role 차단: owner/manager가 아닌 일반 member/viewer는 403으로 거부한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-viewer',
      role: 'member',
      workspaceId: WORKSPACE_ID,
    })

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('FORBIDDEN_ROLE')
    expect(billingRepository.createCheckoutIntent).not.toHaveBeenCalled()
  })

  it('4. 잘못된 상품: 허용되지 않은 planCode는 growth로 대체하지 않고 400으로 거부한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })

    const req = createRequest({ planCode: 'INVALID_PLAN_CODE', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('INVALID_REQUEST')
    expect(billingRepository.createCheckoutIntent).not.toHaveBeenCalled()
  })

  it('5. 금액 변조 및 unknown 필드 거부: amount 등 정의되지 않은 필드가 포함되면 400으로 거부한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })

    const req = createRequest({
      planCode: 'growth',
      idempotencyKey: VALID_UUID,
      amount: 100, // 변조 시도
    })
    const res = await POST(req, createContext())

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('INVALID_REQUEST')
    expect(billingRepository.createCheckoutIntent).not.toHaveBeenCalled()
  })

  it('6. UUID 누락 / 형식 오류: idempotencyKey가 누락되거나 유효한 UUID가 아니면 400으로 거부한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValue({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })

    // 누락된 경우
    const req1 = createRequest({ planCode: 'growth' })
    const res1 = await POST(req1, createContext())
    expect(res1.status).toBe(400)
    const json1 = await res1.json()
    expect(json1.error).toBe('INVALID_REQUEST')

    // non-UUID인 경우
    const req2 = createRequest({ planCode: 'growth', idempotencyKey: 'not-a-uuid' })
    const res2 = await POST(req2, createContext())
    expect(res2.status).toBe(400)
    const json2 = await res2.json()
    expect(json2.error).toBe('INVALID_REQUEST')

    expect(billingRepository.createCheckoutIntent).not.toHaveBeenCalled()
  })

  it('7. 신규 상용 요금제 alias 차단: STARTER_150K / GROWTH_300K / SCALE_500K는 409 BUSINESS_DECISION_REQUIRED 로 차단한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValue({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })

    const aliases = ['STARTER_150K', 'GROWTH_300K', 'SCALE_500K'] as const
    for (const planCode of aliases) {
      const req = createRequest({ planCode, idempotencyKey: VALID_UUID })
      const res = await POST(req, createContext())

      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('BUSINESS_DECISION_REQUIRED')
    }

    expect(billingRepository.createCheckoutIntent).not.toHaveBeenCalled()
  })

  it('8. repo 실패: repository 실패 시 success:true로 위장하지 않고 500과 안전한 메시지를 반환한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })
    vi.mocked(billingRepository.createCheckoutIntent).mockResolvedValueOnce({
      error: { code: 'CHECKOUT_RPC_FAILED' },
    } as any)

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBeUndefined()
    expect(json.error).toBe('CHECKOUT_INTENT_CREATION_FAILED')
    expect(json.message).toBe('결제 의향 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  })

  it('9. repo 반환 state 검증: provider_pending이 아니면 500으로 실패 처리한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })
    vi.mocked(billingRepository.createCheckoutIntent).mockResolvedValueOnce({
      data: {
        checkoutIntentId: CHECKOUT_INTENT_ID,
        state: 'draft' as any, // 잘못된 state
      },
    })

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('INVALID_INTENT_STATE')
  })

  it('10. 예외 발생 시 내부 에러 메시지(민감정보 등)를 노출하지 않고 500을 반환한다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: WORKSPACE_ID,
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(billingRepository.createCheckoutIntent).mockRejectedValueOnce(
      new Error('postgres://secret-credentials-db-host:5432/db connection refused')
    )

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('CHECKOUT_FAILED')
    expect(json.message).toBe('결제 요청 처리에 실패했습니다.')
    expect(JSON.stringify(json)).not.toContain('secret-credentials')
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('postgres:')
    expect(errorLog.mock.calls.every((args) => args.every((arg) => !(arg instanceof Error)))).toBe(true)
    errorLog.mockRestore()
  })

  it('11. 정상 의향 저장 (owner/manager): savedIntentOnly:true 및 provider_pending 상태를 명시하고 결제/활성화를 암시하지 않는다', async () => {
    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-manager',
      role: 'manager',
      workspaceId: WORKSPACE_ID,
    })
    vi.mocked(billingRepository.createCheckoutIntent).mockResolvedValueOnce({
      data: {
        checkoutIntentId: CHECKOUT_INTENT_ID,
        state: 'provider_pending',
      },
    })

    const req = createRequest({ planCode: 'growth', idempotencyKey: VALID_UUID })
    const res = await POST(req, createContext())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.savedIntentOnly).toBe(true)
    expect(json.state).toBe('provider_pending')
    expect(json.checkoutIntentId).toBe(CHECKOUT_INTENT_ID)
    expect(json.checkoutUrl).toBeUndefined()
    expect(json.activated).toBeUndefined()
    expect(json.message).not.toContain('결제가 완료되었습니다')
    expect(json.message).not.toContain('구독이 활성화되었습니다')
  })
})
