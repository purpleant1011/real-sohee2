import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))

import { readPublishIntentState } from './publish-intent-state'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const contentId = '30000000-0000-4000-8000-000000000001'
const versionId = '40000000-0000-4000-8000-000000000001'
const scheduleId = '70000000-0000-4000-8000-000000000001'
const olderScheduleId = '70000000-0000-4000-8000-000000000002'
const approvalId = '60000000-0000-4000-8000-000000000001'
const attemptId = '80000000-0000-4000-8000-000000000001'

function client(
  schedules: { data: unknown; error: unknown },
  attempts: { data: unknown; error: unknown } = { data: [], error: null },
  tracking: { data: unknown; error: unknown } = { data: [], error: null },
) {
  const eqs: [string, unknown][] = []
  const ins: [string, unknown][] = []
  function query(table: string) {
    const result = table === 'schedules' ? schedules
      : table === 'publish_attempts' ? attempts
        : tracking
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        eqs.push([column, value])
        return builder
      },
      in: (column: string, value: unknown) => {
        ins.push([column, value])
        return builder
      },
      order: () => builder,
      limit: () => Promise.resolve(result),
    }
    return builder
  }
  return {
    db: { from: (table: string) => query(table) } as unknown as SupabaseClient,
    eqs,
    ins,
  }
}

const input = { workspaceId, contentId, versionId }
const attempt = (overrides: Record<string, unknown>) => ({
  schedule_id: scheduleId,
  id: attemptId,
  status: 'succeeded',
  provider_reference: 'post-1',
  error_code: null,
  ...overrides,
})

