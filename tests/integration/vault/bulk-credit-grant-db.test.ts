import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const actor = 'b7000000-0000-4000-8000-000000000001'
const ids = ['b7000000-0000-4000-8000-000000000011', 'b7000000-0000-4000-8000-000000000012', 'b7000000-0000-4000-8000-000000000013', 'b7000000-0000-4000-8000-000000000014']
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`
const preview = (audience: string, days: number | null) => query<{ target_count: number; sample_names: string[] }>(`select public.preview_bulk_credit_grant(${lit(audience)},${days ?? 'null'}) as result`)[0]
const grant = (key: string, amount = 30, reason = '가입 축하') => query<{ campaign_id: string; target_count: number; granted_count: number; skipped_count: number }>(`select public.grant_bulk_credits('${actor}','all_active',null,${amount},${lit(reason)},${lit(key)}) as result`)[0]

beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${actor}') returning id) select id from u`)
  query(`with m as (insert into public.platform_admin_members(user_id,status) values ('${actor}','active') returning user_id) select user_id from m`)
  query(`with a as (insert into public.platform_admin_role_assignments(user_id,role_key) values ('${actor}','platform_owner') returning id) select id from a`)
  ids.forEach((id, index) => {
    const kind = index === 2 ? 'demo' : 'production'
    const name = index === 3 ? '시연 쇼케이스' : `사업자 ${index}`
    const created = index === 1 ? "now() - interval '40 days'" : 'now()'
    query(`with w as (insert into public.workspaces(id,name,created_by,workspace_kind,created_at) values ('${id}',${lit(name)},'${actor}','${kind}',${created}) returning id) select id from w`)
    query(`with p as (insert into public.business_profiles(workspace_id,business_name) values ('${id}',${lit(name)}) returning workspace_id) select workspace_id from p`)
    query(`with bv as (insert into public.business_verifications(workspace_id,business_number,company_name,representative_name,status) values ('${id}','1234567890',${lit(name)},'대표자','VERIFIED') returning id) select id from bv`)
    query(`with a as (insert into public.credit_accounts(workspace_id,period_start,period_end) values ('${id}',current_date,current_date+7) returning id) select id from a`)
  })
})

describe('실제 사업자 크레딧 일괄 지급', () => {
  it('익명 및 일반 로그인 역할의 미리보기와 지급 실행을 모두 거부한다', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(query<{ allowed: boolean }>(`select has_function_privilege('${role}', 'public.preview_bulk_credit_grant(text,integer)', 'EXECUTE') as allowed`)[0].allowed).toBe(false)
      expect(query<{ allowed: boolean }>(`select has_function_privilege('${role}', 'public.grant_bulk_credits(uuid,text,integer,integer,text,text)', 'EXECUTE') as allowed`)[0].allowed).toBe(false)
    }
    expect(query<{ allowed: boolean }>(`select has_function_privilege('service_role', 'public.grant_bulk_credits(uuid,text,integer,integer,text,text)', 'EXECUTE') as allowed`)[0].allowed).toBe(true)
  })
  it('사업자 중 데모·쇼케이스를 격리하고 최근 가입 범위를 제한한다', () => {
    expect(preview('all_active', null).target_count).toBe(2)
    expect(preview('recent_signups', 7).target_count).toBe(1)
    expect(preview('all_active', null).sample_names).toEqual(expect.arrayContaining(['사업자 0', '사업자 1']))
    expect(() => preview('recent_signups', 31)).toThrow()
  })
  it('원장·잔액·캠페인 감사 이력을 원자적으로 기록하고 같은 키의 재시도는 지급하지 않는다', () => {
    const balanceBefore = query<{ amount: number }>(`select coalesce(sum(amount),0)::int as amount from public.credit_ledger_entries where workspace_id='${ids[0]}'`)[0].amount
    const first = grant('b700-first')
    expect(first).toMatchObject({ target_count: 2, granted_count: 2, skipped_count: 0 })
    expect(grant('b700-first')).toEqual(first)
    expect(query<{ n: number }>(`select count(*)::int as n from public.credit_ledger_entries where idempotency_key like 'bulk:${first.campaign_id}:%'`)[0].n).toBe(2)
    const balanceAfter = query<{ amount: number }>(`select coalesce(sum(amount),0)::int as amount from public.credit_ledger_entries where workspace_id='${ids[0]}'`)[0].amount
    expect(balanceAfter).toBe(balanceBefore + 30)
    expect(query<{ amount: number }>(`select coalesce(sum(amount),0)::int as amount from public.credit_ledger_entries where workspace_id='${ids[0]}' and idempotency_key='bulk:${first.campaign_id}:${ids[0]}'`)[0].amount).toBe(30)
    expect(query<{ n: number }>(`select count(*)::int as n from public.audit_events where event_type='admin_bulk_credit_grant' and entity_id='${first.campaign_id}'`)[0].n).toBe(1)
    expect(() => grant('b700-first', 31)).toThrow()
  })
  it('5만 초과와 빈 사유를 거부하고 아무 원장 행도 만들지 않는다', () => {
    expect(() => grant('b700-too-high', 50001)).toThrow()
    expect(() => grant('b700-no-reason', 10, ' ')).toThrow()
    expect(query<{ n: number }>(`select count(*)::int as n from public.credit_grant_campaigns where idempotency_key like 'b700-%'`)[0].n).toBe(1)
  })
})
