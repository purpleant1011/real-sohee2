import { afterEach, expect, it, vi } from 'vitest'
import { ActivityCursor, followActivity } from './activity-recovery'

const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const event = (sequence: number) => ({
  event_id: `00000000-0000-0000-0000-${String(sequence).padStart(12, '0')}`,
  workspace_id: workspaceId, run_id: runId, mission_id: null, step_id: null,
  sequence, observed_at: '2026-10-26T12:00:00Z', kind: 'result_unknown', simulated: false,
})
afterEach(() => vi.useRealTimers())

it.each([undefined, 'VERIFIED secret'])('상태 계약 위반(%s)은 활동과 cursor를 반영하지 않는다', async runStatus => {
  const cursor = new ActivityCursor(workspaceId, runId)
  const activities: number[] = []
  await expect(followActivity(cursor, {
    onActivity: value => activities.push(value.sequence),
    fetcher: async () => Response.json({ events: [event(1)], run_status: runStatus }),
  })).rejects.toThrow('ACTIVITY_INVALID')
  expect(cursor.lastSequence).toBe(0)
  expect(activities).toEqual([])
})

it('GET 응답 전에 취소되면 늦은 활동과 cursor를 반영하지 않는다', async () => {
  const controller = new AbortController()
  const cursor = new ActivityCursor(workspaceId, runId)
  const activities: number[] = []
  await expect(followActivity(cursor, {
    signal: controller.signal, onActivity: value => activities.push(value.sequence),
    fetcher: async (_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      return Response.json({ events: [event(1)], run_status: 'completed' })
    },
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(cursor.lastSequence).toBe(0)
  expect(activities).toEqual([])
})

it('추적은 한 번의 조회가 200건을 넘어도 페이지를 모두 복원한다', async () => {
  const activities: number[] = []
  const requests: string[] = []
  const status = await followActivity(new ActivityCursor(workspaceId, runId), {
    onActivity: value => activities.push(value.sequence),
    fetcher: async url => {
      requests.push(url)
      return Response.json({
        events: requests.length === 1 ? Array.from({ length: 200 }, (_, index) => event(index + 1)) : [event(201)],
        run_status: 'completed',
      })
    },
  })
  expect(status).toBe('completed')
  expect(activities).toHaveLength(201)
  expect(activities.at(-1)).toBe(201)
  expect(requests[1]).toContain('last-seq=200')
})

it('단절 직후 빈 replay라도 실행 중이면 GET 추적을 계속해 늦은 활동을 한 번만 전달한다', async () => {
  vi.useFakeTimers()
  const requests: RequestInit[] = []
  const activities: number[] = []
  const pending: Array<number | null> = []
  const promise = followActivity(new ActivityCursor(workspaceId, runId), {
    onActivity: value => activities.push(value.sequence),
    onPending: nextCheckAt => pending.push(nextCheckAt),
    fetcher: async (_url, init) => {
      requests.push(init!)
      return Response.json(requests.length === 1 ? { events: [], run_status: 'executing' }
        : { events: [event(1)], run_status: 'completed' })
    },
  })
  await vi.runAllTimersAsync()
  expect(await promise).toBe('completed')
  expect(activities).toEqual([1])
  expect(requests.map(request => request.method)).toEqual(['GET', 'GET'])
  expect(pending).toHaveLength(1)
  expect(pending[0]).toEqual(expect.any(Number))
})

it('계속 실행 중인 작업은 추적 예산 후 멈추고 미확인 상태를 유지한다', async () => {
  vi.useFakeTimers()
  const pending: Array<number | null> = []
  let requests = 0
  const promise = followActivity(new ActivityCursor(workspaceId, runId), {
    onActivity: () => { throw new Error('empty is not verified') },
    onPending: nextCheckAt => pending.push(nextCheckAt),
    fetcher: async () => { requests++; return Response.json({ events: [], run_status: 'running' }) },
  })
  await vi.runAllTimersAsync()
  expect(await promise).toBe('running')
  expect(requests).toBe(5)
  expect(pending.at(-1)).toBeNull()
})

it('다음 확인 대기 중 취소하면 타이머와 GET을 즉시 중단한다', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  let requests = 0
  const promise = followActivity(new ActivityCursor(workspaceId, runId), {
    signal: controller.signal, onActivity: () => {},
    onPending: () => controller.abort(),
    fetcher: async () => { requests++; return Response.json({ events: [], run_status: 'running' }) },
  })
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  await vi.runAllTimersAsync()
  expect(requests).toBe(1)
})

it('복구 도중 인증 만료는 재전송하거나 빈 성공으로 감추지 않는다', async () => {
  await expect(followActivity(new ActivityCursor(workspaceId, runId), {
    onActivity: () => { throw new Error('must not publish') },
    fetcher: async () => new Response('expired', { status: 401 }),
  })).rejects.toThrow('ACTIVITY_REPLAY_FAILED')
})
