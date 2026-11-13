import { beforeAll, describe, expect, it } from 'vitest'
import { query, literal } from './pg-client'

const owner = 'fa000000-0000-4000-8000-000000000001'
const backup = 'fa000000-0000-4000-8000-000000000002'
const ws = 'fb000000-0000-4000-8000-000000000001'
const thread = 'fc000000-0000-4000-8000-000000000001'
const reservation = 'fd000000-0000-4000-8000-000000000001'
const worker = 'fe000000-0000-4000-8000-000000000001'
const stale = 'fe000000-0000-4000-8000-000000000002'
let job: { id: string; assistant_message_id: string }
beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${owner}'),('${backup}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces(id,name,created_by) values ('${ws}','정본 완료 검증','${owner}') returning id) select id from w`)
  query(`with m as (insert into public.workspace_members(workspace_id,user_id,role,status) values ('${ws}','${backup}','owner','active') returning workspace_id) select workspace_id from m`)
  query(`with t as (insert into public.conversation_threads(id,workspace_id,kind,title,status) values ('${thread}','${ws}','operations','완료 검증','active') returning id) select id from t`)
  job = query<{ payload: { job: typeof job } }>(`select public.enqueue_conversation_job('${ws}','${thread}','${owner}','ff000000-0000-4000-8000-000000000001','조회','조회','chat',20,'${reservation}') as payload`)[0].payload.job
  query(`select public.claim_conversation_job('${job.id}','${worker}',statement_timestamp()) as payload`)
})
const stage = (actor = owner, lease = worker, content = '저장된 자료를 확인했습니다.') =>
  `select public.stage_conversation_agent_response('${ws}','${job.id}','${lease}','${actor}',${literal(content)},true,null) as accepted`
const complete = (lease = worker) => `select public.complete_conversation_job_v2('${job.id}','${lease}','succeeded',null,statement_timestamp()) as payload`

describe('prepared conversation response and terminal ownership', () => {
  it('stages the exact answer without declaring completion before settlement', () => {
    expect(query<{ accepted: boolean }>(stage())[0].accepted).toBe(true)
    expect(query<{ status: string; content: string }>(`select status,content from public.messages where id='${job.assistant_message_id}'`)).toEqual([{ status: 'streaming', content: '저장된 자료를 확인했습니다.' }])
    expect(() => query(complete())).toThrow(/CONVERSATION_CREDITS_UNSETTLED/)
  })

  it('does not allow stale workers to stage or terminalize another execution', () => {
    expect(() => query(stage(owner, stale, '오래된 응답'))).toThrow(/CONVERSATION_AUTHORITY_LOST/)
    expect(() => query(`select public.complete_conversation_job_v2('${job.id}','${stale}','needs_attention','OLD_WORKER',statement_timestamp())`)).toThrow(/CONVERSATION_AUTHORITY_LOST/)
    expect(query<{ status: string }>(`select status from public.conversation_jobs where id='${job.id}'`)[0].status).toBe('running')
    expect(query<{ content: string }>(`select content from public.messages where id='${job.assistant_message_id}'`)[0].content).toBe('저장된 자료를 확인했습니다.')
  })

  it('rechecks current membership role and rejects a changed result payload', () => {
    query(`with changed as (update public.workspace_members set role='viewer' where workspace_id='${ws}' and user_id='${owner}' returning user_id) select user_id from changed`)
    try { expect(() => query(stage())).toThrow(/CONVERSATION_AUTHORITY_LOST/) }
    finally { query(`with changed as (update public.workspace_members set role='owner' where workspace_id='${ws}' and user_id='${owner}' returning user_id) select user_id from changed`) }
    expect(() => query(stage(owner, worker, '다른 결과'))).toThrow(/CONVERSATION_RESPONSE_CONFLICT/)
  })

  it('completes the existing message only after canonical settlement and is idempotent', () => {
    query(`select public.settle_credit_reservation('${ws}','${reservation}',1,'${job.id}') as payload`)
    expect(query<{ payload: { job: { status: string } } }>(complete())[0].payload.job.status).toBe('succeeded')
    expect(query<{ status: string }>(`select status from public.messages where id='${job.assistant_message_id}'`)[0].status).toBe('completed')
    expect(query<{ payload: { job: { status: string } } }>(complete())[0].payload.job.status).toBe('succeeded')
  })

  it('keeps both new mutation RPCs server-only', () => {
    expect(() => query(stage(), owner)).toThrow(/permission denied/)
    expect(query<{ allowed: boolean }>(`select has_function_privilege('anon',oid,'execute') as allowed from pg_proc where proname in ('stage_conversation_agent_response','complete_conversation_job_v2')`).every(row => row.allowed === false)).toBe(true)
  })
})
