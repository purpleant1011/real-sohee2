// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { R2Customers } from '@/features/mobile-customers/r2-customers'
import { R2Results } from '@/features/mobile-results/r2-results'
import { R2More } from '@/features/mobile-settings/r2-more'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ShellScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const WS = '11111111-1111-4111-8111-111111111111'
const tabs = [
  { name: '고객', Component: R2Customers },
  { name: '성과', Component: R2Results },
  { name: '더보기', Component: R2More },
]

function success(url: string) {
  const period = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' }
  const observed = { value: 1, state: 'OBSERVED', source: 'external_action_receipts.independent_publish_readback', period, observedAt: '2026-10-08T00:00:00.000Z', evidenceIds: ['ev-1'] }
  const payload = url.includes('customers/canonical')
    ? { ok: true, items: [] }
    : url.includes('mobile-customers')
      ? { loadState: 'ready', customers: [], workspaceId: WS, complete: true, checkedAt: null }
    : url.includes('reports/weekly')
      ? { workspaceId: WS, datasetMode: 'ACTUAL', period, generatedAt: observed.observedAt, metrics: { verifiedPublishedPosts: observed, storedComments: observed, bookingConfirmed: observed, paymentCapturedVerified: observed, revenue: observed } }
      : url.includes('/profile')
        ? { profile: { business: { businessName: '확인한 가게' } } }
        : url.includes('/energy') ? { status: 'ACTIVE', budgetAlertStage: 'NORMAL' } : { instagram: null }
  return { ok: true, status: 200, json: async () => payload }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each(tabs)('$name 조회 복구', ({ name, Component }) => {
  it.each(['headers', 'body'])('%s가 끝나지 않아도 15초 뒤 로딩 대신 실패를 알린다', async phase => {
    vi.useFakeTimers()
    let finish: () => void = () => {}
    const pending = new Promise<void>(resolve => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn((url: string) => phase === 'headers'
      ? pending.then(() => success(url))
      : Promise.resolve({ ok: true, status: 200, json: () => pending.then(() => success(url).json()) })))
    const { container } = render(<Component workspaceId={WS} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
    // Abort를 무시한 이전 응답도 시간 초과 뒤 상태를 덮지 못한다.
    await act(async () => { finish() })
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
  })

  it('시간 초과 뒤 같은 화면에서 명시적으로 다시 조회한다', async () => {
    vi.useFakeTimers()
    let recover = false
    vi.stubGlobal('fetch', vi.fn((url: string) => recover ? Promise.resolve(success(url)) : new Promise(() => {})))
    const { container } = render(<Component workspaceId={WS} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    recover = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' })) })
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    if (name === '고객') expect(screen.getByText('등록된 고객이 없어요')).toBeVisible()
    else expect(screen.getByRole('list', { name: name === '성과' ? '핵심 지표' : '설정 목록' })).toBeVisible()
  })

  it('가게 전환 중 이전 가게의 결과를 새 화면에 노출하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(success(url))))
    const { rerender, container } = render(<Component workspaceId={WS} />)
    await act(async () => {})
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    rerender(<Component workspaceId="22222222-2222-4222-8222-222222222222" />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.queryByText('등록된 고객이 없어요')).toBeNull()
    expect(screen.queryByRole('list', { name: '핵심 지표' })).toBeNull()
    expect(screen.queryByText('지금 보는 가게: 확인한 가게')).toBeNull()
  })

  it('화면을 닫으면 조회를 취소하고 제한 타이머도 정리한다', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return new Promise(() => {})
    }))
    const { unmount } = render(<Component workspaceId={WS} />)
    await act(async () => { unmount() })
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('더보기의 한 조회가 멈춰도 확인된 가게와 섹션을 보존한다', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/energy') ? new Promise(() => {}) : Promise.resolve(success(url))))
  render(<R2More workspaceId={WS} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(screen.getByText('지금 보는 가게: 확인한 가게')).toBeVisible()
  expect(screen.getByRole('list', { name: '설정 목록' })).toBeVisible()
  expect(screen.queryByText('크레딧 잔액 확인됨')).toBeNull()
})
