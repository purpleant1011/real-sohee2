import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

import { loadWorkStudioContext } from './work-studio-data'

type QueryResponse = { data: unknown; error: unknown }

function createMockSupabase(handlers: Record<string, () => QueryResponse>) {
  return {
    from: (table: string) => {
      const getResult = () => {
        const handler = handlers[table]
        return handler ? handler() : { data: [], error: null }
      }
      const chain: Record<string, unknown> = {
        then: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => {
          return Promise.resolve(getResult()).then(onfulfilled, onrejected)
        },
      }
      chain.select = vi.fn().mockImplementation(() => chain)
      chain.eq = vi.fn().mockImplementation(() => chain)
      chain.in = vi.fn().mockImplementation(() => chain)
      chain.order = vi.fn().mockImplementation(() => chain)
      chain.limit = vi.fn().mockImplementation(() => Promise.resolve(getResult()))
      chain.not = vi.fn().mockImplementation(() => chain)
      chain.maybeSingle = vi.fn().mockImplementation(() => {
        const handler = handlers[table]
        return Promise.resolve(handler ? handler() : { data: null, error: null })
      })
      return chain
    },
  }
}

describe('loadWorkStudioContext (mobile-work)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('receipt가 있을 때 receipt URL을 livePost로 반환한다', async () => {
    const mockDb = createMockSupabase({
      conversation_artifacts: () => ({ data: [], error: null }),
      schedules: () => ({ data: [{ id: 'sched-1' }], error: null }),
      external_action_receipts: () => ({
        data: [{
          verified: true,
          verified_at: '2026-11-04T10:00:00Z',
          result_url: 'https://instagram.com/p/from-receipt/',
          external_url: null,
          provider_post_url: null,
        }],
        error: null,
      }),
      publish_attempts: () => ({
        data: [{
          id: 'attempt-1',
          status: 'succeeded',
          provider_reference: 'ig-123',
          finished_at: '2026-11-04T11:00:00Z',
        }],
        error: null,
      }),
      social_post_tracking: () => ({
        data: [{
          publish_attempt_id: 'attempt-1',
          destination_url: 'https://instagram.com/p/from-attempt/',
        }],
        error: null,
      }),
      content_items: () => ({ data: { channel: 'instagram' }, error: null }),
      channel_connections: () => ({ data: [{ status: 'connected' }], error: null }),
    })
    mocks.createServerSupabaseClient.mockResolvedValue(mockDb as never)

    const ctx = await loadWorkStudioContext('ws-1', 'content-1')
    expect(ctx.livePost).toEqual({
      url: 'https://instagram.com/p/from-receipt/',
      verifiedAt: '2026-11-04T10:00:00Z',
    })
  })

  it('receipt가 없고 attempt 성공 destination_url이 있으면 fallback으로 반환한다', async () => {
    const mockDb = createMockSupabase({
      conversation_artifacts: () => ({ data: [], error: null }),
      schedules: () => ({ data: [{ id: 'sched-1' }], error: null }),
      external_action_receipts: () => ({ data: [], error: null }),
      publish_attempts: () => ({
        data: [{
          id: 'attempt-1',
          status: 'succeeded',
          provider_reference: 'ig-123',
          finished_at: '2026-11-04T11:00:00Z',
        }],
        error: null,
      }),
      social_post_tracking: () => ({
        data: [{
          publish_attempt_id: 'attempt-1',
          destination_url: 'https://instagram.com/p/fallback-url/',
        }],
        error: null,
      }),
      content_items: () => ({ data: { channel: 'instagram' }, error: null }),
      channel_connections: () => ({ data: [{ status: 'connected' }], error: null }),
    })
    mocks.createServerSupabaseClient.mockResolvedValue(mockDb as never)

    const ctx = await loadWorkStudioContext('ws-1', 'content-1')
    expect(ctx.livePost).toEqual({
      url: 'https://instagram.com/p/fallback-url/',
      verifiedAt: '2026-11-04T11:00:00Z',
    })
  })

  it('둘 다 없으면 livePost는 null이다', async () => {
    const mockDb = createMockSupabase({
      conversation_artifacts: () => ({ data: [], error: null }),
      schedules: () => ({ data: [{ id: 'sched-1' }], error: null }),
      external_action_receipts: () => ({ data: [], error: null }),
      publish_attempts: () => ({ data: [], error: null }),
      social_post_tracking: () => ({ data: [], error: null }),
      content_items: () => ({ data: { channel: 'instagram' }, error: null }),
      channel_connections: () => ({ data: [{ status: 'connected' }], error: null }),
    })
    mocks.createServerSupabaseClient.mockResolvedValue(mockDb as never)

    const ctx = await loadWorkStudioContext('ws-1', 'content-1')
    expect(ctx.livePost).toBeNull()
  })

  it('attempt destination_url이 비정상(http 등)이면 livePost는 null이다', async () => {
    const mockDb = createMockSupabase({
      conversation_artifacts: () => ({ data: [], error: null }),
      schedules: () => ({ data: [{ id: 'sched-1' }], error: null }),
      external_action_receipts: () => ({ data: [], error: null }),
      publish_attempts: () => ({
        data: [{
          id: 'attempt-1',
          status: 'succeeded',
          provider_reference: 'ig-123',
          finished_at: '2026-11-04T11:00:00Z',
        }],
        error: null,
      }),
      social_post_tracking: () => ({
        data: [{
          publish_attempt_id: 'attempt-1',
          destination_url: 'http://insecure-url.com/p/test',
        }],
        error: null,
      }),
      content_items: () => ({ data: { channel: 'instagram' }, error: null }),
      channel_connections: () => ({ data: [{ status: 'connected' }], error: null }),
    })
    mocks.createServerSupabaseClient.mockResolvedValue(mockDb as never)

    const ctx = await loadWorkStudioContext('ws-1', 'content-1')
    expect(ctx.livePost).toBeNull()
  })

  it('receipts 조회에 에러가 발생하면 attempt fallback으로 성공으로 둔갑하지 않고 livePost는 null이다', async () => {
    const mockDb = createMockSupabase({
      conversation_artifacts: () => ({ data: [], error: null }),
      schedules: () => ({ data: [{ id: 'sched-1' }], error: null }),
      external_action_receipts: () => ({ data: null, error: new Error('DB_TIMEOUT') }),
      publish_attempts: () => ({
        data: [{
          id: 'attempt-1',
          status: 'succeeded',
          provider_reference: 'ig-123',
          finished_at: '2026-11-04T11:00:00Z',
        }],
        error: null,
      }),
      social_post_tracking: () => ({
        data: [{
          publish_attempt_id: 'attempt-1',
          destination_url: 'https://instagram.com/p/fallback-url/',
        }],
        error: null,
      }),
      content_items: () => ({ data: { channel: 'instagram' }, error: null }),
      channel_connections: () => ({ data: [{ status: 'connected' }], error: null }),
    })
    mocks.createServerSupabaseClient.mockResolvedValue(mockDb as never)

    const ctx = await loadWorkStudioContext('ws-1', 'content-1')
    expect(ctx.livePost).toBeNull()
  })
})
