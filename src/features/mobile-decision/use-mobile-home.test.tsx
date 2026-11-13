import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMobileHome } from './use-mobile-home'
const payload = (workspaceId: string) => ({ workspaceId, businessName: null, timeZone: null, generatedAt: '2026-10-16T00:00:00Z',
  agent: { state: 'unknown', data: null, observedAt: null, validUntil: null },
  decisions: { state: 'ready', data: { items: [], total: 0, complete: true }, observedAt: null, validUntil: null },
  activity: { state: 'unknown', data: null, observedAt: null, validUntil: null }, results: { state: 'unknown', data: null, observedAt: null, validUntil: null } })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it.each(['headers', 'body'])('leaves loading when response %s never finishes and allows retry', async phase => {
  vi.useFakeTimers()
  let retry = false
  vi.stubGlobal('fetch', async () => {
    if (retry) return Response.json(payload('a'))
    if (phase === 'headers') return new Promise<Response>(() => {})
    return { ok: true, json: () => new Promise(() => {}) }
  })
  const hook = renderHook(() => useMobileHome('a'))
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.error).toBe(true)
  expect(hook.result.current.view).toBeNull()
  retry = true
  await act(async () => { hook.result.current.refresh() })
  expect(hook.result.current.view?.workspaceId).toBe('a')
  expect(hook.result.current.error).toBe(false)
  hook.unmount()
})
it('keeps old data stale after timeout and ignores a late successful response', async () => {
  vi.useFakeTimers()
  let settle: (value: Response) => void = () => {}
  let first = true
  vi.stubGlobal('fetch', async () => {
    if (first) { first = false; return Response.json(payload('a')) }
    return new Promise<Response>(resolve => { settle = resolve })
  })
  const hook = renderHook(() => useMobileHome('a'))
  await act(async () => {})
  expect(hook.result.current.view?.decisions.state).toBe('ready')
  await act(async () => { hook.result.current.refresh() })
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.view?.decisions.state).toBe('stale')
  expect(hook.result.current.error).toBe(true)
  await act(async () => { settle(Response.json(payload('a'))) })
  expect(hook.result.current.view?.decisions.state).toBe('stale')
  expect(hook.result.current.error).toBe(true)
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
it('discards late responses after switching workspace', async () => {
  const pending: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => pending.push(resolve)))
  const hook = renderHook(({ id }) => useMobileHome(id), { initialProps: { id: 'a' } })
  hook.rerender({ id: 'b' })
  expect(hook.result.current.view).toBeNull()
  await act(async () => { pending[1](Response.json(payload('b'))) })
  await waitFor(() => expect(hook.result.current.view?.workspaceId).toBe('b'))
  await act(async () => { pending[0](Response.json(payload('a'))) })
  expect(hook.result.current.view?.workspaceId).toBe('b')
})
it('does not trust a mismatched workspace response', async () => {
  vi.stubGlobal('fetch', async () => Response.json(payload('other')))
  const hook = renderHook(() => useMobileHome('a'))
  await waitFor(() => expect(hook.result.current.error).toBe(true))
  expect(hook.result.current.view).toBeNull()
})
it('marks prior successful decisions stale after a failed refresh', async () => {
  let fail = false
  vi.stubGlobal('fetch', async () => fail ? new Response('{}', { status: 503 }) : Response.json(payload('a')))
  const hook = renderHook(() => useMobileHome('a'))
  await waitFor(() => expect(hook.result.current.view?.decisions.state).toBe('ready'))
  fail = true
  act(() => hook.result.current.refresh())
  await waitFor(() => expect(hook.result.current.error).toBe(true))
  expect(hook.result.current.view?.decisions.state).toBe('stale')
})
