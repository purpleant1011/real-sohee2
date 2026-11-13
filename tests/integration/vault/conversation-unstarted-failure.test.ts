import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'
const owner = randomUUID(), ws = randomUUID(), worker = randomUUID()
beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${owner}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces(id,name,created_by) values ('${ws}','사전 실패 복구','${owner}') returning id) select id from w`)
})
function enqueue(thread: string) {
  return query<{ payload: { job: { id: string; reservation_id: string } } }>(`select public.enqueue_conversation_job('${ws}','${thread}','${owner}','${randomUUID()}','조회','조회','chat',20,'${randomUUID()}') as payload`)[0].payload.job
}
function failed(code = 'CONVERSATION_CONTEXT_UNAVAILABLE', release = true) {
  const thread = randomUUID()
  query(`with t as (insert into public.conversation_threads(id,workspace_id,kind,title,status) values ('${thread}','${ws}','operations','실패 복구','active') returning id) select id from t`)
  const job = enqueue(thread)
  query(`select public.claim_conversation_job('${job.id}','${worker}',statement_timestamp())`)
  if (release) query(`select public.release_unstarted_conversation_job_credit('${job.id}','${worker}','${code}')`)
  query(`select public.complete_conversation_job_v2('${job.id}','${worker}','needs_attention','${code}',statement_timestamp())`)
  return { job, thread }
}
const resolve = (id: string, scope = ws, lease = worker) => `select public.resolve_unstarted_conversation_job_attention('${scope}','${id}','${lease}') as resolved`

describe('known unstarted conversation failures never wedge a thread', () => {
  it('unblocks the next queued request only after proven zero-effect failure reconciliation', () => {
    const { job, thread } = failed()
    const next = enqueue(thread)
    expect(query<{ payload: { state: string } }>(`select public.claim_conversation_job('${next.id}','${randomUUID()}',statement_timestamp()) as payload`)[0].payload.state).toBe('blocked_by_predecessor')
    expect(query<{ resolved: boolean }>(resolve(job.id))[0].resolved).toBe(true)
    expect(query<{ resolved: boolean }>(resolve(job.id))[0].resolved).toBe(true)
    expect(query<{ payload: { state: string } }>(`select public.claim_conversation_job('${next.id}','${randomUUID()}',statement_timestamp()) as payload`)[0].payload.state).toBe('claimed')
    expect(query<{ status: string; attention_resolution: string }>(`select status,attention_resolution from public.conversation_jobs where id='${job.id}'`)[0]).toEqual({ status: 'needs_attention', attention_resolution: 'ended' })
  })
  it('never resolves ambiguous outcomes, reserved credits, foreign scopes, or stale workers', () => {
    const unknown = failed('PROVIDER_RESULT_UNKNOWN')
    expect(query<{ resolved: boolean }>(resolve(unknown.job.id))[0].resolved).toBe(false)
    const reserved = failed('CONVERSATION_CONTEXT_UNAVAILABLE', false)
    expect(query<{ resolved: boolean }>(resolve(reserved.job.id))[0].resolved).toBe(false)
    const known = failed()
    expect(query<{ resolved: boolean }>(resolve(known.job.id, randomUUID()))[0].resolved).toBe(false)
    expect(query<{ resolved: boolean }>(resolve(known.job.id, ws, randomUUID()))[0].resolved).toBe(false)
  })
  it('refuses to clear attention when any execution intent exists, even after release', () => {
    const { job } = failed()
    query(`with s as (insert into public.conversation_job_steps(workspace_id,job_id,provider_call_key,step_index,capability_id,risk_tier,status,state,input_payload,output_payload) values ('${ws}','${job.id}','late-intent',1,'model.plan','LOW','failed','failed','{}','{}') returning id) select id from s`)
    expect(query<{ resolved: boolean }>(resolve(job.id))[0].resolved).toBe(false)
  })
  it('keeps reconciliation server-only', () => {
    const { job } = failed()
    expect(() => query(resolve(job.id), owner)).toThrow(/permission denied/)
    expect(query<{ allowed: boolean }>(`select has_function_privilege('anon','public.resolve_unstarted_conversation_job_attention(uuid,uuid,uuid)','execute') as allowed`)[0].allowed).toBe(false)
  })
})