describe('발행 실행 상태 판정 (ANI-1680 M07)', () => {
  it('예약 기록이 없으면 새 실행을 만들어도 된다', async () => {
    await expect(readPublishIntentState(client({ data: [], error: null }).db, input))
      .resolves.toEqual({ kind: 'none' })
  })

  it('취소된 예약만 있으면 실행 기록으로 보지 않는다', async () => {
    const { db } = client({
      data: [{ id: scheduleId, approval_id: approvalId, status: 'cancelled' }],
      error: null,
    })
    await expect(readPublishIntentState(db, input)).resolves.toEqual({ kind: 'none' })
  })

  it('정확한 작업공간·원고·버전의 예약 이력을 읽는다', async () => {
    const { db, eqs, ins } = client({
      data: [{ id: scheduleId, approval_id: approvalId, status: 'scheduled' }],
      error: null,
    })
    await readPublishIntentState(db, input)
    // 예약 조회에 건 필터(작업공간·원고·버전)만 확인한다.
    expect(eqs.slice(0, 3)).toEqual([
      ['workspace_id', workspaceId],
      ['content_id', contentId],
      ['version_id', versionId],
    ])
    expect(ins).toEqual([['schedule_id', [scheduleId]]])
  })

  it('이미 게시된 기록은 공급자 게시 식별자까지 돌려준다', async () => {
    const { db } = client(
      { data: [{ id: scheduleId, approval_id: approvalId, status: 'published' }], error: null },
      { data: [attempt({})], error: null },
    )
    await expect(readPublishIntentState(db, input)).resolves.toEqual({
      kind: 'published',
      approvalId,
      scheduleId,
      attemptId,
      providerPostId: 'post-1',
      readbackUrl: null,
    })
  })

  it('게시물 주소의 독립 readback 은 공급자 수락과 따로 표시한다', async () => {
    const { db } = client(
      { data: [{ id: scheduleId, approval_id: approvalId, status: 'published' }], error: null },
      { data: [attempt({})], error: null },
      { data: [{ publish_attempt_id: attemptId, destination_url: 'https://www.instagram.com/p/abc' }], error: null },
    )
    await expect(readPublishIntentState(db, input)).resolves.toMatchObject({
      kind: 'published',
      providerPostId: 'post-1',
      readbackUrl: 'https://www.instagram.com/p/abc',
    })
  })

  it('진행 중인 실행은 중복 실행으로 보지 않고 진행 중으로 알린다', async () => {
    const { db } = client(
      { data: [{ id: scheduleId, approval_id: approvalId, status: 'publishing' }], error: null },
      { data: [attempt({ status: 'pending', provider_reference: null })], error: null },
    )
    await expect(readPublishIntentState(db, input)).resolves.toEqual({
      kind: 'in_flight',
      approvalId,
      scheduleId,
      attemptId,
    })
  })

  it('결과가 불확실한 실행은 성공이 아니라 unknown 이다', async () => {
    const { db } = client(
      { data: [{ id: scheduleId, approval_id: approvalId, status: 'unknown' }], error: null },
      { data: [attempt({ status: 'unknown', provider_reference: null, error_code: 'RESULT_UNKNOWN' })], error: null },
    )
    await expect(readPublishIntentState(db, input)).resolves.toEqual({
      kind: 'unknown',
      approvalId,
      scheduleId,
      attemptId,
      errorCode: 'RESULT_UNKNOWN',
    })
  })

  it('실행 기록 없이 published 로만 표시된 예약은 성공으로 보지 않는다', async () => {
    const { db } = client(
      { data: [{ id: scheduleId, approval_id: approvalId, status: 'published' }], error: null },
      { data: [], error: null },
    )
    await expect(readPublishIntentState(db, input)).resolves.toEqual({
      kind: 'unknown',
      approvalId,
      scheduleId,
      attemptId: null,
      errorCode: null,
    })
  })

  it('최신 예약이 취소여도 과거 게시 성공 증거를 숨기지 않는다', async () => {
    const { db } = client(
      {
        data: [
          { id: scheduleId, approval_id: approvalId, status: 'cancelled' },
          { id: olderScheduleId, approval_id: approvalId, status: 'published' },
        ],
        error: null,
      },
      { data: [attempt({ schedule_id: olderScheduleId })], error: null },
    )
    await expect(readPublishIntentState(db, input)).resolves.toEqual({
      kind: 'published',
      approvalId,
      scheduleId: olderScheduleId,
      attemptId,
      providerPostId: 'post-1',
      readbackUrl: null,
    })
  })

  it('최신 예약이 scheduled 여도 과거 게시 성공 증거가 있으면 다시 예약하지 않는다', async () => {
    const { db } = client(
      {
        data: [
          { id: scheduleId, approval_id: approvalId, status: 'scheduled' },
          { id: olderScheduleId, approval_id: approvalId, status: 'published' },
        ],
        error: null,
      },
      { data: [attempt({ schedule_id: olderScheduleId })], error: null },
    )
    const state = await readPublishIntentState(db, input)
    expect(state).toMatchObject({ kind: 'published', scheduleId: olderScheduleId })
  })

  it('최신 예약이 scheduled 여도 과거 불확실 증거가 있으면 unknown 이다', async () => {
    const { db } = client(
      {
        data: [
          { id: scheduleId, approval_id: approvalId, status: 'scheduled' },
          { id: olderScheduleId, approval_id: approvalId, status: 'unknown' },
        ],
        error: null,
      },
      { data: [attempt({ schedule_id: olderScheduleId, status: 'unknown', provider_reference: null, error_code: 'RESULT_UNKNOWN' })], error: null },
    )
    const state = await readPublishIntentState(db, input)
    expect(state).toMatchObject({ kind: 'unknown', scheduleId: olderScheduleId, errorCode: 'RESULT_UNKNOWN' })
  })

  it('예약 이력이 상한을 넘어 잘렸을 수 있으면 성공 판정 대신 차단한다', async () => {
    // 201건(상한 200 + 초과 확인용 1건)이 오면 과거 성공 증거가 잘렸을 수 있다.
    const rows = Array.from({ length: 201 }, (_, index) => ({
      id: `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      approval_id: approvalId,
      status: 'scheduled',
    }))
    await expect(readPublishIntentState(client({ data: rows, error: null }).db, input))
      .resolves.toEqual({ kind: 'unreadable' })
  })

  it('실행 기록이 상한을 넘어 잘렸을 수 있으면 성공 판정 대신 차단한다', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      schedule_id: scheduleId,
      id: `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      status: 'failed',
      provider_reference: null,
      error_code: 'PROVIDER_REJECTED',
    }))
    await expect(readPublishIntentState(
      client(
        { data: [{ id: scheduleId, approval_id: approvalId, status: 'scheduled' }], error: null },
        { data: rows, error: null },
      ).db,
      input,
    )).resolves.toEqual({ kind: 'unreadable' })
  })

  it('조회 오류나 해석 불가는 통과가 아니라 차단(unreadable)이다', async () => {
    await expect(readPublishIntentState(client({ data: null, error: { message: 'timeout' } }).db, input))
      .resolves.toEqual({ kind: 'unreadable' })
    await expect(readPublishIntentState(client({ data: [{ id: 'not-a-uuid' }], error: null }).db, input))
      .resolves.toEqual({ kind: 'unreadable' })
    await expect(readPublishIntentState(
      client(
        { data: [{ id: scheduleId, approval_id: approvalId, status: 'scheduled' }], error: null },
        { data: null, error: { message: 'timeout' } },
      ).db,
      input,
    )).resolves.toEqual({ kind: 'unreadable' })
  })
})
