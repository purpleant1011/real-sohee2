// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { readEvidenceRecords } from './evidence-record-read'

const WS = '11111111-1111-4111-8111-111111111111'

type QueryResult = { data: unknown; error: unknown }
type Call = { table: string; workspaceId: string; ids: string[] }

/** `from().select().eq().in()` 만 흉내 내는 최소 클라이언트. 실제 네트워크는 쓰지 않는다. */
function fakeClient(resultFor: (table: string, ids: string[]) => QueryResult) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      let workspaceId = ''
      const query = {
        select() { return query },
        eq(_column: string, value: string) { workspaceId = value; return query },
        in(_column: string, ids: string[]) {
          calls.push({ table, workspaceId, ids })
          return Promise.resolve(resultFor(table, ids))
        },
      }
      return query
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('readEvidenceRecords — 예약 장부', () => {
  it('현재 상태로 종류를 다시 도출하고 UTC 날짜로 표시명을 만든다', async () => {
    const { client, calls } = fakeClient(() => ({
      data: [
        { id: 'a', status: 'CONFIRMED', created_at: '2026-10-21T05:00:00.000Z' },
        { id: 'b', status: 'CANCELLED', created_at: '2026-10-22T05:00:00.000Z' },
        { id: 'c', status: 'PENDING', created_at: '2026-10-23T05:00:00.000Z' },
      ],
      error: null,
    }))

    const result = await readEvidenceRecords(client, WS, 'bookings', ['a', 'b', 'c'])

    expect(calls).toEqual([{ table: 'reservations', workspaceId: WS, ids: ['a', 'b', 'c'] }])
    expect(result.complete).toBe(true)
    expect(result.rows?.map(row => row.kind)).toEqual(['BOOKING_CONFIRMED', 'BOOKING_CANCELED', 'UNRECOGNIZED_STATUS'])
    expect(result.rows?.[0].subject).toBe('10월 21일 예약')
    expect(result.rows?.[0].occurredAt).toBe('2026-10-21T05:00:00.000Z')
  })

  it('원장에 없는 id 는 줄이 모자라게 두고 complete=true 로 남긴다(수가 어긋남은 DTO 가 닫는다)', async () => {
    const { client } = fakeClient(() => ({
      data: [{ id: 'a', status: 'CONFIRMED', created_at: '2026-10-21T05:00:00.000Z' }],
      error: null,
    }))

    const result = await readEvidenceRecords(client, WS, 'bookings', ['a', 'b'])

    expect(result.complete).toBe(true)
    expect(result.rows).toHaveLength(1)
  })
})

