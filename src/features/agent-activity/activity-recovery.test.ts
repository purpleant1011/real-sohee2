import { describe, expect, it } from 'vitest'
import { ActivityCursor, recoverActivity } from './activity-recovery'
const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const event = (sequence: number) => ({
  event_id: `00000000-0000-0000-0000-${String(sequence).padStart(12, '0')}`,
  workspace_id: workspaceId, run_id: runId, mission_id: null, step_id: null,
  sequence, observed_at: '2026-10-26T12:00:00Z', kind: 'result_unknown', simulated: false,
})
describe('영속 활동 커서 복구', () => {
  it('역순·중복 이벤트를 버퍼링하고 연속 순서로 딱 한 번만 전달한다', () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    expect(cursor.push(event(3))).toEqual([])
    expect(cursor.lastSequence).toBe(0)
    expect(cursor.push(event(1)).map(e => e.sequence)).toEqual([1])
    expect(cursor.push(event(1))).toEqual([])
    expect(cursor.push(event(2)).map(e => e.sequence)).toEqual([2, 3])
    expect(cursor.lastSequence).toBe(3)
  })
  it('다른 테넌트·run과 순번 충돌은 현재 기록에 섞지 않는다', () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    expect(() => cursor.push({ ...event(1), workspace_id: runId })).toThrow('ACTIVITY_SCOPE_MISMATCH')
    expect(() => cursor.push({ ...event(1), run_id: workspaceId })).toThrow('ACTIVITY_SCOPE_MISMATCH')
    cursor.push(event(2))
    expect(() => cursor.push({ ...event(2), event_id: event(3).event_id })).toThrow('ACTIVITY_SEQUENCE_CONFLICT')
    expect(cursor.lastSequence).toBe(0)
  })
  it('재연결은 POST를 재실행하지 않고 last-seq GET으로 누락분을 복구한다', async () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    cursor.push(event(1))
    cursor.push(event(3))
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetcher = async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      return new Response(JSON.stringify({ events: [event(2), event(3)], last_seq: 3 }), { headers: { 'Content-Type': 'application/json' } })
    }
    const restored = await recoverActivity(cursor, { fetcher })
    expect(restored.map(e => e.sequence)).toEqual([2, 3])
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`/api/workspaces/${workspaceId}/agent/activity?runId=${runId}&last-seq=1`)
    expect(requests[0].init).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(cursor.lastSequence).toBe(3)
  })
  it('200건 페이지를 넘는 활동도 마지막 순번부터 GET으로 이어서 복구한다', async () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    const requests: string[] = []
    const restored = await recoverActivity(cursor, { fetcher: async url => {
      requests.push(url)
      return Response.json({ events: requests.length === 1
        ? Array.from({ length: 200 }, (_, index) => event(index + 1)) : [event(201)] })
    } })
    expect(restored.map(e => e.sequence)).toEqual(Array.from({ length: 201 }, (_, index) => index + 1))
    expect(requests[1]).toContain('last-seq=200')
    expect(cursor.lastSequence).toBe(201)
  })
  it('페이지 뒷부분이 다른 테넌트이면 앞부분도 커서에 커밋하지 않는다', async () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    await expect(recoverActivity(cursor, { fetcher: async () => Response.json({
      events: [event(1), { ...event(2), workspace_id: runId }],
    }) })).rejects.toThrow('ACTIVITY_SCOPE_MISMATCH')
    expect(cursor.lastSequence).toBe(0)
    expect(cursor.push(event(1)).map(e => e.sequence)).toEqual([1])
  })
  it('누락 순번이 조회되지 않으면 복구 성공으로 감추지 않는다', async () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    cursor.push(event(3))
    await expect(recoverActivity(cursor, { fetcher: async () => Response.json({ events: [] }) }))
      .rejects.toThrow('ACTIVITY_REPLAY_GAP')
  })
  it('조회 실패는 커서를 전진시키거나 빈 성공으로 감추지 않는다', async () => {
    const cursor = new ActivityCursor(workspaceId, runId)
    await expect(recoverActivity(cursor, { fetcher: async () => new Response('denied', { status: 403 }) })).rejects.toThrow('ACTIVITY_REPLAY_FAILED')
    expect(cursor.lastSequence).toBe(0)
  })
})
