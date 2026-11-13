import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  summarizeEngagement,
  useChannelEngagement,
} from './use-channel-engagement'

describe('summarizeEngagement', () => {
  it('인스타그램: 미답변 DM과 대기 중 댓글 수를 집계한다', () => {
    const comments = [
      { id: 'c1', channel: 'instagram', status: 'RECEIVED' },
      { id: 'c2', channel: 'instagram', status: 'DRAFTED' },
      { id: 'c3', channel: 'instagram', status: 'SENT' },
      { id: 'c4', channel: 'threads', status: 'RECEIVED' },
    ]
    const threads = [
      { id: 't1', channel: 'instagram', status: 'NEEDS_REPLY', is_expired: false },
      { id: 't2', channel: 'instagram', status: 'NEEDS_REPLY', is_expired: true },
      { id: 't3', channel: 'instagram', status: 'SENT', is_expired: false },
    ]

    const summary = summarizeEngagement('instagram', comments, threads)
    expect(summary).toEqual({
      dmCount: 1,
      pendingCommentCount: 2,
    })
  })

  it('스레드: DM 수는 항상 0이고 해당 채널 댓글만 집계한다', () => {
    const comments = [
      { id: 'c1', channel: 'threads', status: 'RECEIVED' },
      { id: 'c2', channel: 'instagram', status: 'RECEIVED' },
    ]
    const threads = [
      { id: 't1', channel: 'instagram', status: 'NEEDS_REPLY', is_expired: false },
    ]

    const summary = summarizeEngagement('threads', comments, threads)
    expect(summary).toEqual({
      dmCount: 0,
      pendingCommentCount: 1,
    })
  })

  it('객체 인자로 호출해도 동일하게 동작하며 빈 데이터는 0을 반환한다', () => {
    const summary = summarizeEngagement({
      channel: 'instagram',
      comments: [],
      threads: [],
    })
    expect(summary).toEqual({
      dmCount: 0,
      pendingCommentCount: 0,
    })
  })

  it('null 및 undefined 데이터에도 에러 없이 0을 반환한다', () => {
    expect(summarizeEngagement('instagram', null, null)).toEqual({
      dmCount: 0,
      pendingCommentCount: 0,
    })
  })
})

describe('useChannelEngagement', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('초기 상태는 loading이며 요청 성공 시 ready 상태와 건수를 반환한다 (cache: no-store, AbortController)', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/engagement/comments')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'c1', channel: 'instagram', status: 'RECEIVED' },
              { id: 'c2', channel: 'instagram', status: 'APPROVED' },
            ],
          }),
        } as Response
      }
      if (url.includes('/engagement/dm/threads')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 't1', channel: 'instagram', status: 'NEEDS_REPLY', is_expired: false },
            ],
          }),
        } as Response
      }
      return { ok: false, status: 404 } as Response
    })

    const { result } = renderHook(() => useChannelEngagement('ws-1', 'instagram'))

    expect(result.current.state).toBe('loading')

    await waitFor(() => {
      expect(result.current.state).toBe('ready')
    })

    expect(result.current.dmCount).toBe(1)
    expect(result.current.pendingCommentCount).toBe(2)
    expect(result.current.summary).toEqual({
      dmCount: 1,
      pendingCommentCount: 2,
    })

    // GET-only fetch with cache: no-store
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspaces/ws-1/engagement/comments?channel=instagram'),
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      })
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspaces/ws-1/engagement/dm/threads'),
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('스레드 채널은 DM API를 호출하지 않고 댓글만 조회한다', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/engagement/comments')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 'c1', channel: 'threads', status: 'RECEIVED' }],
          }),
        } as Response
      }
      return { ok: false, status: 404 } as Response
    })

    const { result } = renderHook(() => useChannelEngagement('ws-1', 'threads'))

    await waitFor(() => {
      expect(result.current.state).toBe('ready')
    })

    expect(result.current.dmCount).toBe(0)
    expect(result.current.pendingCommentCount).toBe(1)
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/engagement/dm/threads'),
      expect.anything()
    )
  })

  it('요청 실패 시 unavailable 상태가 되며 건수는 0으로 표기하지 않는다 (null 반환)', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useChannelEngagement('ws-1', 'instagram'))

    await waitFor(() => {
      expect(result.current.state).toBe('unavailable')
    })

    // 실패는 절대 0으로 표기되지 않아야 함 (null 반환)
    expect(result.current.summary).toBeNull()
    expect(result.current.dmCount).toBeNull()
    expect(result.current.pendingCommentCount).toBeNull()
  })

  it('응답이 ok: false인 경우에도 unavailable 상태가 된다', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const { result } = renderHook(() => useChannelEngagement('ws-1', 'instagram'))

    await waitFor(() => {
      expect(result.current.state).toBe('unavailable')
    })

    expect(result.current.summary).toBeNull()
    expect(result.current.dmCount).toBeNull()
    expect(result.current.pendingCommentCount).toBeNull()
  })
})
