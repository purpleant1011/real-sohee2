// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

const WS = '11111111-1111-4111-8111-111111111111'

vi.mock('@/components/v088/command/command-center-client', () => ({
  CommandCenterClient: () => <p>기존 지휘 화면</p>,
}))
vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => '11111111-1111-4111-8111-111111111111',
}))
/** 셸 자체는 자기 테스트가 있다. 여기서는 무엇이 마운트되는지만 본다. */
vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ShellScreen: ({ children, composer }: { children?: ReactNode; composer?: ReactNode }) => (
    <>{children}{composer}</>
  ),
}))

import { CommandEntry } from '../command-entry'

/**
 * ANI-1687 — /app/command 진입 분기.
 * 플래그 OFF·넓은 화면은 기존 지휘 화면 그대로이고 대화 조회를 하지 않는다.
 * 플래그 ON + 좁은 화면만 R2 셸 안의 채팅이며, 조회는 읽기 전용 GET 이다.
 */
function matchesAt(query: string, px: number): boolean {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query)
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)
  const checks: number[] = []
  if (max) checks.push(px <= Number(max[1]) ? 1 : 0)
  if (min) checks.push(px >= Number(min[1]) ? 1 : 0)
  return checks.length > 0 && checks.every(Boolean)
}

function stubWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matchesAt(query, px),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const fetchSpy = vi.fn(() => new Promise<Response>(() => {}))

beforeEach(() => {
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
  stubWidth(390)
})

afterEach(() => vi.unstubAllGlobals())

function renderEntry(enabled: boolean, px: number) {
  stubWidth(px)
  return render(
    <MobileR2Provider enabled={enabled}>
      <CommandEntry />
    </MobileR2Provider>,
  )
}

describe('M10 /app/command 진입 분기', () => {
  it('플래그 OFF 는 좁은 화면에서도 기존 화면이고 조회하지 않는다', () => {
    const view = renderEntry(false, 390)

    expect(screen.getByText('기존 지휘 화면')).toBeVisible()
    expect(view.container.querySelector('[data-mobile-chat]')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('넓은 화면(1440)은 플래그 ON 이어도 기존 화면이고 조회하지 않는다', () => {
    const view = renderEntry(true, 1440)

    expect(screen.getByText('기존 지휘 화면')).toBeVisible()
    expect(view.container.querySelector('[data-mobile-chat]')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('플래그 ON + 390px 는 셸 안의 채팅이고 읽기 전용 GET 으로만 조회한다', async () => {
    const view = renderEntry(true, 390)

    expect(view.container.querySelector('[data-mobile-chat]')).not.toBeNull()
    expect(screen.queryByText('기존 지휘 화면')).toBeNull()

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/workspaces/${WS}/agent/chat`)
    // 이 진입점은 기존 R2 대화 기록 API를 읽는다. 새 Conversation 작성은 전체 대화 경로가 소유한다.
    expect(init).toMatchObject({ cache: 'no-store' })
    expect(init.method).toBeUndefined()
  })
})
