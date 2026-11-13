import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { getCreditBalance, listCreditLedger, type CreditGateway } from '@/features/credits/repository'
import { getWorkspaceAuthoritativeCreditBalance } from '@/features/credits/actual-spend-balance.server'

// ANI-1744 잔여: 크레딧(매출) 읽기 모델의 workspace 경계 부정 테스트.
// #2055 가 운영자 매출·채널 읽기 모델을 덮었지만, 화면이 실제로 쓰는 크레딧 읽기 모델
// (getCreditBalance / listCreditLedger / authoritative balance)에는 경계 테스트가 없었다.
// 프로덕션 코드는 바꾸지 않는다 — 이미 있는 fail-closed 가드가 실제로 동작하는지만 확인한다.

const A = '20000000-0000-4000-8000-000000000001'
const B = '20000000-0000-4000-8000-000000000002'
const ACCOUNT = '40000000-0000-4000-8000-000000000001'

const balanceRow = (workspaceId: string) => ({
  workspaceId,
  periodStart: '2026-08-17',
  periodEnd: '2026-08-23',
  granted: 2000,
  adjustments: 0,
  released: 40,
  consumed: 25,
  reserved: 40,
  available: 1975,
  weeklyLimit: 2000,
  policyVersion: 'v08-test-2000-1',
})

const ledgerRow = (id: string, workspaceId: string) => ({
  id,
  workspace_id: workspaceId,
  account_id: ACCOUNT,
  reservation_id: null,
  kind: 'grant' as const,
  action: null,
  amount: 1000,
  idempotency_key: `key-${id}`,
  occurred_at: '2026-08-23T00:00:00.000Z',
})

function gateway(rpc: CreditGateway['rpc']): CreditGateway {
  return { rpc }
}

describe('크레딧 읽기 모델 workspace 경계', () => {
  it('RPC 가 다른 workspace 잔액을 돌려주면 그 값을 그리지 않고 실패로 닫는다', async () => {
    // 사고 가정: p_workspace_id 전달은 맞았지만 RPC/RLS 가 다른 가게 행을 돌려준다.
    const result = await getCreditBalance(A, gateway(vi.fn(async () => ({ data: balanceRow(B), error: null }))))

    expect(result).toEqual({ error: expect.objectContaining({ code: 'CREDIT_RPC_FAILED' }) })
    // 'data' 자체가 없어야 한다. 다른 가게 잔액 1975 를 이 가게 잔액으로 보여주면 안 된다.
    expect('data' in result).toBe(false)
  })

  it('같은 workspace 잔액은 그대로 통과한다(경계 검사가 정상 값을 막지 않는다)', async () => {
    const result = await getCreditBalance(A, gateway(vi.fn(async () => ({ data: balanceRow(A), error: null }))))

    expect(result).toEqual({ data: expect.objectContaining({ workspaceId: A, available: 1975 }) })
  })

  it('원장에 다른 workspace 행이 섞여 오면 일부만 골라 보여주지 않고 실패로 닫는다', async () => {
    // 사고 가정: RPC 가 필터를 놓쳐 두 가게 원장이 함께 내려온다.
    // 다른 가게 행을 조용히 걸러 내면 '이 가게 원장'처럼 보이므로, 섞임 자체를 실패로 본다.
    const rows = [ledgerRow('00000000-0000-4000-8000-00000000000a', A), ledgerRow('00000000-0000-4000-8000-00000000000b', B)]
    const result = await listCreditLedger(A, {}, gateway(vi.fn(async () => ({ data: rows, error: null }))))

    expect(result).toEqual({ error: expect.objectContaining({ code: 'CREDIT_RPC_FAILED' }) })
    expect('data' in result).toBe(false)
  })

  it('같은 workspace 원장만 오면 그대로 통과한다', async () => {
    const rows = [ledgerRow('00000000-0000-4000-8000-00000000000a', A)]
    const result = await listCreditLedger(A, {}, gateway(vi.fn(async () => ({ data: rows, error: null }))))

    expect(result).toEqual({ data: [expect.objectContaining({ workspaceId: A, amount: 1000 })] })
  })
})

/** get_workspace_authoritative_credit_balance RPC 응답(스네이크 케이스). */
const authoritativeRow = (workspaceId: string, available = 1975) => ({
  workspace_id: workspaceId,
  authoritative_available_credits: available,
  state_total_credits: 2000,
  ledger_spendable_balance: 1975,
  has_signup_grant: true,
  updated_at: '2026-08-23T00:00:00.000Z',
})

describe('권위 잔액 읽기 모델 workspace 경계', () => {
  it('다른 workspace 잔액이 오면 null 로 닫는다(0 도, 남의 숫자도 아니다)', async () => {
    // 실행 가능 판정에 쓰이는 값이라 남의 가게 숫자를 물려받으면 그대로 실행이 열린다.
    const balance = await getWorkspaceAuthoritativeCreditBalance(A, {
      rpc: vi.fn(async () => ({ data: authoritativeRow(B, 999_999), error: null })),
    })

    expect(balance).toBeNull()
  })

  it('같은 workspace 잔액은 그대로 읽는다', async () => {
    const balance = await getWorkspaceAuthoritativeCreditBalance(A, {
      rpc: vi.fn(async () => ({ data: authoritativeRow(A), error: null })),
    })

    expect(balance).toEqual(expect.objectContaining({ workspaceId: A, authoritativeAvailableCredits: 1975 }))
  })

  it('조회 실패는 잔액 0 이 아니라 null 이다', async () => {
    const balance = await getWorkspaceAuthoritativeCreditBalance(A, {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'denied' } })),
    })

    expect(balance).toBeNull()
  })
})
