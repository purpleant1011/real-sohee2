import React from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyTodayHome as TodayHome } from './legacy-today-home'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({ isPaused: false, actualMode: 'UNKNOWN', isLoading: false, toggleAutonomy: vi.fn() }),
}))

const NativeDateTimeFormat = Intl.DateTimeFormat
const expectedDate = '10월 26일 월요일'

/** Change only the runtime default; keep explicit options and real Intl formatting. */
function runtimeTimeZone(timeZone: string) {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new NativeDateTimeFormat(locales, { timeZone, ...options })
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-25T17:00:00.000Z'))
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('홈 날짜는 런타임 위치가 아니라 서비스 Asia/Seoul 기준이다', () => {
  it.each(['UTC', 'Asia/Seoul', 'America/Los_Angeles'])('서버 기본 시간대 %s에서도 한국 날짜를 SSR한다', (timeZone) => {
    runtimeTimeZone(timeZone)
    const html = renderToString(<TodayHome workspaceId="date-fixture" />)
    expect(html).toContain(expectedDate)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('UTC SSR → 한국 시간 클라이언트 hydration에서 날짜 불일치가 없다', async () => {
    runtimeTimeZone('UTC')
    const container = document.createElement('div')
    container.innerHTML = renderToString(<TodayHome workspaceId="hydration-fixture" />)
    document.body.append(container)
    const errors: unknown[] = []
    let root: Root | undefined
    try {
      runtimeTimeZone('Asia/Seoul')
      await act(async () => {
        root = hydrateRoot(container, <TodayHome workspaceId="hydration-fixture" />, {
          onRecoverableError: error => errors.push(error),
        })
      })
      expect(errors).toEqual([])
      expect(container.textContent).toContain(expectedDate)
    } finally {
      if (root) await act(async () => root!.unmount())
      container.remove()
    }
  })
})
