import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}))

import { getNaverPublishStatusAction } from './get-naver-publish-status.action'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const CONTENT_ID = '33333333-3333-4333-8333-333333333333'
const VERSION_ID = '44444444-4444-4444-4444-444444444444'

describe('getNaverPublishStatusAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    })
  })

  function mockDb({
    membership = { role: 'manager', status: 'active' },
    versions = [{ id: VERSION_ID }],
    requests = [
      {
        id: 'req-1',
        status: 'succeeded',
        target_label: 'findk3 테스트 블로그',
        content_version_id: VERSION_ID,
        scheduled_at: null,
        auto_execute_until: null,
        failure_code: null,
        exact_payload: { visibility: 'public' },
      },
    ],
    receipts = [{ result_url: 'https://blog.naver.com/findk3/123456789012' }],
  }: {
    membership?: { role: string; status: string } | null
    versions?: Array<{ id: string }>
    requests?: any[]
    receipts?: Array<{ result_url: string | null }>
  } = {}) {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'workspace_members') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: membership, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'content_versions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: versions, error: null }),
            }),
          }),
        }
      }
      if (table === 'external_action_requests') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: requests, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'external_action_receipts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: receipts, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      return { select: vi.fn() }
    })
  }

  it('rejects unauthenticated user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no user') })
    const res = await getNaverPublishStatusAction({ workspaceId: WORKSPACE, contentId: CONTENT_ID })
    expect(res.error?.message).toBe('로그인이 필요해요.')
  })

  it('rejects non-members or viewers', async () => {
    mockDb({ membership: { role: 'viewer', status: 'active' } })
    const res = await getNaverPublishStatusAction({ workspaceId: WORKSPACE, contentId: CONTENT_ID })
    expect(res.error?.message).toBe('이 매장에 접근할 수 없어요.')
  })

  it('returns mapped latest status data when request exists', async () => {
    mockDb()
    const res = await getNaverPublishStatusAction({ workspaceId: WORKSPACE, contentId: CONTENT_ID })
    expect(res.data).toEqual({
      id: 'req-1',
      status: 'succeeded',
      phase: 'succeeded',
      resultUrl: 'https://blog.naver.com/findk3/123456789012',
      failureCode: null,
      visibility: 'public',
      scheduledAt: null,
      targetLabel: 'findk3 테스트 블로그',
    })
  })

  it('returns null when no requests found', async () => {
    mockDb({ requests: [] })
    const res = await getNaverPublishStatusAction({ workspaceId: WORKSPACE, contentId: CONTENT_ID })
    expect(res.data).toBeNull()
  })
})
