import { describe, expect, it, vi } from 'vitest'
import { getScheduleBoard, type ScheduleGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const approvedContentId = '40000000-0000-4000-8000-000000000001'
const approvedVersionId = '50000000-0000-4000-8000-000000000001'

function gateway(overrides: Partial<ScheduleGateway> = {}): ScheduleGateway {
  return {
    listApprovals: vi.fn(async () => ({ data: [], error: null })),
    listItems: vi.fn(async () => ({ data: [], error: null })),
    listVersions: vi.fn(async () => ({ data: [], error: null })),
    listConnections: vi.fn(async () => ({ data: [], error: null })),
    listSchedules: vi.fn(async () => ({ data: [], error: null })),
    listAttempts: vi.fn(async () => ({ data: [], error: null })),
    listTracking: vi.fn(async () => ({ data: [], error: null })),
    listCustomerReservations: vi.fn(async () => ({ data: [], error: null })),
    listLocalPublishes: vi.fn(async () => ({ data: [], error: null })),
    listConversationJobs: vi.fn(async () => ({ data: [], error: null })),
    ...overrides,
  }
}

describe('getScheduleBoard', () => {
  it('projects approved work, future posting plans, exact scheduled versions, and customer booking links', async () => {
    const scheduleId = '70000000-0000-4000-8000-000000000001'
    const draftContentId = '40000000-0000-4000-8000-000000000002'
    const draftVersionId = '50000000-0000-4000-8000-000000000002'
    const source = gateway({
      listApprovals: vi.fn(async () => ({
        data: [{
          id: '30000000-0000-4000-8000-000000000001',
          content_id: approvedContentId,
          version_id: approvedVersionId,
          decided_at: '2026-08-09T05:00:00Z',
        }],
        error: null,
      })),
      listItems: vi.fn(async () => ({
        data: [
          { id: approvedContentId, title: '승인 콘텐츠', channel: 'instagram', status: 'approved', current_version_id: approvedVersionId },
          { id: draftContentId, title: '다음 주 관리 안내', channel: 'threads', status: 'draft', current_version_id: draftVersionId },
        ],
        error: null,
      })),
      listVersions: vi.fn(async () => ({
        data: [
          {
            id: approvedVersionId, content_id: approvedContentId, version_number: 3,
            naver_visibility: 'public',
          },
          { id: draftVersionId, content_id: draftContentId, version_number: 1, naver_visibility: null },
        ],
        error: null,
      })),
      listConnections: vi.fn(async () => ({
        data: [{ id: '60000000-0000-4000-8000-000000000001', channel: 'instagram', status: 'connected', account_label: '검증 계정' }],
        error: null,
      })),
      listSchedules: vi.fn(async () => ({
        data: [{
          id: scheduleId,
          content_id: approvedContentId,
          version_id: approvedVersionId,
          publish_at: '2026-08-14T06:00:00.000Z',
          timezone: 'Asia/Seoul',
          status: 'scheduled',
          channel_connection_id: '60000000-0000-4000-8000-000000000001',
          updated_at: '2026-08-09T05:30:00.000Z',
        }],
        error: null,
      })),
      listCustomerReservations: vi.fn(async () => ({
        data: [{
          id: '90000000-0000-4000-8000-000000000001',
          channel: 'instagram',
          display_label: '예약을 확정한 고객',
          status: 'waiting_customer',
          intent: '잔흔 상담 예약',
          latest_message_at: '2026-08-13T08:00:00.000Z',
          booking_id: '91000000-0000-4000-8000-000000000001',
          booking_starts_at: '2026-08-14T08:00:00.000Z',
          booking_timezone: 'Asia/Seoul',
        }],
        error: null,
      })),
      listLocalPublishes: vi.fn(async () => ({ data: [{
        id: '92000000-0000-4000-8000-000000000001',
        status: 'reconfirmation_required',
        channel: 'naver_blog',
        target_label: 'findk3 테스트 블로그',
        content_version_id: approvedVersionId,
        scheduled_at: '2026-08-14T06:00:00.000Z',
        auto_execute_until: '2026-08-14T06:30:00.000Z',
        failure_code: 'DEADLINE_EXPIRED',
        exact_payload: { visibility: 'private' },
        result_url: 'https://blog.naver.com/testowner/123456789012',
        current_phase: 'editor_ready',
      }], error: null })),
      listConversationJobs: vi.fn(async () => ({ data: [{
        id: '93000000-0000-4000-8000-000000000001',
        thread_id: '94000000-0000-4000-8000-000000000001',
        kind: 'publish_preparation',
        status: 'running',
        queued_at: '2026-08-14T05:40:00.000Z',
        started_at: '2026-08-14T05:41:00.000Z',
        completed_at: null,
        safe_error_code: null,
      }], error: null })),
    })

    const result = await getScheduleBoard(workspaceId, source)

    expect(result.data?.ready[0]).toMatchObject({ title: '승인 콘텐츠', versionNumber: 3 })
    expect(result.data?.ready[0].connections).toHaveLength(1)
    expect(result.data?.plans).toContainEqual(expect.objectContaining({
      contentId: draftContentId,
      title: '다음 주 관리 안내',
      channel: 'threads',
      status: 'draft',
      versionNumber: 1,
    }))
    expect(result.data?.schedules[0]).toMatchObject({
      id: scheduleId,
      title: '승인 콘텐츠',
      channel: 'instagram',
      versionNumber: 3,
    })
    expect(result.data?.customerReservations[0]).toMatchObject({
      displayLabel: '예약을 확정한 고객',
      bookingId: '91000000-0000-4000-8000-000000000001',
      timingState: 'connected',
      startsAt: '2026-08-14T08:00:00.000Z',
    })
    expect(result.data?.source).toBe('actual')
    expect(result.data?.internalTasks[0]).toMatchObject({
      title: '게시할 내용을 준비하고 있어요',
      state: 'preparing',
      conversationThreadId: '94000000-0000-4000-8000-000000000001',
    })
    expect(result.data?.partialData).toBe(false)
    expect(result.data?.localPublishes[0]).toMatchObject({
      status: 'reconfirmation_required',
      targetLabel: 'findk3 테스트 블로그',
      visibility: 'public',
      resultUrl: 'https://blog.naver.com/testowner/123456789012',
      phase: 'editor_ready',
    })
  })

  it('preserves mutual-neighbor visibility from the approved version', async () => {
    const source = gateway({
      listVersions: vi.fn(async () => ({ data: [{
        id: approvedVersionId, content_id: approvedContentId, version_number: 1, naver_visibility: 'mutual_neighbor',
      }], error: null })),
      listLocalPublishes: vi.fn(async () => ({ data: [{
        id: '92000000-0000-4000-8000-000000000001', status: 'failed', channel: 'naver_blog',
        target_label: '블로그', content_version_id: approvedVersionId,
        scheduled_at: null, auto_execute_until: null, failure_code: 'CATEGORY_NOT_FOUND',
        exact_payload: { visibility: 'private' },
      }], error: null })),
    })
    const result = await getScheduleBoard(workspaceId, source)
    expect(result.data?.localPublishes[0]?.visibility).toBe('mutual_neighbor')
  })

  it('keeps available schedule data when an optional source fails', async () => {
    const source = gateway({
      listSchedules: vi.fn(async () => ({ data: [], error: null })),
      listCustomerReservations: vi.fn(async () => ({ data: null, error: new Error('temporary') })),
      listConversationJobs: vi.fn(async () => ({ data: null, error: new Error('temporary') })),
    })

    const result = await getScheduleBoard(workspaceId, source)

    expect(result.error).toBeUndefined()
    expect(result.data?.partialData).toBe(true)
    expect(result.data?.unavailableSources).toEqual(['customer_reservations', 'internal_tasks'])
    expect(result.data?.schedules).toEqual([])
  })

  it('preserves the latest real provider reference and completion time for a schedule', async () => {
    const scheduleId = '70000000-0000-4000-8000-000000000001'
    const source = gateway({
      listAttempts: vi.fn(async () => ({ data: [{
        id: '80000000-0000-4000-8000-000000000001', schedule_id: scheduleId, attempt_number: 1,
        status: 'succeeded', provider_reference: 'ig-post-123', error_code: null,
        started_at: '2026-08-10T09:00:00.000Z', finished_at: '2026-08-10T09:02:00.000Z',
      }], error: null })),
      listTracking: vi.fn(async () => ({ data: [{
        publish_attempt_id: '80000000-0000-4000-8000-000000000001',
        destination_url: 'https://www.instagram.com/p/POST1/',
      }], error: null })),
    })
    const result = await getScheduleBoard(workspaceId, source)
    expect(result.data?.attempts[scheduleId]).toMatchObject({
      provider_reference: 'ig-post-123',
      destination_url: 'https://www.instagram.com/p/POST1/',
      finished_at: '2026-08-10T09:02:00.000Z',
    })
  })
})
