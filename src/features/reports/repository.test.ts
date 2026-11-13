import { describe, expect, it, vi } from 'vitest'
import {
  getCustomerConversation,
  getCustomerConversations,
  getReadinessSnapshot,
  getReportSnapshot,
  getSocialPerformanceReport,
  type OperationsOverviewGateway,
} from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'

function gateway(overrides: Partial<OperationsOverviewGateway> = {}): OperationsOverviewGateway {
  return {
    getLatestReport: vi.fn(async () => ({ data: null, error: null })),
    getCustomerConversations: vi.fn(async () => ({ data: [], error: null })),
    getCustomerConversation: vi.fn(async () => ({ data: null, error: null })),
    getBusinessProfile: vi.fn(async () => ({ data: null, error: null })),
    getBrandProfile: vi.fn(async () => ({ data: null, error: null })),
    getConnectedChannel: vi.fn(async () => ({ data: null, error: null })),
    getApprovedKnowledge: vi.fn(async () => ({ data: null, error: null })),
    getActiveAutomation: vi.fn(async () => ({ data: null, error: null })),
    getSocialPosts: vi.fn(async () => ({ data: [], error: null })),
    getSocialPostDestinations: vi.fn(async () => ({ data: [], error: null })),
    getSocialReactions: vi.fn(async () => ({ data: [], error: null })),
    ...overrides,
  }
}

describe('work-centered social performance report', () => {
  it('groups actual metrics and webhook reactions under the exact published version', async () => {
    const postAttemptId = '30000000-0000-4000-8000-000000000001'
    const result = await getSocialPerformanceReport(workspaceId, {
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-08T23:59:59.999Z',
      contentId: null,
    }, gateway({
      getSocialPosts: vi.fn(async () => ({ data: [{
        workspace_id: workspaceId,
        work_item_id: '31000000-0000-4000-8000-000000000001',
        work_title: '여름 관리 게시물',
        content_item_id: '32000000-0000-4000-8000-000000000001',
        content_version_id: '33000000-0000-4000-8000-000000000001',
        version_number: 3,
        channel: 'instagram',
        schedule_id: '34000000-0000-4000-8000-000000000001',
        scheduled_at: '2026-08-08T00:00:00.000Z',
        schedule_status: 'published',
        publish_attempt_id: postAttemptId,
        delivery_status: 'succeeded',
        provider_post_reference: 'ig-media-1',
        published_at: '2026-08-08T00:05:00.000Z',
        collection_id: '35000000-0000-4000-8000-000000000001',
        collection_status: 'succeeded',
        collection_period_start: '2026-08-01T00:00:00.000Z',
        collection_period_end: '2026-08-08T00:00:00.000Z',
        collected_at: '2026-08-08T01:00:00.000Z',
        metrics: [
          { metric: 'views', state: 'available', value: 0 },
          { metric: 'saved', state: 'no_data', value: null },
          { metric: 'visits', state: 'not_supported', value: null },
        ],
      }], error: null })),
      getSocialPostDestinations: vi.fn(async () => ({ data: [{
        publish_attempt_id: postAttemptId,
        destination_url: 'https://www.instagram.com/p/POST1/',
      }], error: null })),
      getSocialReactions: vi.fn(async () => ({ data: [{
        workspace_id: workspaceId,
        event_id: '36000000-0000-4000-8000-000000000001',
        provider: 'instagram',
        category: 'comment',
        occurred_at: '2026-08-08T02:00:00.000Z',
        inbound_text: '예약 가능한가요?',
        provider_post_reference: 'ig-media-1',
        publish_attempt_id: postAttemptId,
        content_item_id: '32000000-0000-4000-8000-000000000001',
        content_version_id: '33000000-0000-4000-8000-000000000001',
        work_item_id: '31000000-0000-4000-8000-000000000001',
      }, {
        workspace_id: workspaceId,
        event_id: '36000000-0000-4000-8000-000000000002',
        provider: 'instagram',
        category: 'dm',
        occurred_at: '2026-08-08T03:00:00.000Z',
        inbound_text: '가격을 알고 싶어요.',
        provider_post_reference: null,
        publish_attempt_id: null,
        content_item_id: null,
        content_version_id: null,
        work_item_id: null,
      }], error: null })),
    }))

    expect(result).toEqual({ data: {
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-08T23:59:59.999Z',
      posts: [expect.objectContaining({
        workTitle: '여름 관리 게시물',
        versionNumber: 3,
        providerPostReference: 'ig-media-1',
        destinationUrl: 'https://www.instagram.com/p/POST1/',
        metrics: [
          { metric: 'views', state: 'available', value: 0 },
          { metric: 'saved', state: 'no_data', value: null },
          { metric: 'visits', state: 'not_supported', value: null },
        ],
        reactions: [expect.objectContaining({ category: 'comment', text: '예약 가능한가요?' })],
      })],
      unlinkedReactions: [expect.objectContaining({ category: 'dm', text: '가격을 알고 싶어요.' })],
    } })
  })
})

