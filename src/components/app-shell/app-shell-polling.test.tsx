import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

import { AppShell } from './app-shell'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
}

function statusResponse() {
  return Response.json({
    data: {
      activeJobCount: 0,
      attentionThreadCount: 0,
      threads: [],
      creditBalance: {
        available: 1253,
        weeklyLimit: 2000,
        consumed: 700,
        reserved: 47,
        policyVersion: 'v08-test-2000-1',
      },
      observedAt: '2026-08-22T14:00:00.000Z',
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
})

describe('AppShell Free plan polling', () => {
  it('does not poll from a hidden tab and refreshes once when the tab becomes visible', async () => {
    setVisibility('hidden')
    const fetchStatus = vi.spyOn(globalThis, 'fetch').mockResolvedValue(statusResponse())

    render(<AppShell workspaceId={workspaceId}><p>대화 본문</p></AppShell>)
    await act(async () => { await Promise.resolve() })
    expect(fetchStatus).not.toHaveBeenCalled()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledOnce())
  })

  it('coalesces repeated refresh events while one status request is still running', async () => {
    setVisibility('visible')
    let finishRequest: ((response: Response) => void) | undefined
    const fetchStatus = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
      finishRequest = resolve
    }))

    render(<AppShell workspaceId={workspaceId}><p>대화 본문</p></AppShell>)
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledOnce())

    window.dispatchEvent(new Event('sohee:work-status-refresh'))
    window.dispatchEvent(new Event('sohee:work-status-refresh'))
    expect(fetchStatus).toHaveBeenCalledOnce()

    await act(async () => finishRequest?.(statusResponse()))
  })
})
