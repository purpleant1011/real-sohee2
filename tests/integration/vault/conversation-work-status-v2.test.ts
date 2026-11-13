import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'
const owner = 'e1000000-0000-4000-8000-000000000001'
const stranger = 'e2000000-0000-4000-8000-000000000001'
const ws = 'e3000000-0000-4000-8000-000000000001'
const other = 'e4000000-0000-4000-8000-000000000001'
const thread = 'e5000000-0000-4000-8000-000000000001'
beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${owner}'),('${stranger}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces(id,name,created_by) values ('${ws}','상태 조회 테스트','${owner}'),('${other}','다른 가게','${stranger}') returning id) select id from w`)
  query(`with t as (insert into public.conversation_threads(id,workspace_id,kind,title,status) values ('${thread}','${ws}','operations','우리 가게 대화','active') returning id) select id from t`)
})
describe('authenticated conversation status v2 RPC', () => {
  it('lets a real authenticated owner read status while the underlying credit RPC stays private', () => {
    expect(() => query(`select public.get_workspace_credit_balance('${ws}')`, owner)).toThrow(/permission denied/)
    const result = query<{ payload: { threads: { threadId: string }[]; activeJobCount: number; creditBalance: { workspaceId: string; weeklyLimit: number; policyVersion: string } } }>(`select public.get_conversation_work_status_v2('${ws}') as payload`, owner)[0].payload
    expect(result.creditBalance.workspaceId).toBe(ws)
    expect(result.activeJobCount).toBe(0)
    expect(result.threads.map(row => row.threadId)).toContain(thread)
    const policy = query<{ weekly_credits: number; policy_version: string }>(`select weekly_credits,policy_version from private.resolve_workspace_weekly_credit_policy('${ws}',statement_timestamp())`)[0]
    expect(result.creditBalance.weeklyLimit).toBe(policy.weekly_credits)
    expect(result.creditBalance.policyVersion).toBe(policy.policy_version)
  })
  it('rejects a real authenticated user who is not a current member', () => {
    expect(() => query(`select public.get_conversation_work_status_v2('${ws}')`, stranger)).toThrow(/CONVERSATION_WORK_STATUS_FORBIDDEN/)
    expect(() => query(`select public.get_conversation_work_status_v2('${other}')`, owner)).toThrow(/CONVERSATION_WORK_STATUS_FORBIDDEN/)
  })
  it('does not expose the definer wrapper to anonymous callers', () => {
    expect(query<{ allowed: boolean }>(`select has_function_privilege('anon','public.get_conversation_work_status_v2(uuid)','EXECUTE') as allowed`)[0].allowed).toBe(false)
    expect(query<{ allowed: boolean }>(`select has_function_privilege('authenticated','public.get_conversation_work_status_v2(uuid)','EXECUTE') as allowed`)[0].allowed).toBe(true)
    expect(() => query(`select public.get_conversation_work_status_v2('${ws}')`)).toThrow(/CONVERSATION_WORK_STATUS_FORBIDDEN/)
  })
  it('uses a pinned definer search path and keeps the previous RPC available for rollback', () => {
    const metadata = query<{ prosecdef: boolean; proconfig: string[] }>(`select prosecdef,proconfig from pg_proc where oid='public.get_conversation_work_status_v2(uuid)'::regprocedure`)[0]
    expect(metadata.prosecdef).toBe(true)
    expect(metadata.proconfig.join(' ')).not.toContain('public')
    expect(query<{ exists: boolean }>(`select to_regprocedure('public.get_conversation_work_status(uuid)') is not null as exists`)[0].exists).toBe(true)
  })
})