describe('readEvidenceRecords — 게시 확인 근거', () => {
  const verified = {
    id: 'r1',
    receipt_kind: 'observed_result',
    provider_reference: 'post-1',
    recorded_at: '2026-10-21T05:00:00.000Z',
    observed_payload: { verified: true, read_after_write: true, published_post_id: 'post-1', channel: 'instagram' },
  }

  it('readback 조건을 만족하면 PUBLISH_VERIFIED 이고 채널 표시명을 쓴다', async () => {
    const { client } = fakeClient(() => ({ data: [verified], error: null }))

    const result = await readEvidenceRecords(client, WS, 'published', ['r1'])

    expect(result.rows?.[0].kind).toBe('PUBLISH_VERIFIED')
    expect(result.rows?.[0].subject).toBe('인스타그램 게시물')
  })

  it('readback 조건이 빠지면 PUBLISH_PENDING 이다 — 확인으로 묶지 않는다', async () => {
    const { client } = fakeClient(() => ({
      data: [{ ...verified, observed_payload: { ...verified.observed_payload, read_after_write: false } }],
      error: null,
    }))

    const result = await readEvidenceRecords(client, WS, 'published', ['r1'])

    expect(result.rows?.[0].kind).toBe('PUBLISH_PENDING')
  })

  it('reads publish_attempts and confirmed permalink tracking when receipt is absent', async () => {
    const attemptId = '40000000-0000-4000-8000-000000000001'
    const scheduleId = '50000000-0000-4000-8000-000000000001'
    const { client } = fakeClient((table) => {
      if (table === 'external_action_receipts') return { data: [], error: null }
      if (table === 'publish_attempts') {
        return {
          data: [
            {
              id: attemptId,
              workspace_id: WS,
              schedule_id: scheduleId,
              status: 'succeeded',
              error_code: null,
              provider_request_id: 'req-1',
              provider_reference: 'post-99',
              finished_at: '2026-10-14T10:02:12Z',
            },
          ],
          error: null,
        }
      }
      if (table === 'schedules') {
        return {
          data: [{ id: scheduleId, workspace_id: WS, channel_connection_id: 'conn-1' }],
          error: null,
        }
      }
      if (table === 'channel_connections') {
        return {
          data: [{ id: 'conn-1', workspace_id: WS, channel: 'instagram' }],
          error: null,
        }
      }
      if (table === 'social_post_tracking') {
        return {
          data: [
            {
              id: 'track-1',
              workspace_id: WS,
              publish_attempt_id: attemptId,
              destination_url: 'https://www.instagram.com/p/DA123',
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await readEvidenceRecords(client, WS, 'published', [attemptId])

    expect(result.complete).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows?.[0].kind).toBe('PUBLISH_VERIFIED')
    expect(result.rows?.[0].subject).toBe('인스타그램 게시물')
    expect(result.rows?.[0].occurredAt).toBe('2026-10-14T10:02:12Z')
  })

  it('모르는 채널 키는 표시명을 지어내지 않는다(내부 키 노출 금지)', async () => {
    const { client } = fakeClient(() => ({
      data: [{ ...verified, observed_payload: { ...verified.observed_payload, channel: 'mystery_channel' } }],
      error: null,
    }))

    const result = await readEvidenceRecords(client, WS, 'published', ['r1'])

    expect(result.rows?.[0].kind).toBe('PUBLISH_VERIFIED')
    expect(result.rows?.[0].subject).toBeUndefined()
  })
})

describe('readEvidenceRecords — 원천이 없거나 읽지 못한 경우는 0건이 아니다', () => {
  it('고객 문의·예금은 원천 미연결이라 rows=null 이다(조회도 하지 않는다)', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }))

    for (const metric of ['inquiries', 'deposits'] as const) {
      const result = await readEvidenceRecords(client, WS, metric, ['a'])
      expect(result.rows).toBeNull()
      expect(result.complete).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it('클라이언트가 없으면 rows=null 이다', async () => {
    const result = await readEvidenceRecords(null, WS, 'bookings', ['a'])

    expect(result.rows).toBeNull()
    expect(result.complete).toBe(false)
  })

  it('사업장이 비면 읽지 않는다', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }))

    const result = await readEvidenceRecords(client, '  ', 'bookings', ['a'])

    expect(result.rows).toBeNull()
    expect(calls).toEqual([])
  })

  it('쿼리 오류는 부분 성공을 전부처럼 넘기지 않고 rows=null 로 닫는다', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'boom' } }))

    const result = await readEvidenceRecords(client, WS, 'bookings', ['a'])

    expect(result.rows).toBeNull()
    expect(result.complete).toBe(false)
  })

  it('예외가 던져져도 rows=null 이다', async () => {
    const client = {
      from() { throw new Error('network') },
    } as unknown as SupabaseClient

    const result = await readEvidenceRecords(client, WS, 'bookings', ['a'])

    expect(result.rows).toBeNull()
  })
})

describe('readEvidenceRecords — 조회 범위', () => {
  it('기록 id 가 없으면 0건이 확정된 빈 배열이다(근거 없음과 구분)', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }))

    const result = await readEvidenceRecords(client, WS, 'bookings', [])

    expect(result).toEqual({ rows: [], complete: true })
    expect(calls).toEqual([])
  })

  it('id 를 100개씩 나눠 읽고 중복 id 는 한 번만 묻는다', async () => {
    const { client, calls } = fakeClient((_table, ids) => ({
      data: ids.map(id => ({ id, status: 'CONFIRMED', created_at: '2026-10-21T05:00:00.000Z' })),
      error: null,
    }))
    const ids = [...Array.from({ length: 150 }, (_, i) => `id-${i}`), 'id-0', 'id-1']

    const result = await readEvidenceRecords(client, WS, 'bookings', ids)

    expect(calls.map(call => call.ids.length)).toEqual([100, 50])
    expect(result.rows).toHaveLength(150)
    expect(result.complete).toBe(true)
  })

  it('두 번째 청크가 실패하면 첫 청크도 버린다', async () => {
    const { client } = fakeClient((_table, ids) => (ids.length === 100
      ? { data: ids.map(id => ({ id, status: 'CONFIRMED', created_at: '2026-10-21T05:00:00.000Z' })), error: null }
      : { data: null, error: { message: 'boom' } }))

    const result = await readEvidenceRecords(client, WS, 'bookings', Array.from({ length: 101 }, (_, i) => `id-${i}`))

    expect(result.rows).toBeNull()
    expect(result.complete).toBe(false)
  })
})