describe('customer conversation reports', () => {
  it('maps privacy-minimized customer conversations without exposing the subject hash', async () => {
    const conversationId = '30000000-0000-4000-8000-000000000010'
    const result = await getCustomerConversations(
      workspaceId,
      gateway({
        getCustomerConversations: vi.fn(async () => ({
          data: [{
            id: conversationId,
            workspace_id: workspaceId,
            channel: 'instagram',
            display_label: '예약을 문의한 고객',
            status: 'needs_attention',
            intent: '시술 예약 문의',
            summary: '가격을 확인한 뒤 가능한 시간을 물어봤어요.',
            latest_message_at: '2026-08-10T02:30:00.000Z',
            inquiry_id: '30000000-0000-4000-8000-000000000011',
            booking_id: null,
            related_content_item_id: '30000000-0000-4000-8000-000000000012',
            requires_human_review: true,
          }],
          error: null,
        })),
      }),
    )

    expect(result).toEqual({
      data: [{
        id: conversationId,
        channel: 'instagram',
        displayLabel: '예약을 문의한 고객',
        status: 'needs_attention',
        intent: '시술 예약 문의',
        summary: '가격을 확인한 뒤 가능한 시간을 물어봤어요.',
        latestMessageAt: '2026-08-10T02:30:00.000Z',
        inquiryId: '30000000-0000-4000-8000-000000000011',
        bookingId: null,
        relatedContentItemId: '30000000-0000-4000-8000-000000000012',
        requiresHumanReview: true,
      }],
    })
    expect(JSON.stringify(result)).not.toContain('external_subject_reference_hash')
  })

  it('loads one selected conversation only inside the active workspace', async () => {
    const conversationId = '30000000-0000-4000-8000-000000000020'
    const result = await getCustomerConversation(
      workspaceId,
      conversationId,
      gateway({
        getCustomerConversation: vi.fn(async () => ({
          data: {
            id: conversationId,
            workspace_id: workspaceId,
            channel: 'naver_place',
            display_label: '예약 전환 고객',
            status: 'resolved',
            intent: '예약',
            summary: '상담 뒤 예약으로 연결된 대화예요.',
            latest_message_at: '2026-08-10T03:00:00.000Z',
            inquiry_id: null,
            booking_id: '30000000-0000-4000-8000-000000000021',
            related_content_item_id: null,
            requires_human_review: false,
          },
          error: null,
        })),
      }),
    )

    expect(result.data).toMatchObject({ id: conversationId, bookingId: expect.any(String) })
  })

  it('fails closed when a conversation row crosses a workspace boundary', async () => {
    const conversationId = '30000000-0000-4000-8000-000000000030'
    const result = await getCustomerConversation(
      workspaceId,
      conversationId,
      gateway({
        getCustomerConversation: vi.fn(async () => ({
          data: {
            id: conversationId,
            workspace_id: '20000000-0000-4000-8000-000000000099',
            channel: 'instagram',
            display_label: '다른 작업공간 고객',
            status: 'open',
            intent: null,
            summary: '표시되면 안 되는 자료',
            latest_message_at: null,
            inquiry_id: null,
            booking_id: null,
            related_content_item_id: null,
            requires_human_review: false,
          },
          error: null,
        })),
      }),
    )

    expect(result).toEqual({
      error: {
        message: '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        requestId: 'customer-conversation',
      },
    })
  })
})

