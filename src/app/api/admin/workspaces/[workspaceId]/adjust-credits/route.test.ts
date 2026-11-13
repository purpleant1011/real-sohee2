import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireOperator: vi.fn(), admin: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.requireOperator }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
import { POST } from './route'

const workspaceId = 'e1559000-0000-4000-8000-000000000001'
const userId = 'e1559000-0000-4000-8000-000000000002'
const approverId = 'e1559000-0000-4000-8000-000000000003'
const currentAccountId = 'e1559000-0000-4000-8000-000000000004'
const expiredAccountId = 'e1559000-0000-4000-8000-000000000005'
const params = { params: Promise.resolve({ workspaceId }) }

const request = (body: Record<string, unknown> = {}) =>
  new NextRequest('http://localhost/api/admin/workspaces/' + workspaceId + '/adjust-credits', {
    method: 'POST',
    body: JSON.stringify({
      amount: 50001,
      reason: '운영자 충전 사유',
      idempotencyKey: 'key-1',
      approverId,
      ...body,
    }),
  })

describe('운영자 크레딧 조정 RPC', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireOperator.mockResolvedValue({ userId })
  })

  it('권한이 없으면 특권 클라이언트를 만들지 않는다', async () => {
    mocks.requireOperator.mockRejectedValueOnce(new Error('denied'))
    const response = await POST(request(), params)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('RLS 우회를 위해 권한 통과 후 service client로 계좌를 조회하고 현재 유효한 계좌를 우선 선택한다', async () => {
    const accountsData = [
      { id: currentAccountId, period_start: '2020-01-01', period_end: '2099-12-31', created_at: '2026-01-01T00:00:00Z' },
      { id: expiredAccountId, period_start: '2020-01-01', period_end: '2020-01-07', created_at: '2026-01-02T00:00:00Z' },
    ]

    const rpc = vi.fn().mockResolvedValue({
      data: { success: true, is_replay: false, adjusted_amount: 50001, new_balance: 51000, message: 'committed' },
      error: null,
    })

    const selectQuery = {
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: accountsData, error: null }),
          }),
        }),
      }),
    }

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'credit_accounts') {
          return { select: vi.fn().mockReturnValue(selectQuery) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    mocks.admin.mockReturnValue(adminClient)

    const response = await POST(request(), params)
    expect(mocks.requireOperator).toHaveBeenCalledWith('credit.adjust.request', workspaceId)
    expect(adminClient.from).toHaveBeenCalledWith('credit_accounts')
    expect(selectQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(rpc).toHaveBeenCalledWith('apply_operator_credit_adjustment', expect.objectContaining({
      p_workspace_id: workspaceId,
      p_account_id: currentAccountId,
      p_operator_id: userId,
      p_approver_id: approverId,
      p_idempotency_key: 'key-1',
    }))
    expect(response.status).toBe(200)
    expect((await response.json()).newAuthoritativeBalance).toBe(51000)
  })

  it('유효기간 내 계좌가 없으면 최신 계좌로 deterministic fallback한다', async () => {
    const accountsData = [
      { id: expiredAccountId, period_start: '2020-01-01', period_end: '2020-01-07', created_at: '2020-01-01T00:00:00Z' },
    ]

    const rpc = vi.fn().mockResolvedValue({
      data: { success: true, is_replay: false, adjusted_amount: 1000, new_balance: 1000, message: 'committed' },
      error: null,
    })

    const selectQuery = {
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: accountsData, error: null }),
          }),
        }),
      }),
    }

    mocks.admin.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn().mockReturnValue(selectQuery) })),
      rpc,
    })

    const response = await POST(request({ amount: 1000 }), params)
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('apply_operator_credit_adjustment', expect.objectContaining({
      p_account_id: expiredAccountId,
    }))
  })

  it('계좌가 0건이면 404를 반환하고 트라이얼 가입 유도 문구를 쓰지 않는다', async () => {
    const selectQuery = {
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }

    mocks.admin.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn().mockReturnValue(selectQuery) })),
      rpc: vi.fn(),
    })

    const response = await POST(request({ amount: 1000 }), params)
    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.error).toContain('해당 워크스페이스의 크레딧 계좌가 존재하지 않습니다')
    expect(json.error).not.toContain('트라이얼')
  })

  it('계좌 조회 에러 시 500을 반환하고 계좌 없음과 구분한다', async () => {
    const selectQuery = {
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
          }),
        }),
      }),
    }

    mocks.admin.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn().mockReturnValue(selectQuery) })),
      rpc: vi.fn(),
    })

    const response = await POST(request({ amount: 1000 }), params)
    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json.error).toBe('크레딧 계좌 조회 실패')
  })

  it('금액이 0이거나 정수가 아니면 400을 반환한다', async () => {
    const resZero = await POST(request({ amount: 0 }), params)
    expect(resZero.status).toBe(400)

    const resFloat = await POST(request({ amount: 10.5 }), params)
    expect(resFloat.status).toBe(400)
  })

  it('고액 조정 시 자기 자신을 승인자로 넣으면 400을 반환한다', async () => {
    const resSelf = await POST(request({ amount: 60000, approverId: userId }), params)
    expect(resSelf.status).toBe(400)
  })
})

