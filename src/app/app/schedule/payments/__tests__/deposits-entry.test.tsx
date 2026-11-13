// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import type { DepositsViewSnapshot } from '@/features/mobile-deposits/deposits-view'
import { DEPOSITS_WIDE_NOTICE, DepositsEntry } from '../deposits-entry'

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-shell">{children}</div>,
}))

const WS = '11111111-1111-4111-8111-111111111111'

/** 서버가 넘기는 스냅샷과 같은 모양. 결제사 미연결 상태(provider none)의 예약금 1건. */
const SNAPSHOT: DepositsViewSnapshot = {
  loadState: 'ready',
  checkedAt: '2026-10-24T00:00:00Z',
  deposits: [{
    workspaceId: WS,
    bookingId: 'b1',
    provider: 'none',
    availability: 'supported',
    amount: 30000,
    currency: 'KRW',
    termsAcceptedAt: null,
    transport: 'not_started',
    providerAccepted: null,
    readback: 'unavailable',
    readbackAt: null,
    receiptRef: null,
    refund: null,
    idempotencyKey: null,
    seenCallbacks: [],
  }],
}

function matchesAt(query: string, px: number): boolean {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query)
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)
  const checks: boolean[] = []
  if (max) checks.push(px <= Number(max[1]))
  if (min) checks.push(px >= Number(min[1]))
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

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const renderEntry = (enabled: boolean, px: number) => {
  stubWidth(px)
  return render(
    <MobileR2Provider enabled={enabled}>
      <DepositsEntry snapshot={SNAPSHOT} />
    </MobileR2Provider>,
  )
}

describe('M16 예약금 진입 게이트', () => {
  it('플래그 ON + 390px → 예약금 화면을 그리고 결제 실행은 막혀 있다', () => {
    renderEntry(true, 390)
    const button = screen.getByRole('button', { name: '예약금 결제하기' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('예약금 결제는 아직 연결되지 않았어요')).toBeTruthy()
    fireEvent.click(button)
    // 결제 실행 경로가 없다 — 외부 요청도, 이동도 만들지 않는다.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([768, 820, 1024])('플래그 ON + %ipx → 예약금 화면 대신 휴대폰 안내 및 V088AppShell 래핑', px => {
    renderEntry(true, px)
    expect(screen.getByText(DEPOSITS_WIDE_NOTICE)).toBeTruthy()
    expect(screen.getByTestId('pc-shell')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '예약금 결제하기' })).toBeNull()
  })

  it('플래그 OFF → 폭과 무관하게 예약금 화면을 그리지 않고 V088AppShell 래핑', () => {
    renderEntry(false, 390)
    expect(screen.getByText(DEPOSITS_WIDE_NOTICE)).toBeTruthy()
    expect(screen.getByTestId('pc-shell')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '예약금 결제하기' })).toBeNull()
  })

  it('조회 실패 스냅샷은 빈 목록이 아니라 실패로 보여준다', () => {
    stubWidth(390)
    render(
      <MobileR2Provider enabled>
        <DepositsEntry snapshot={{ loadState: 'error', deposits: [], checkedAt: null }} />
      </MobileR2Provider>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('예약금 내역이 없어요')).toBeNull()
  })
})
