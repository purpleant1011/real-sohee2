import { describe, expect, it } from 'vitest'
import { appendActivity, replayActivity, readActivityRunStatus } from './activity-store'

const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const row = {
  event_id: '00000000-0000-0000-0000-000000000003', workspace_id: workspaceId,
  run_id: runId, mission_id: null, step_id: null, sequence: 1,
  observed_at: '2026-10-26T12:00:00Z', kind: 'request_received', simulated: false,
  dedupe_key: 'request', raw_args: 'SECRET_CUSTOMER',
}

describe('public activity store', () => {
  it('복구 상태는 회원 RLS로 해당 workspace/run의 status만 읽고 원본 JSON은 공개하지 않는다', async () => {
    const calls: unknown[] = []
    const query = {
      select: (columns: string) => { calls.push(['select', columns]); return query },
      eq: (column: string, value: string) => { calls.push(['eq', column, value]); return query },
      maybeSingle: async () => ({ data: { status: 'executing', plan_data: 'SECRET' }, error: null }),
    }
    const db = { from: (table: string) => { calls.push(['from', table]); return query } }
    expect(await readActivityRunStatus(db as never, { workspaceId, runId })).toBe('executing')
    expect(calls).toEqual([
      ['from', 'conversation_jobs'], ['select', 'status'],
      ['eq', 'workspace_id', workspaceId], ['eq', 'id', runId],
    ])
    for (const data of [null, { status: 'VERIFIED raw token' }]) {
      query.maybeSingle = async () => ({ data: data as never, error: null })
      await expect(readActivityRunStatus(db as never, { workspaceId, runId })).rejects.toThrow('ACTIVITY_UNAVAILABLE')
    }
  })
  it('append 응답을 검증·최소 투영하고 DB 실패를 성공으로 숨기지 않는다', async () => {
    const calls: unknown[] = []
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push([name, args])
      return { data: [row], error: null }
    } }
    const event = await appendActivity(db as never, { workspaceId, runId, kind: 'request_received', dedupeKey: 'request' })
    expect(event.sequence).toBe(1)
    expect(JSON.stringify(event)).not.toContain('SECRET_CUSTOMER')
    expect(calls).toEqual([['append_agent_activity', {
      p_workspace_id: workspaceId, p_run_id: runId, p_step_id: null,
      p_kind: 'request_received', p_dedupe_key: 'request', p_simulated: false,
    }]])
    await expect(appendActivity({ rpc: async () => ({ data: null, error: { message: 'secret DB error' } }) } as never,
      { workspaceId, runId, kind: 'request_received', dedupeKey: 'request' })).rejects.toThrow('ACTIVITY_UNAVAILABLE')
  })

  it('다른 tenant/run 또는 잘못된 저장 행은 발행하지 않는다', async () => {
    for (const invalid of [{ ...row, workspace_id: runId }, { ...row, run_id: workspaceId }, { ...row, sequence: 0 }]) {
      await expect(appendActivity({ rpc: async () => ({ data: [invalid], error: null }) } as never,
        { workspaceId, runId, kind: 'request_received', dedupeKey: 'request' })).rejects.toThrow('ACTIVITY_INVALID')
    }
  })

  it('replay는 workspace/run/last-seq를 쿼리에 적용하고 오염된 행을 거부한다', async () => {
    const calls: unknown[] = []
    const query = {
      select: (fields: string) => { calls.push(['select', fields]); return query },
      eq: (field: string, value: string) => { calls.push(['eq', field, value]); return query },
      gt: (field: string, value: number) => { calls.push(['gt', field, value]); return query },
      order: (field: string, options: unknown) => { calls.push(['order', field, options]); return query },
      limit: async (limit: number) => { calls.push(['limit', limit]); return { data: [row], error: null } },
    }
    const db = { from: (table: string) => { calls.push(['from', table]); return query } }
    const events = await replayActivity(db as never, { workspaceId, runId, after: 0 })
    expect(events).toHaveLength(1)
    expect(calls).toContainEqual(['eq', 'workspace_id', workspaceId])
    expect(calls).toContainEqual(['eq', 'run_id', runId])
    expect(calls).toContainEqual(['gt', 'sequence', 0])
    expect(calls).toContainEqual(['order', 'sequence', { ascending: true }])
    expect(JSON.stringify(events)).not.toContain('SECRET_CUSTOMER')
    await expect(replayActivity(db as never, { workspaceId, runId, after: 1 })).rejects.toThrow('ACTIVITY_INVALID')
  })
})
