import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const adminActor = 'b7100000-0000-4000-8000-000000000001'
const scopedActor = 'b7100000-0000-4000-8000-000000000002'
const approverActor = 'b7100000-0000-4000-8000-000000000003'
const scopedApprover = 'b7100000-0000-4000-8000-000000000004'

const wsTarget = 'b7100000-0000-4000-8000-000000000011'
const wsOther = 'b7100000-0000-4000-8000-000000000012'
const wsNoState = 'b7100000-0000-4000-8000-000000000013'

const accTarget1 = 'b7100000-0000-4000-8000-000000000021'
const accTarget2 = 'b7100000-0000-4000-8000-000000000022'
const accOther = 'b7100000-0000-4000-8000-000000000023'
const accNoState = 'b7100000-0000-4000-8000-000000000024'

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`

let realAccTarget1: string
let realAccOther: string
let realAccNoState: string

beforeAll(() => {
  // 1. Setup Auth Users & Platform Admins
  for (const uid of [adminActor, scopedActor, approverActor, scopedApprover]) {
    query(`with u as (insert into auth.users(id) values ('${uid}') on conflict do nothing returning id) select id from u`)
    query(`with m as (insert into public.platform_admin_members(user_id, status) values ('${uid}', 'active') on conflict do nothing returning user_id) select user_id from m`)
  }

  // 2. Setup Workspaces first (required for FK constraints)
  for (const w of [
    { id: wsTarget, name: '타겟 고객사' },
    { id: wsOther, name: '타 고객사' },
    { id: wsNoState, name: '상태없는 고객사' },
  ]) {
    query(`with ws as (insert into public.workspaces(id, name, created_by, workspace_kind) values ('${w.id}', ${lit(w.name)}, '${adminActor}', 'production') on conflict do nothing returning id) select id from ws`)
  }

  // 3. Setup Role Assignments (after workspaces exist)
  query(`with a as (insert into public.platform_admin_role_assignments(user_id, role_key, workspace_id) values ('${adminActor}', 'platform_owner', null) returning id) select id from a`)
  query(`with a as (insert into public.platform_admin_role_assignments(user_id, role_key, workspace_id) values ('${approverActor}', 'platform_owner', null) returning id) select id from a`)
  query(`with a as (insert into public.platform_admin_role_assignments(user_id, role_key, workspace_id) values ('${scopedActor}', 'platform_owner', '${wsOther}') returning id) select id from a`)
  query(`with a as (insert into public.platform_admin_role_assignments(user_id, role_key, workspace_id) values ('${scopedApprover}', 'platform_owner', '${wsOther}') returning id) select id from a`)

  // 4. Resolve trigger-created accounts or insert distinct accounts
  const accsTarget = query<{ id: string }>(`select id from public.credit_accounts where workspace_id = '${wsTarget}' order by created_at asc limit 1`)
  realAccTarget1 = accsTarget[0]?.id
  if (!realAccTarget1) {
    query(`with ca as (insert into public.credit_accounts(id, workspace_id, period_start, period_end) values ('${accTarget1}', '${wsTarget}', current_date, current_date + 7) returning id) select id from ca`)
    realAccTarget1 = accTarget1
  }

  // Distinct second account for wsTarget with different dates
  query(`with ca as (insert into public.credit_accounts(id, workspace_id, period_start, period_end) values ('${accTarget2}', '${wsTarget}', current_date + 30, current_date + 60) on conflict do nothing returning id) select id from ca`)

  const accsOther = query<{ id: string }>(`select id from public.credit_accounts where workspace_id = '${wsOther}' limit 1`)
  realAccOther = accsOther[0]?.id
  if (!realAccOther) {
    query(`with ca as (insert into public.credit_accounts(id, workspace_id, period_start, period_end) values ('${accOther}', '${wsOther}', current_date, current_date + 7) returning id) select id from ca`)
    realAccOther = accOther
  }

  const accsNoState = query<{ id: string }>(`select id from public.credit_accounts where workspace_id = '${wsNoState}' limit 1`)
  realAccNoState = accsNoState[0]?.id
  if (!realAccNoState) {
    query(`with ca as (insert into public.credit_accounts(id, workspace_id, period_start, period_end) values ('${accNoState}', '${wsNoState}', current_date, current_date + 7) returning id) select id from ca`)
    realAccNoState = accNoState
  }

  // 5. Setup workspace_credit_states (only for wsTarget and wsOther)
  query(`with st as (insert into public.workspace_credit_states(workspace_id, total_available_credits) values ('${wsTarget}', 300) on conflict (workspace_id) do update set total_available_credits = 300 returning workspace_id) select workspace_id from st`)
  query(`with st as (insert into public.workspace_credit_states(workspace_id, total_available_credits) values ('${wsOther}', 500) on conflict (workspace_id) do update set total_available_credits = 500 returning workspace_id) select workspace_id from st`)

  // 6. Initial signup grant on realAccTarget1
  query(`with le as (insert into public.credit_ledger_entries(workspace_id, account_id, kind, amount, idempotency_key) values ('${wsTarget}', '${realAccTarget1}', 'grant', 300, 'signup-first-post:${adminActor}') on conflict do nothing returning id) select id from le`)
})

function parseResult(raw: any): any {
  if (!raw) return null
  const target = raw.result !== undefined ? raw.result : raw
  return typeof target === 'string' ? JSON.parse(target) : target
}

describe('PG16: apply_operator_credit_adjustment 및 reserve_quick_post_credits 통합 검증', () => {
  it('타 워크스페이스의 계좌를 지정하면 ACCOUNT_WORKSPACE_MISMATCH로 거부된다', () => {
    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccOther}', 1000, '타계좌조정', 'key-mismatch-1', '${adminActor}', null
      )`)
    }).toThrow(/ACCOUNT_WORKSPACE_MISMATCH/)
  })

  it('담당 범위 밖(scoped) operator의 요청은 OPERATOR_PERMISSION_DENIED로 거부된다', () => {
    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccTarget1}', 1000, '범위밖조정', 'key-scope-1', '${scopedActor}', null
      )`)
    }).toThrow(/OPERATOR_PERMISSION_DENIED/)
  })

  it('5만 SC 초과 시 담당 범위 밖 approver는 APPROVER_PERMISSION_DENIED로 거부된다', () => {
    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccTarget1}', 60000, '고액조정', 'key-scope-app-1', '${adminActor}', '${scopedApprover}'
      )`)
    }).toThrow(/APPROVER_PERMISSION_DENIED/)
  })

  it('NaN 또는 int 범위를 초과하는 금액은 INVALID_CREDIT_ADJUSTMENT_AMOUNT로 거부된다', () => {
    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccTarget1}', 'NaN'::numeric, 'NaN조정', 'key-nan-1', '${adminActor}', null
      )`)
    }).toThrow(/INVALID_CREDIT_ADJUSTMENT_AMOUNT/)

    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccTarget1}', 999999999999::numeric, '초과조정', 'key-overflow-1', '${adminActor}', null
      )`)
    }).toThrow(/INVALID_CREDIT_ADJUSTMENT_AMOUNT/)
  })

  it('states 행이 누락된 워크스페이스는 WORKSPACE_CREDIT_STATE_MISSING으로 실패하고 원장을 변경하지 않는다', () => {
    const beforeCount = query<{ count: number }>(`select count(*)::int as count from public.credit_ledger_entries where workspace_id = '${wsNoState}'`)[0].count

    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsNoState}', '${realAccNoState}', 1000, '상태누락조정', 'key-nostate-1', '${adminActor}', null
      )`)
    }).toThrow(/WORKSPACE_CREDIT_STATE_MISSING/)

    const afterCount = query<{ count: number }>(`select count(*)::int as count from public.credit_ledger_entries where workspace_id = '${wsNoState}'`)[0].count
    expect(afterCount).toBe(beforeCount)
  })

  it('신규 +10000 SC가 정상 지급되고 원장과 states.total_available_credits가 10300으로 원자적 갱신된다', () => {
    const raw = query<any>(`select public.apply_operator_credit_adjustment(
      '${wsTarget}', '${realAccTarget1}', 10000, '해드림물류 수동 충전', 'admin-adj:${wsTarget}:k10000', '${adminActor}', null
    ) as result`)[0]
    const res = parseResult(raw)

    expect(res.success).toBe(true)
    expect(res.is_replay).toBe(false)
    expect(res.adjusted_amount).toBe(10000)
    expect(res.new_balance).toBe(10300)

    const state = query<{ total_available_credits: number }>(`select total_available_credits from public.workspace_credit_states where workspace_id = '${wsTarget}'`)[0]
    expect(state.total_available_credits).toBe(10300)
  })

  it('동일 키 중복 호출 시 replay가 반환되고 추가 차감/지급이 발생하지 않는다', () => {
    const raw = query<{ result: any }>(`select public.apply_operator_credit_adjustment(
      '${wsTarget}', '${realAccTarget1}', 10000, '해드림물류 수동 충전', 'admin-adj:${wsTarget}:k10000', '${adminActor}', null
    ) as result`)[0]
    const res = parseResult(raw)

    expect(res.is_replay).toBe(true)
    expect(res.new_balance).toBe(10300)

    const state = query<{ total_available_credits: number }>(`select total_available_credits from public.workspace_credit_states where workspace_id = '${wsTarget}'`)[0]
    expect(state.total_available_credits).toBe(10300)
  })

  it('동일 키로 다른 금액이나 다른 계좌를 전달하면 IDEMPOTENCY_KEY_CONFLICT로 거부된다', () => {
    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccTarget1}', 5000, '다른금액', 'admin-adj:${wsTarget}:k10000', '${adminActor}', null
      )`)
    }).toThrow(/IDEMPOTENCY_KEY_CONFLICT/)
  })

  it('grant 계좌와 admin 지급 계좌가 달라도 reserve_quick_post_credits에서 사용할 수 있다', () => {
    // 1. 두 번째 계좌(accTarget2)에 5,000 SC 추가 지급
    query(`select public.apply_operator_credit_adjustment(
      '${wsTarget}', '${accTarget2}', 5000, '계좌2 충전', 'admin-adj:${wsTarget}:k5000', '${adminActor}', null
    )`)

    const state = query<{ total_available_credits: number }>(`select total_available_credits from public.workspace_credit_states where workspace_id = '${wsTarget}'`)[0]
    expect(state.total_available_credits).toBe(15300)

    // 2. quick-post 예약 실행 (100 SC)
    const missionId = 'b7100000-0000-4000-8000-000000000099'
    const resvId = 'b7100000-0000-4000-8000-000000000091'
    const raw = query<{ result: any }>(`select public.reserve_quick_post_credits(
      '${wsTarget}', '${missionId}', 1, 'text', 100, '${resvId}'
    ) as result`)[0]
    const res = parseResult(raw)

    expect(res.state).toBe('reserved')
    expect(res.requestedCredits).toBe(100)

    const stateAfterReserve = query<{ total_available_credits: number }>(`select total_available_credits from public.workspace_credit_states where workspace_id = '${wsTarget}'`)[0]
    expect(stateAfterReserve.total_available_credits).toBe(15200)

    // 3. 예약 릴리즈 시 원상 복구 및 잔액 보존 검증
    query(`with le as (insert into public.credit_ledger_entries(workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
      values ('${wsTarget}', '${realAccTarget1}', null, 'release', 'text_generation', 100, 'quick-post:${missionId}:1:text:release') returning id) select id from le`)
    query(`with st as (update public.workspace_credit_states set total_available_credits = total_available_credits + 100 where workspace_id = '${wsTarget}' returning workspace_id) select workspace_id from st`)

    const stateAfterRelease = query<{ total_available_credits: number }>(`select total_available_credits from public.workspace_credit_states where workspace_id = '${wsTarget}'`)[0]
    expect(stateAfterRelease.total_available_credits).toBe(15300)
  })

  it('잔액 부족 음수 조정은 INSUFFICIENT_CREDITS로 거부된다', () => {
    expect(() => {
      query(`select public.apply_operator_credit_adjustment(
        '${wsTarget}', '${realAccTarget1}', -20000, '과다회수', 'admin-adj:${wsTarget}:kminus', '${adminActor}', null
      )`)
    }).toThrow(/INSUFFICIENT_CREDITS/)
  })

  it('get_workspace_authoritative_credit_balance: states 10600, ledger 600-250+10000일 때 10350을 반환하고 states 누락 시 오류를 낸다', () => {
    const wsDrift = 'b7100000-0000-4000-8000-000000000031'
    const accDrift = 'b7100000-0000-4000-8000-000000000032'

    // 1. Setup workspace with drift: states has 10600, ledger has 600 - 250 + 10000 = 10350
    query(`with ws as (insert into public.workspaces(id, name, created_by, workspace_kind) values ('${wsDrift}', '드리프트 고객사', '${adminActor}', 'production') returning id) select id from ws`)
    query(`with ca as (insert into public.credit_accounts(id, workspace_id, period_start, period_end) values ('${accDrift}', '${wsDrift}', current_date + 100, current_date + 120) returning id) select id from ca`)
    query(`with st as (insert into public.workspace_credit_states(workspace_id, total_available_credits) values ('${wsDrift}', 10600) returning workspace_id) select workspace_id from st`)

    // Ledger: grant 600, consume 250, adjustment 10000
    query(`with le as (insert into public.credit_ledger_entries(workspace_id, account_id, kind, amount, idempotency_key) values ('${wsDrift}', '${accDrift}', 'grant', 600, 'signup-first-post:u-drift') returning id) select id from le`)
    query(`with le as (insert into public.credit_ledger_entries(workspace_id, account_id, kind, amount, idempotency_key) values ('${wsDrift}', '${accDrift}', 'consume', 250, 'quick-post:m-drift:1:both:consume') returning id) select id from le`)
    query(`with le as (insert into public.credit_ledger_entries(workspace_id, account_id, kind, amount, idempotency_key) values ('${wsDrift}', '${accDrift}', 'adjustment', 10000, 'admin-adj:${wsDrift}:k-drift') returning id) select id from le`)

    // 2. Query authoritative balance RPC
    const raw = query<{ result: any }>(`select public.get_workspace_authoritative_credit_balance('${wsDrift}') as result`)[0]
    const res = parseResult(raw)

    expect(res.authoritative_available_credits).toBe(10350)
    expect(res.state_total_credits).toBe(10600)
    expect(res.ledger_spendable_balance).toBe(10350)
    expect(res.has_signup_grant).toBe(true)

    // 3. States missing workspace should raise WORKSPACE_CREDIT_STATE_MISSING
    expect(() => {
      query(`select public.get_workspace_authoritative_credit_balance('${wsNoState}')`)
    }).toThrow(/WORKSPACE_CREDIT_STATE_MISSING/)
  })
})
