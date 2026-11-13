import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

// ANI-1560 independent fixtures; no other suite uses the a1560 prefix.
const user = 'a1560002-1111-4111-8111-111111111111'
const ws = 'a1560001-1111-4111-8111-111111111111'
const content = 'a1560003-1111-4111-8111-111111111111'
const version = 'a1560004-1111-4111-8111-111111111111'
const account = 'a1560005-1111-4111-8111-111111111111'
const item = 'a1560006-1111-4111-8111-111111111111'
const lit = (value: string) => `'${value.replaceAll("'", "''")}'`
function apply(kind: string, key: string, active: boolean | null, amount: number | null, reason = '긴급 점검') {
  const rows = query<{ result: { success: boolean; is_replay: boolean; balance?: number } }>(`select public.apply_safety_intervention_ani1560('${ws}','${kind}',${kind === 'CHANNEL' ? "'threads'" : 'null'},${active === null ? 'null' : active},${amount === null ? 'null' : amount},${lit(reason)},${lit(key)},'${user}') as result`)
  return rows[0] as unknown as { success: boolean; is_replay: boolean; balance?: number }
}

beforeAll(() => {
  query(`with u as (insert into auth.users (id) values ('${user}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${ws}','개입 검증','${user}') returning id) select id from w`)
  query(`with a as (insert into public.credit_accounts (id,workspace_id,period_start,period_end) values ('${account}','${ws}',current_date,current_date+7) returning id) select id from a`)
  query(`with c as (insert into public.content_items (id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','검증','${user}') returning id) select id from c`)
  query(`with v as (insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'안전 점검','${'a'.repeat(64)}','${user}') returning id) select id from v`)
  query(`with i as (insert into public.vault_items (id,workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,idempotency_key) values ('${item}','${ws}','${content}','${version}','threads','HELD_USER','USER_HELD',now(),'${'a'.repeat(64)}',3,'vault-save-v1','2026.10.1','APPROVED','a1560-vault') returning id) select id from i`)
})

describe('ANI-1560 interventions in isolated PostgreSQL', () => {
  it('blocks vault release under workspace pause; unlocks with reason and keeps the held item', () => {
    expect(apply('WORKSPACE', 'a1560-pause', true, null).success).toBe(true)
    expect(() => query(`with x as (update public.vault_items set release_gate='RELEASE_REQUESTED' where id='${item}' returning id) select id from x`)).toThrow()
    expect(apply('WORKSPACE', 'a1560-pause', true, null).is_replay).toBe(true)
    expect(() => apply('WORKSPACE', 'a1560-pause', false, null)).toThrow()
    expect(apply('WORKSPACE', 'a1560-resume', false, null, '재개 점검 완료').success).toBe(true)
    expect(query<{ gate: string }>(`select release_gate as gate from public.vault_items where id='${item}'`)[0].gate).toBe('HELD_USER')
    expect(query<{ n: number }>(`select count(*)::int as n from public.audit_events where workspace_id='${ws}' and event_type='safety_intervention'`)[0].n).toBe(2)
  })
  it('blocks one channel and global scope, denies invalid provider scope and missing reason', () => {
    apply('CHANNEL', 'a1560-channel', true, null)
    expect(() => query(`with x as (update public.vault_items set release_gate='RELEASE_REQUESTED' where id='${item}' returning id) select id from x`)).toThrow()
    apply('CHANNEL', 'a1560-unblock', false, null)
    apply('GLOBAL', 'a1560-global', true, null)
    expect(() => query(`with x as (update public.vault_items set release_gate='RELEASE_REQUESTED' where id='${item}' returning id) select id from x`)).toThrow()
    apply('GLOBAL', 'a1560-global-clear', false, null)
    expect(() => apply('PROVIDER', 'a1560-invalid', true, null)).toThrow()
    expect(() => apply('WORKSPACE', 'a1560-no-reason', true, null, ' ')).toThrow()
  })
  it('records credits once in append-only ledger and authoritative balance, auditing actor and reason', () => {
    const first = apply('CREDIT', 'a1560-credit', null, 42)
    expect(first.balance).toBeGreaterThanOrEqual(42)
    expect(apply('CREDIT', 'a1560-credit', null, 42).is_replay).toBe(true)
    expect(() => apply('CREDIT', 'a1560-credit', null, 43)).toThrow()
    expect(query<{ amount: number }>(`select amount from public.credit_ledger_entries where workspace_id='${ws}' and idempotency_key='ani1560:a1560-credit'`)).toEqual([{ amount: 42 }])
    expect(query<{ reason: string; actor: string }>(`select metadata->>'reason' as reason,actor_id::text as actor from public.audit_events where workspace_id='${ws}' and event_type='safety_intervention' and metadata->>'kind'='CREDIT'`)).toEqual([{ reason: '긴급 점검', actor: user }])
    expect(query<{ available: number }>(`select (public.get_workspace_credit_balance('${ws}') ->> 'available')::int as available`)[0].available).toBeGreaterThanOrEqual(42)
  })
  it('rejects unprivileged execution of the intervention RPC', () => {
    expect(() => query(`select public.apply_safety_intervention_ani1560('${ws}','CREDIT',null,null,42,'불법 지급','a1560-unauthorized','${user}')`, user)).toThrow()
  })
})
