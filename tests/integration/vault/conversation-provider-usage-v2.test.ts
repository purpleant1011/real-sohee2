import { beforeAll, describe, expect, it } from 'vitest'
import { query, pgClient } from './pg-client'
import { createPreparedAgentPersistence } from '@/features/chat/prepared-agent-persistence'
import type { ServerSupabaseClient } from '@/features/operations/types'

const owner = 'f1000000-0000-4000-8000-000000000001'
const ws = 'f2000000-0000-4000-8000-000000000001'
const thread = 'f3000000-0000-4000-8000-000000000001'
let job: { id: string; assistant_message_id: string }
beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${owner}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces(id,name,created_by) values ('${ws}','실제 공급자 사용량 검증','${owner}') returning id) select id from w`)
  query(`with t as (insert into public.conversation_threads(id,workspace_id,kind,title,status) values ('${thread}','${ws}','operations','사용량 검증','active') returning id) select id from t`)
  const data = query<{ payload: { job: typeof job } }>(`select public.enqueue_conversation_job('${ws}','${thread}','${owner}','f4000000-0000-4000-8000-000000000001','조회','조회','chat',20,'f5000000-0000-4000-8000-000000000001') as payload`)[0].payload
  job = data.job
  query(`select public.claim_conversation_job('${job.id}','f7000000-0000-4000-8000-000000000001',statement_timestamp()) as payload`)
})

function record(provider = 'gemini', output = 5, workspaceId = ws) {
  return `select public.record_ai_usage_event_v2(
    '${workspaceId}','${job.id}','${job.assistant_message_id}','gemini-call-1','response-1',
    'gemini-3.8-flash','text_response',10,2,${output},0,0,${10 + output},'actual','usage-proof-v2',1,'${provider}') as accepted`
}

describe('canonical provider usage v2', () => {
  it('persists model intent before a call and refuses automatic replay of the same attempt', async () => {
    const persistence = createPreparedAgentPersistence({ client: pgClient() as unknown as ServerSupabaseClient,
      job: { id: job.id, workspaceId: ws, workerId: 'f7000000-0000-4000-8000-000000000001' }, authorized: async () => true })
    await persistence.prepareModelCall(1)
    expect(query<{ state: string }>(`select state from public.conversation_job_steps where job_id='${job.id}' and operation='text_response'`)).toEqual([{ state: 'in_flight' }])
    await persistence.completeModelCall({ provider: 'gemini', providerRequestId: 'response-1', model: 'gemini-3.8-flash',
      operation: 'text_response', usageSource: 'actual', usage: { textInputTokens: 10, cachedTextInputTokens: 2,
        textOutputTokens: 5, imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 15 } })
    expect(query<{ state: string }>(`select state from public.conversation_job_steps where job_id='${job.id}' and operation='text_response'`)).toEqual([{ state: 'succeeded' }])
    await expect(persistence.prepareModelCall(1)).rejects.toThrow('PROVIDER_RESULT_UNKNOWN')
  })

  it('prevents a replaced worker from overwriting the canonical runtime checkpoint', async () => {
    const persistence = createPreparedAgentPersistence({ client: pgClient() as unknown as ServerSupabaseClient,
      job: { id: job.id, workspaceId: ws, workerId: 'f7000000-0000-4000-8000-000000000001' }, authorized: async () => true })
    await persistence.persistPlan({ marker: 'original-worker' })
    query(`with changed as (update public.conversation_jobs set worker_id='f7000000-0000-4000-8000-000000000002' where id='${job.id}' returning id) select id from changed`)
    await expect(persistence.persistPlan({ marker: 'stale-worker' })).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(query<{ marker: string }>(`select plan_data->>'marker' as marker from public.conversation_jobs where id='${job.id}'`)[0].marker).toBe('original-worker')
  })

  it('records the physical provider on the existing append-only usage ledger', () => {
    expect(query<{ accepted: boolean }>(record())[0].accepted).toBe(true)
    const rows = query<{ provider: string; text_input_tokens: number; text_output_tokens: number }>(`select provider,text_input_tokens,text_output_tokens from public.ai_usage_events where job_id='${job.id}'`)
    expect(rows).toEqual([{ provider: 'gemini', text_input_tokens: 10, text_output_tokens: 5 }])
    expect(query<{ accepted: boolean }>(record())[0].accepted).toBe(true)
    expect(query<{ count: number }>(`select count(*)::integer from public.ai_usage_events where job_id='${job.id}'`)[0].count).toBe(1)
  })

  it('rejects a changed provider or token payload on the same call key', () => {
    expect(() => query(record('openai'))).toThrow(/AI_USAGE_IDEMPOTENCY_CONFLICT/)
    expect(() => query(record('gemini', 6))).toThrow(/AI_USAGE_IDEMPOTENCY_CONFLICT/)
  })

  it('rejects a different workspace and never exposes writes to client roles', () => {
    expect(() => query(record('gemini', 5, 'f6000000-0000-4000-8000-000000000001'))).toThrow(/AI_USAGE_JOB_MISMATCH/)
    expect(() => query(record(), owner)).toThrow(/permission denied/)
    expect(query<{ allowed: boolean }>(`select has_function_privilege('anon',p.oid,'execute') as allowed from pg_proc p where proname='record_ai_usage_event_v2'`)[0].allowed).toBe(false)
  })

  it('preserves append-only history and the old RPC for existing consumers', () => {
    expect(() => query(`with changed as (update public.ai_usage_events set provider='openai' where job_id='${job.id}' returning id) select id from changed`)).toThrow(/AI_USAGE_APPEND_ONLY/)
    expect(query<{ present: boolean }>(`select exists(select 1 from pg_proc where proname='record_ai_usage_event') as present`)[0].present).toBe(true)
  })
})
