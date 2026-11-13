import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const actor = '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec'
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`

// Workspaces
const wsApplicant = 'c1000000-0000-4000-8000-000000000011'
const wsBizVerified = 'c1000000-0000-4000-8000-000000000012'
const wsBizPending = 'c1000000-0000-4000-8000-000000000013'
const wsSnsInsta = 'c1000000-0000-4000-8000-000000000014'
const wsSnsThreads = 'c1000000-0000-4000-8000-000000000015'
const wsSnsBlankLabel = 'c1000000-0000-4000-8000-000000000016'
const wsPaidCredits = 'c1000000-0000-4000-8000-000000000017'
const wsPaidCommercial = 'c1000000-0000-4000-8000-000000000018'
const wsPaidEntitlement = 'c1000000-0000-4000-8000-000000000019'

beforeAll(() => {
  // Setup operator auth & stubs
  query(`with u as (insert into auth.users(id) values ('${actor}') on conflict do nothing returning id) select id from u`)
  query(`with m as (insert into public.platform_admin_members(user_id,status,mfa_required,mfa_exception_until) values ('${actor}','active',false,statement_timestamp() + interval '10 days') on conflict (user_id) do update set status='active', mfa_required=false, mfa_exception_until=statement_timestamp() + interval '10 days' returning user_id) select user_id from m`)
  query(`with a as (insert into public.platform_admin_role_assignments(user_id,role_key) values ('${actor}','platform_owner') on conflict do nothing returning id) select id from a`)

  // Base workspaces
  const allWs = [
    { id: wsApplicant, name: '가입자 미인증' },
    { id: wsBizVerified, name: '사업자인증 정회원' },
    { id: wsBizPending, name: '사업자인증 대기 미인증' },
    { id: wsSnsInsta, name: '인스타 정회원' },
    { id: wsSnsThreads, name: '스레드 정회원' },
    { id: wsSnsBlankLabel, name: 'SNS라벨없음 미인증' },
    { id: wsPaidCredits, name: '크레딧구매 정회원' },
    { id: wsPaidCommercial, name: '유료상태 정회원' },
    { id: wsPaidEntitlement, name: '유료요금제 정회원' },
  ]

  for (const ws of allWs) {
    query(`with w as (insert into public.workspaces(id, name, created_by, workspace_kind) values ('${ws.id}', ${lit(ws.name)}, '${actor}', 'production') returning id) select id from w`)
    query(`with p as (insert into public.business_profiles(workspace_id, business_name) values ('${ws.id}', ${lit(ws.name)}) returning workspace_id) select workspace_id from p`)
    query(`with a as (insert into public.credit_accounts(workspace_id, period_start, period_end) values ('${ws.id}', current_date, current_date + 7) returning id) select id from a`)
  }

  // 1. Business verifications
  query(`with bv as (insert into public.business_verifications(workspace_id, business_number, company_name, representative_name, status) values ('${wsBizVerified}', '1234567890', '사업자법인', '홍길동', 'VERIFIED') returning id) select id from bv`)
  query(`with bv as (insert into public.business_verifications(workspace_id, business_number, company_name, representative_name, status) values ('${wsBizPending}', '1234567891', '심사중법인', '김철수', 'PENDING') returning id) select id from bv`)

  // 2. SNS channels
  query(`with cc as (insert into public.channel_connections(workspace_id, channel, status, account_label) values ('${wsSnsInsta}', 'instagram', 'connected', 'shop_official') returning id) select id from cc`)
  query(`with cc as (insert into public.channel_connections(workspace_id, channel, status, account_label) values ('${wsSnsThreads}', 'threads', 'verified', 'threads_shop') returning id) select id from cc`)
  query(`with cc as (insert into public.channel_connections(workspace_id, channel, status, account_label) values ('${wsSnsBlankLabel}', 'instagram', 'connected', '   ') returning id) select id from cc`)

  // 4. Paid states
  query(`with cs as (insert into public.workspace_credit_states(workspace_id, purchased_credits, commercial_state) values ('${wsPaidCredits}', 500, 'TRIAL_ACTIVE') on conflict (workspace_id) do update set purchased_credits = 500 returning workspace_id) select workspace_id from cs`)
  query(`with cs as (insert into public.workspace_credit_states(workspace_id, purchased_credits, commercial_state) values ('${wsPaidCommercial}', 0, 'ACTIVE') on conflict (workspace_id) do update set commercial_state = 'ACTIVE' returning workspace_id) select workspace_id from cs`)
  query(`with be as (insert into public.workspace_billing_entitlements(workspace_id, plan_code, policy_version, state, effective_from, source_reference) values ('${wsPaidEntitlement}', 'growth', 'v08-commercial-token-1', 'active', date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul', 'test-ref-001') returning id) select id from be`)
})