describe('getReportSnapshot', () => {
  it('shows collection state without inventing zero metrics when no snapshot exists', async () => {
    const result = await getReportSnapshot(workspaceId, gateway())

    expect(result).toEqual({
      data: {
        periodStart: null,
        periodEnd: null,
        checkedAt: null,
        sampleState: 'collecting',
        message: '자료를 모으고 있어요. 아직 실제 0건으로 계산하지 않아요.',
        metrics: {
          visits: null,
          engagements: null,
          inquiries: null,
          reservations: null,
          observedPosts: null,
        },
      },
    })
  })

  it('preserves an observed actual zero with its check time and limited-sample warning', async () => {
    const checkedAt = '2026-08-09T03:00:00.000Z'
    const result = await getReportSnapshot(
      workspaceId,
      gateway({
        getLatestReport: vi.fn(async () => ({
          data: {
            id: '30000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            period_start: '2026-08-01',
            period_end: '2026-08-08',
            status: 'insufficient',
            metrics: {
              visits: 0,
              engagements: 0,
              inquiries: 0,
              reservations: 0,
              observed_posts: 0,
            },
            source_ready: true,
            checked_at: checkedAt,
          },
          error: null,
        })),
      }),
    )

    expect(result.data).toMatchObject({
      checkedAt,
      sampleState: 'limited',
      metrics: {
        visits: 0,
        engagements: 0,
        inquiries: 0,
        reservations: 0,
        observedPosts: 0,
      },
    })
  })

  it('fails closed when a returned row belongs to a different workspace', async () => {
    const result = await getReportSnapshot(
      workspaceId,
      gateway({
        getLatestReport: vi.fn(async () => ({
          data: {
            id: '30000000-0000-4000-8000-000000000001',
            workspace_id: '20000000-0000-4000-8000-000000000099',
            period_start: '2026-08-01',
            period_end: '2026-08-08',
            status: 'sufficient',
            metrics: {
              visits: 1,
              engagements: 1,
              inquiries: 1,
              reservations: 1,
              observed_posts: 1,
            },
            source_ready: true,
            checked_at: '2026-08-09T03:00:00.000Z',
          },
          error: null,
        })),
      }),
    )

    expect(result).toEqual({
      error: {
        message: '리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        requestId: 'report-snapshot',
      },
    })
  })
})

describe('getReadinessSnapshot', () => {
  it('waits for all six signals and calculates the percentage once from real rows', async () => {
    const result = await getReadinessSnapshot(
      workspaceId,
      'manager',
      gateway({
        getBusinessProfile: vi.fn(async () => ({ data: { workspace_id: workspaceId }, error: null })),
        getBrandProfile: vi.fn(async () => ({ data: { workspace_id: workspaceId }, error: null })),
        getConnectedChannel: vi.fn(async () => ({ data: { workspace_id: workspaceId }, error: null })),
        getApprovedKnowledge: vi.fn(async () => ({ data: null, error: null })),
        getActiveAutomation: vi.fn(async () => ({ data: { workspace_id: workspaceId }, error: null })),
      }),
    )

    expect(result).toEqual({
      data: {
        input: {
          business: true,
          brand: true,
          channel: true,
          knowledge: false,
          automation: true,
          permissions: true,
        },
        percentage: 83,
      },
    })
  })

  it('returns an error without a partial percentage when any signal query fails', async () => {
    const result = await getReadinessSnapshot(
      workspaceId,
      'owner',
      gateway({
        getBrandProfile: vi.fn(async () => ({ data: null, error: new Error('PRIVATE_DB_DETAIL') })),
      }),
    )

    expect(result).toEqual({
      error: {
        message: '준비 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        requestId: 'account-readiness',
      },
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DB_DETAIL')
  })
})
