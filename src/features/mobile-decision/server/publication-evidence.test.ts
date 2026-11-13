import { describe, expect, it } from 'vitest'
import { resolvePublicationEvidence } from './publication-evidence'
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

function database(tables: Record<string, Row[]>, broken?: string): SupabaseClient {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      const chain: any = {
        select() { return chain },
        eq(key: string, value: unknown) { rows = rows.filter(r => r[key] === value); return chain },
        in(key: string, values: unknown[]) { rows = rows.filter(r => values.includes(r[key])); return chain },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(
            resolve({
              data: table === broken ? null : rows,
              error: table === broken ? { message: 'DB_ERROR' } : null,
            }),
          )
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('resolvePublicationEvidence (공통 게시 확인 정본 검증)', () => {
  const ws = 'workspace-1'
  const contentId = 'content-1'
  const scheduleId = 'schedule-1'
  const versionId = 'v1'

  it('올바른 verified readback 영수증이 있을 때 게시 확인으로 인정한다', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-100',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(true)
    expect(result.get(contentId)).toMatchObject({
      receiptId: 'receipt-1',
      providerReference: 'post-100',
      channel: 'instagram',
    })
  })

  it('동일한 v2 버전의 스케줄 영수증은 정상 승인한다', async () => {
    const v2 = 'version-2'
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: v2 }],
      external_action_receipts: [
        {
          id: 'receipt-2',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-200',
          recorded_at: '2026-11-10T01:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-200',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: v2 },
    ])

    expect(result.has(contentId)).toBe(true)
    expect(result.get(contentId)?.providerReference).toBe('post-200')
  })

  it('과거 v1 영수증이 있어도 현재 원고 버전이 v2로 변경되었으면 거부한다', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: 'version-1' }],
      external_action_receipts: [
        {
          id: 'receipt-old',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-old',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-old',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: 'version-2' },
    ])

    expect(result.has(contentId)).toBe(false)
  })

  it('원고의 currentVersionId가 누락된 경우 미검증으로 거부한다', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: 'version-1' }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-100',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: null },
    ])

    expect(result.has(contentId)).toBe(false)
  })

  it('영수증의 채널이 콘텐츠의 채널과 불일치하면 거부한다 (타 채널 영수증 오인 방지)', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'threads', // 콘텐츠는 instagram인데 영수증은 threads
            published_post_id: 'post-100',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(false)
  })

  it('콘텐츠의 채널이 누락(missing/unknown)된 경우에도 fail-closed로 거부한다', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-100',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: null, status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(false)
  })

  it('candidate.scope 밖의 schedule.content_id는 매핑하지 않고 불허한다', async () => {
    const outsideContentId = 'outside-content-99'
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: outsideContentId, version_id: versionId }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-100',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(false)
    expect(result.has(outsideContentId)).toBe(false)
  })

  it('타 매장(workspace)의 영수증은 인정하지 않는다', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: 'other-workspace',
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-100',
            verified: true,
            read_after_write: true,
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(false)
  })

  it('read_after_write가 false이거나 미검증이면 거부한다', async () => {
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
      external_action_receipts: [
        {
          id: 'receipt-1',
          workspace_id: ws,
          schedule_id: scheduleId,
          receipt_kind: 'observed_result',
          provider_reference: 'post-100',
          recorded_at: '2026-11-10T00:00:00Z',
          observed_payload: {
            channel: 'instagram',
            published_post_id: 'post-100',
            verified: true,
            read_after_write: false, // readback 미검증
          },
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(false)
  })

  it('영수증과 레거시 시도 모두 증거가 없거나 영수증 쿼리 실패 시 에러를 던지지 않고 미확인(빈 Map)으로 반환하여 전체 조회를 보호한다', async () => {
    const db = database(
      { schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }] },
      'external_action_receipts',
    )

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(false)
    expect(result.size).toBe(0)
  })

  it('external_action_receipts 쿼리가 실패해도 유효한 publish_attempts + tracking 증거가 있으면 독립 원천 성공으로 승인한다', async () => {
    const attemptId = 'attempt-fallback-1'
    const db = database(
      {
        schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
        publish_attempts: [
          {
            id: attemptId,
            workspace_id: ws,
            schedule_id: scheduleId,
            status: 'succeeded',
            error_code: null,
            provider_request_id: 'req-live',
            provider_reference: 'post-live-ig',
            finished_at: '2026-11-10T12:00:00Z',
          },
        ],
        social_post_tracking: [
          {
            id: 'track-live',
            workspace_id: ws,
            publish_attempt_id: attemptId,
            destination_url: 'https://www.instagram.com/p/DfjpR8GkveI/',
          },
        ],
      },
      'external_action_receipts', // receipts 쿼리 고의 실패
    )

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(true)
    expect(result.get(contentId)).toMatchObject({
      receiptId: attemptId,
      source: 'publish_attempts.permalink_readback',
      channel: 'instagram',
    })
  })

  it('publish_attempts 쿼리가 실패해도 이미 external_action_receipts 가 확인되었으면 정상 승인한다', async () => {
    const db = database(
      {
        schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
        external_action_receipts: [
          {
            id: 'receipt-1',
            workspace_id: ws,
            schedule_id: scheduleId,
            receipt_kind: 'observed_result',
            provider_reference: 'post-100',
            recorded_at: '2026-11-10T00:00:00Z',
            observed_payload: {
              channel: 'instagram',
              published_post_id: 'post-100',
              verified: true,
              read_after_write: true,
            },
          },
        ],
      },
      'publish_attempts', // attempts 쿼리 실패
    )

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(true)
    expect(result.get(contentId)?.source).toBe('external_action_receipts.recorded_at/independent_publish_readback')
  })

  it('external_action_receipts가 없어도 실제 writer의 publish_attempts + tracking permalink가 정합하면 게시 확인으로 인정한다', async () => {
    const attemptId = 'attempt-live-8add'
    const db = database({
      schedules: [{ id: scheduleId, workspace_id: ws, content_id: contentId, version_id: versionId }],
      publish_attempts: [
        {
          id: attemptId,
          workspace_id: ws,
          schedule_id: scheduleId,
          status: 'succeeded',
          error_code: null,
          provider_request_id: 'req-live',
          provider_reference: 'post-live-ig',
          finished_at: '2026-11-10T12:00:00Z',
        },
      ],
      social_post_tracking: [
        {
          id: 'track-live',
          workspace_id: ws,
          publish_attempt_id: attemptId,
          destination_url: 'https://www.instagram.com/p/DfjpR8GkveI/',
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: contentId, channel: 'instagram', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(contentId)).toBe(true)
    expect(result.get(contentId)).toMatchObject({
      receiptId: attemptId,
      providerReference: 'post-live-ig',
      observedAt: '2026-11-10T12:00:00Z',
      channel: 'instagram',
      source: 'publish_attempts.permalink_readback',
      permalink: 'https://www.instagram.com/p/DfjpR8GkveI/',
    })
  })

  it('Threads 채널의 publish_attempts + tracking permalink도 정상 승인한다', async () => {
    const threadsAttemptId = 'attempt-live-threads'
    const threadsContentId = 'content-threads'
    const threadsScheduleId = 'schedule-threads'
    const db = database({
      schedules: [{ id: threadsScheduleId, workspace_id: ws, content_id: threadsContentId, version_id: versionId }],
      publish_attempts: [
        {
          id: threadsAttemptId,
          workspace_id: ws,
          schedule_id: threadsScheduleId,
          status: 'succeeded',
          error_code: null,
          provider_request_id: 'req-threads',
          provider_reference: 'post-threads-id',
          finished_at: '2026-11-10T12:05:00Z',
        },
      ],
      social_post_tracking: [
        {
          id: 'track-threads',
          workspace_id: ws,
          publish_attempt_id: threadsAttemptId,
          destination_url: 'https://www.threads.com/@sohee.ai/post/DfjpoJ0k2hA',
        },
      ],
    })

    const result = await resolvePublicationEvidence(db, ws, [
      { id: threadsContentId, channel: 'threads', status: 'published', currentVersionId: versionId },
    ])

    expect(result.has(threadsContentId)).toBe(true)
    expect(result.get(threadsContentId)).toMatchObject({
      receiptId: threadsAttemptId,
      source: 'publish_attempts.permalink_readback',
      channel: 'threads',
      permalink: 'https://www.threads.com/@sohee.ai/post/DfjpoJ0k2hA',
    })
  })
})