describe('workspace_membership_overview() authoritative function', () => {
  it('denies authenticated and anon roles (service_role only)', () => {
    for (const role of ['anon', 'authenticated']) {
      const [{ allowed }] = query<{ allowed: boolean }>(
        `select has_function_privilege('${role}', 'public.workspace_membership_overview()', 'EXECUTE') as allowed`
      )
      expect(allowed).toBe(false)
    }
    const [{ allowed: serviceRoleAllowed }] = query<{ allowed: boolean }>(
      `select has_function_privilege('service_role', 'public.workspace_membership_overview()', 'EXECUTE') as allowed`
    )
    expect(serviceRoleAllowed).toBe(true)
  })

  it('correctly derives is_formal and source booleans for all qualification paths', () => {
    const rows = query<{
      workspace_id: string
      is_formal: boolean
      via_business: boolean
      via_sns: boolean
      via_paid: boolean
    }>(`select workspace_id, is_formal, via_business, via_sns, via_paid from public.workspace_membership_overview() where workspace_id in (
      '${wsApplicant}', '${wsBizVerified}', '${wsBizPending}', '${wsSnsInsta}', '${wsSnsThreads}',
      '${wsSnsBlankLabel}', '${wsPaidCredits}', '${wsPaidCommercial}', '${wsPaidEntitlement}'
    )`)

    const byId = new Map(rows.map((r) => [r.workspace_id, r]))

    // Applicant: all false
    expect(byId.get(wsApplicant)).toEqual({
      workspace_id: wsApplicant,
      is_formal: false,
      via_business: false,
      via_sns: false,
      via_paid: false,
    })

    // Blank account_label: not formal
    expect(byId.get(wsSnsBlankLabel)).toEqual({
      workspace_id: wsSnsBlankLabel,
      is_formal: false,
      via_business: false,
      via_sns: false,
      via_paid: false,
    })

    // Business verifications VERIFIED
    expect(byId.get(wsBizVerified)).toMatchObject({
      workspace_id: wsBizVerified,
      is_formal: true,
      via_business: true,
    })

    // Business verifications PENDING: not formal
    expect(byId.get(wsBizPending)).toMatchObject({
      workspace_id: wsBizPending,
      is_formal: false,
      via_business: false,
    })

    // Instagram connection
    expect(byId.get(wsSnsInsta)).toMatchObject({
      workspace_id: wsSnsInsta,
      is_formal: true,
      via_sns: true,
    })

    // Threads connection
    expect(byId.get(wsSnsThreads)).toMatchObject({
      workspace_id: wsSnsThreads,
      is_formal: true,
      via_sns: true,
    })

    // Purchased credits
    expect(byId.get(wsPaidCredits)).toMatchObject({
      workspace_id: wsPaidCredits,
      is_formal: true,
      via_paid: true,
    })

    // Active commercial state
    expect(byId.get(wsPaidCommercial)).toMatchObject({
      workspace_id: wsPaidCommercial,
      is_formal: true,
      via_paid: true,
    })

    // Paid billing entitlement
    expect(byId.get(wsPaidEntitlement)).toMatchObject({
      workspace_id: wsPaidEntitlement,
      is_formal: true,
      via_paid: true,
    })
  })
})

describe('list_operator_workspaces with p_member_filter', () => {
  it('filters formal members when p_member_filter is formal', () => {
    const [result] = query<{ items: Array<{ workspace_id: string; member_status: string }> }>(
      `select public.list_operator_workspaces(null, null, null, null, null, 50, 'formal') as result`,
      actor
    )
    expect(result.items.length).toBeGreaterThanOrEqual(6)
    for (const item of result.items) {
      expect(item.member_status).toBe('FORMAL')
      expect(item.workspace_id).not.toBe(wsApplicant)
      expect(item.workspace_id).not.toBe(wsBizPending)
      expect(item.workspace_id).not.toBe(wsSnsBlankLabel)
    }
  })

  it('filters applicants when p_member_filter is applicant', () => {
    const [result] = query<{ items: Array<{ workspace_id: string; member_status: string }> }>(
      `select public.list_operator_workspaces(null, null, null, null, null, 50, 'applicant') as result`,
      actor
    )
    const returnedIds = result.items.map((i) => i.workspace_id)
    expect(returnedIds).toContain(wsApplicant)
    expect(returnedIds).toContain(wsBizPending)
    expect(returnedIds).toContain(wsSnsBlankLabel)
    for (const item of result.items) {
      expect(item.member_status).toBe('APPLICANT')
      expect(item.workspace_id).not.toBe(wsBizVerified)
    }
  })

  it('includes member_status for all items when filter is all or omitted', () => {
    const [result] = query<{ items: Array<{ workspace_id: string; member_status: string }> }>(
      `select public.list_operator_workspaces(null, null, null, null, null, 50, 'all') as result`,
      actor
    )
    const byId = new Map(result.items.map((i) => [i.workspace_id, i.member_status]))
    expect(byId.get(wsApplicant)).toBe('APPLICANT')
    expect(byId.get(wsBizPending)).toBe('APPLICANT')
    expect(byId.get(wsBizVerified)).toBe('FORMAL')
  })

  it('supports legacy 6-argument call without p_member_filter and includes member_status', () => {
    const [result] = query<{ items: Array<{ workspace_id: string; member_status: string }> }>(
      `select public.list_operator_workspaces(null, null, null, null, null, 50) as result`,
      actor
    )
    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(['FORMAL', 'APPLICANT']).toContain(item.member_status)
    }
    const byId = new Map(result.items.map((i) => [i.workspace_id, i.member_status]))
    expect(byId.get(wsApplicant)).toBe('APPLICANT')
    expect(byId.get(wsBizVerified)).toBe('FORMAL')
  })
})

describe('preview_bulk_credit_grant excludes uncertified applicants', () => {
  it('includes only formal members in bulk grant target count', () => {
    const [result] = query<{ target_count: number; sample_names: string[] }>(
      `select public.preview_bulk_credit_grant('all_active', null) as result`
    )
    expect(result.target_count).toBe(6)
    expect(result.sample_names).not.toContain('가입자 미인증')
    expect(result.sample_names).not.toContain('사업자인증 대기 미인증')
    expect(result.sample_names).not.toContain('SNS라벨없음 미인증')
  })
})
