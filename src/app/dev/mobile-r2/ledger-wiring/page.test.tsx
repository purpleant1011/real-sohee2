// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import LedgerWiringDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/ledger-wiring',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

/** 하네스 검수 대상은 진입 게이트다. 기존 일정 화면은 모킹해 표식만 본다. */
vi.mock('@/features/schedule/schedule-board', () => ({ ScheduleBoard: () => <p>legacy-schedule</p> }))

/** 어댑터는 기존 화면용이다. 게이트 판정만 보므로 통과시킨다. */
vi.mock('nuqs/adapters/next/app', () => ({
  NuqsAdapter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

/** R2 진입은 폭 767px 이하에서만 켜진다. jsdom 기본 matchMedia 는 false 라 넓은 화면이 된다. */
function stubWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /\(max-width:\s*(\d+)px\)/.exec(query)
    return {
      matches: max ? px <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

function renderPage(params: Record<string, string> = {}, px = 390) {
  stubWidth(px)
  return LedgerWiringDevPage({ searchParams: Promise.resolve(params) })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('/dev/mobile-r2/ledger-wiring 하네스 (ANI-1691)', () => {
  it('운영에서는 404 다', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await expect(renderPage({ r2: '1' })).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('기본값은 플래그 OFF 라 기존 일정 화면을 그린다', async () => {
    await act(async () => {
      render(await renderPage())
    })

    expect(document.body.textContent).toContain('legacy-schedule')
    expect(document.body.textContent).not.toContain('예약표')
  })

  it('r2=1 이고 좁은 화면이면 실제 진입점이 예약 장부를 그린다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }))
    })

    expect(document.body.textContent).toContain('예약표')
    expect(document.body.textContent).toContain('김민지 · 속눈썹 연장')
    // 종료 시각 근거가 없는 예약은 종료 시각을 만들지 않고 미확인으로 그린다.
    expect(document.body.textContent).toContain('시각 확인 못함')
    expect(document.body.textContent).not.toContain('legacy-schedule')
  })

  it('r2=1 이어도 넓은 화면이면 기존 일정 화면 그대로다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }, 1024))
    })

    expect(document.body.textContent).toContain('legacy-schedule')
    expect(document.body.textContent).not.toContain('예약표')
  })

  it('snapshot=0 이면 플래그 ON 이어도 장부 대신 기존 일정 화면을 그린다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1', snapshot: '0' }))
    })

    expect(document.body.textContent).toContain('legacy-schedule')
    expect(document.body.textContent).not.toContain('예약표')
  })
})
