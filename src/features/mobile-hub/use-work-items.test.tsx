import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MobileHubView } from './hub-view'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkItems } from './use-work-items'

const payload = { success: true, contents: [{ contentId: 'one', workspaceId: 'a', title: '작업', status: 'draft' }] }
function WorkList() {
  const source = useWorkItems('a')
  return <MobileHubView workspaceId="a" source={source} />
}
it('요약 목록을 요청하고 버전 없는 초안도 표시한다', async () => {
  const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>().mockResolvedValue(Response.json({ ...payload, complete: false }))
  vi.stubGlobal('fetch', fetcher)
  const hook = renderHook(() => useWorkItems('a'))
  await act(async () => {})
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/workspaces/a/content?view=mobile-list')
  expect(hook.result.current.items[0].title).toBe('작업')
  expect(hook.result.current.complete).toBe(false)
})
it('마지막 페이지까지 읽으면 조회 완료 상태를 표시하고 중복 항목은 합친다', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ ...payload, complete: false, hasMore: true, nextCursor: 'next' }))
    .mockResolvedValueOnce(Response.json({ success: true, contents: [...payload.contents, { contentId: 'two', workspaceId: 'a', title: '다음', status: 'draft' }], complete: true, hasMore: false, nextCursor: null })))
  const hook = renderHook(() => useWorkItems('a'))
  await act(async () => {})
  expect(hook.result.current.nextCursor).toBe('next')
  await act(async () => { hook.result.current.loadMore?.() })
  expect(hook.result.current.items.map(item => item.id)).toEqual(['one', 'two'])
  expect(hook.result.current.complete).toBe(true)
})

it('더보기 이후 자동 갱신은 첫 페이지에서 신규·수정·삭제를 다시 읽는다', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...payload, complete: false, hasMore: true, nextCursor: 'next' }))
    .mockResolvedValueOnce(Response.json({ success: true, contents: [{ contentId: 'two', workspaceId: 'a', title: '이전 둘째', status: 'draft' }], complete: true, hasMore: false }))
    .mockResolvedValueOnce(Response.json({ success: true, contents: [{ contentId: 'new', workspaceId: 'a', title: '신규', status: 'review' }], complete: false, hasMore: true, nextCursor: 'new-next' }))
  vi.stubGlobal('fetch', fetcher)
  const hook = renderHook(() => useWorkItems('a'))
  await act(async () => {})
  await act(async () => { hook.result.current.loadMore?.() })
  expect(hook.result.current.complete).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(fetcher.mock.calls[2][0]).toBe('/api/workspaces/a/content?view=mobile-list')
  expect(hook.result.current.items.map(item => item.id)).toEqual(['new'])
  expect(hook.result.current.complete).toBe(false)
})

it('매장 A의 더보기 커서는 B 방문 후 A에 복귀할 때 재사용하지 않는다', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...payload, complete: false, hasMore: true, nextCursor: 'a-next' }))
    .mockResolvedValueOnce(Response.json({ success: true, contents: [{ contentId: 'two', workspaceId: 'a', title: '둘째', status: 'draft' }], complete: true, hasMore: false }))
    .mockResolvedValueOnce(Response.json({ success: true, contents: [], complete: true, hasMore: false }))
    .mockResolvedValueOnce(Response.json({ ...payload, complete: false, hasMore: true, nextCursor: 'a-next' }))
  vi.stubGlobal('fetch', fetcher)
  const hook = renderHook(({ id }) => useWorkItems(id), { initialProps: { id: 'a' } })
  await act(async () => {})
  await act(async () => { hook.result.current.loadMore?.() })
  await act(async () => { hook.rerender({ id: 'b' }) })
  await act(async () => { hook.rerender({ id: 'a' }) })
  expect(fetcher.mock.calls[3][0]).toBe('/api/workspaces/a/content?view=mobile-list')
  expect(hook.result.current.items.map(item => item.id)).toEqual(['one'])
  expect(hook.result.current.complete).toBe(false)
})

it('부분 조회 화면에서 다음 작업을 불러오는 버튼을 제공한다', async () => {
  const loadMore = vi.fn()
  render(<MobileHubView workspaceId="a" source={{ items: [], loadState: 'ready', complete: false, refresh: vi.fn(), nextCursor: 'next', loadMore }} />)
  fireEvent.click(screen.getByRole('button', { name: '다음 작업 더 보기' }))
  expect(loadMore).toHaveBeenCalledOnce()
})

it('renders an actionable error instead of infinite loading after timeout', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  render(<WorkList />)
  expect(screen.getByRole('status')).toHaveTextContent('작업을 불러오고 있어요.')
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(screen.getByRole('status')).toHaveTextContent('작업을 불러오지 못했어요.')
  expect(screen.getByRole('button', { name: '다시 확인하기' })).toBeInTheDocument()
  expect(screen.queryByText('0건')).not.toBeInTheDocument()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('leaves loading after a hung request, aborts it, and allows a successful manual retry', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}) }))
  const hook = renderHook(() => useWorkItems('a'))
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(hook.result.current.loadState).toBe('error')
  expect(signal?.aborted).toBe(true)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
  await act(async () => { hook.result.current.refresh() })
  expect(hook.result.current.loadState).toBe('ready')
  expect(hook.result.current.items[0].id).toBe('one')
})
it('keeps previous items stale when the next response body hangs', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
  const hook = renderHook(() => useWorkItems('a'))
  await act(async () => {})
  expect(hook.result.current.loadState).toBe('ready')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })))
  await act(async () => { hook.result.current.refresh() })
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(hook.result.current.loadState).toBe('stale')
  expect(hook.result.current.items).toHaveLength(1)
})
it('cancels the request deadline when leaving the screen', () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  const hook = renderHook(() => useWorkItems('a'))
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
it('discards late responses and old tenant items after a workspace switch', async () => {
  const pending: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))))
  const hook = renderHook(({ id }) => useWorkItems(id), { initialProps: { id: 'a' } })
  hook.rerender({ id: 'b' })
  await act(async () => { pending[1](Response.json({ success: true, contents: [] })) })
  await act(async () => { pending[0](Response.json(payload)) })
  expect(hook.result.current.items).toEqual([])
  expect(hook.result.current.loadState).toBe('ready')
})
