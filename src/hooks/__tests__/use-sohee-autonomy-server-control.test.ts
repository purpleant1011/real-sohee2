import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSoheeAutonomy } from '../use-sohee-autonomy'
vi.mock('../use-workspace-context', () => ({ useOptionalWorkspaceContext: () => null }))
const workspaceId = 'ws-test-autonomy'
const server = (actualMode = 'RUNNING') => ({ workspaceId, desiredMode: actualMode === 'PAUSED' ? 'PAUSED' : 'RUNNING', actualMode, killSwitchActive: actualMode === 'BLOCKED', version: 3, activeActionRunCount: 0, updated_at: '2026-10-25T10:00:00Z' })
const res = (body: unknown) => ({ ok: true, json: async () => body })
afterEach(() => vi.unstubAllGlobals())
describe('useSoheeAutonomy 서버 readback 호환', () => {
  it('서버 actual RUNNING을 표시하고 no-store로 조회한다', async () => {
    const fetcher = vi.fn(async () => res(server()))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSoheeAutonomy(workspaceId))
    await waitFor(() => expect(result.current.isRunning).toBe(true))
    expect(fetcher).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/agent/control`, expect.objectContaining({ cache: 'no-store' }))
  })
  it('킬스위치는 실제 실행 중 표시를 차단한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(server('BLOCKED'))))
    const { result } = renderHook(() => useSoheeAutonomy(workspaceId))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.killSwitchActive).toBe(true)
    expect(result.current.isRunning).toBe(false)
  })
  it('POST 후 GET이 PAUSED일 때만 중지 상태를 반영한다', async () => {
    let paused = false
    const fetcher = vi.fn(async (_url, init) => { if (init?.method === 'POST') { paused = true; return res(server()) } return res(server(paused ? 'PAUSED' : 'RUNNING')) })
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSoheeAutonomy(workspaceId))
    await waitFor(() => expect(result.current.isRunning).toBe(true))
    await act(async () => { await result.current.toggleAutonomy() })
    await waitFor(() => expect(result.current.actualMode).toBe('PAUSED'))
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it.each(['network', '500'])('%s 실패는 로컬 DEGRADED 추정이 아니라 UNKNOWN이다', async kind => {
    vi.stubGlobal('fetch', vi.fn(async () => { if (kind === 'network') throw new Error('offline'); return { ok: false, status: 500 } }))
    const { result } = renderHook(() => useSoheeAutonomy(workspaceId))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.actualMode).toBe('UNKNOWN')
  })
})
