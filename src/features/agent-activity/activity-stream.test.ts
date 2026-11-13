import { describe, expect, it, vi } from 'vitest'
import { consumeActivityStream } from './activity-stream'

const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const event = (sequence: number) => ({
  event_id: `00000000-0000-0000-0000-${String(sequence).padStart(12, '0')}`,
  workspace_id: workspaceId, run_id: runId, mission_id: null, step_id: null,
  sequence, observed_at: '2026-10-26T12:00:00Z', kind: 'result_unknown', simulated: false,
})
const frame = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
function stream(text: string, disconnect = false) {
  let sent = false
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(text)) }
      else if (disconnect) controller.error(new Error('network disconnected'))
      else controller.close()
    },
  })
}

describe('채팅 활동 스트림 소비·복구', () => {
  it('실행 중 단절은 늦은 활동까지 GET으로 추적하며 결과 프레임을 만들어내지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const activities: number[] = []
      const frames: string[] = []
      let requests = 0
      const promise = consumeActivityStream(stream(frame('run', { runId }), true), {
        workspaceId, onActivity: value => activities.push(value.sequence),
        onFrame: value => frames.push(value.event),
        fetcher: async (_url, init) => {
          expect(init?.method).toBe('GET')
          requests++
          return Response.json(requests === 1 ? { events: [], run_status: 'executing' }
            : { events: [event(1)], run_status: 'completed' })
        },
      })
      await vi.runAllTimersAsync()
      await promise
      expect(activities).toEqual([1])
      expect(frames).toEqual(['run'])
      expect(requests).toBe(2)
    } finally { vi.useRealTimers() }
  })

  it.each([false, true])('종료/단절(%s) 시 GET 누락 복구를 한 번만 발행하고 원래 결과 프레임을 유지한다', async disconnect => {
    const activities: number[] = []
    const frames: string[] = []
    const requests: string[] = []
    await consumeActivityStream(stream(
      frame('run', { runId }) + frame('activity', event(1)) + frame('activity', event(3)), disconnect,
    ), {
      workspaceId,
      onActivity: activity => activities.push(activity.sequence),
      onFrame: sse => frames.push(sse.event),
      fetcher: async (url, init) => {
        requests.push(url)
        expect(init?.method).toBe('GET')
        return Response.json({ events: [event(2), event(3)], run_status: 'completed' })
      },
    })
    expect(activities).toEqual([1, 2, 3])
    expect(frames).toEqual(['run'])
    expect(requests).toEqual([`/api/workspaces/${workspaceId}/agent/activity?runId=${runId}&last-seq=1`])
  })

  it('result를 받아도 활동 중간 순번이 유실됐으면 GET으로 복구한다', async () => {
    const activities: number[] = []
    await consumeActivityStream(stream(frame('activity', event(1)) + frame('activity', event(3)) + frame('result', {})), {
      workspaceId, onActivity: activity => activities.push(activity.sequence), onFrame: () => {},
      fetcher: async () => Response.json({ events: [event(2), event(3)], run_status: 'completed' }),
    })
    expect(activities).toEqual([1, 2, 3])
  })

  it('정상 result와 연속 활동은 추가 조회 없이 전달한다', async () => {
    const frames: string[] = []
    const activities: number[] = []
    await consumeActivityStream(stream(frame('activity', event(1)) + frame('result', { reply: '확인 필요' })), {
      workspaceId,
      onActivity: activity => activities.push(activity.sequence),
      onFrame: sse => frames.push(sse.event),
      fetcher: async () => { throw new Error('unexpected replay') },
    })
    expect(activities).toEqual([1])
    expect(frames).toEqual(['result'])
  })

  it('다른 테넌트 활동은 공개하거나 해당 테넌트로 복구 조회하지 않는다', async () => {
    const activities: number[] = []
    await expect(consumeActivityStream(stream(frame('activity', { ...event(1), workspace_id: runId })), {
      workspaceId, onActivity: activity => activities.push(activity.sequence), onFrame: () => {},
      fetcher: async () => { throw new Error('unexpected replay') },
    })).rejects.toThrow('ACTIVITY_SCOPE_MISMATCH')
    expect(activities).toEqual([])
  })

  it('취소된 요청은 replay를 시작하지 않는다', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(consumeActivityStream(stream(frame('run', { runId })), {
      workspaceId, signal: controller.signal, onActivity: () => {}, onFrame: () => {},
      fetcher: async () => { throw new Error('unexpected replay') },
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
