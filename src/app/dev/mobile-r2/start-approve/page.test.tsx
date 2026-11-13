// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import StartApproveDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/start-approve',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

/** 캡처 대상 화면 자체는 각자 화면 테스트가 덮는다. 여기서는 게이트 분기만 본다. */
vi.mock('@/features/mobile-approvals/r2-work-approve', () => ({
  R2WorkApprove: () => <p>r2-approve</p>,
}))
vi.mock('@/features/mobile-firstpost/first-post-entry', () => ({
  FirstPostEntry: () => <p>first-post</p>,
}))
vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

/** R2 는 폭 767px 이하에서만 켜진다. jsdom 기본 matchMedia 는 false 라 넓은 화면이 된다. */
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
  return StartApproveDevPage({ searchParams: Promise.resolve(params) })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('/dev/mobile-r2/start-approve 하네스 (ANI-1680)', () => {
  it('운영에서는 404 다', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await expect(renderPage({ r2: '1' })).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('기본값은 승인 화면 + 플래그 OFF 라 R2 를 그리지 않는다', async () => {
    await act(async () => {
      render(await renderPage())
    })

    expect(document.body.textContent).toContain('기존 작업 상세 화면(R1)')
    expect(document.body.textContent).not.toContain('r2-approve')
  })

  it('r2=1 이고 좁은 화면이면 승인 화면을 그린다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }))
    })

    expect(document.body.textContent).toContain('r2-approve')
    expect(document.body.textContent).not.toContain('기존 작업 상세 화면(R1)')
  })

  it('r2=1 이어도 768px 초과면 R2 를 그리지 않는다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }, 1024))
    })

    expect(document.body.textContent).toContain('기존 작업 상세 화면(R1)')
    expect(document.body.textContent).not.toContain('r2-approve')
  })

  it('screen=firstpost + r2=1 이면 첫 포스팅 진입 화면을 그린다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1', screen: 'firstpost' }))
    })

    expect(document.body.textContent).toContain('first-post')
  })

  it('screen=firstpost 라도 플래그 OFF 면 첫 포스팅 화면을 그리지 않는다', async () => {
    await act(async () => {
      render(await renderPage({ screen: 'firstpost' }))
    })

    expect(document.body.textContent).not.toContain('first-post')
    expect(document.body.textContent).toContain('기존 작업 상세 화면(R1)')
  })

  it('알 수 없는 screen 값은 승인 화면으로 떨어진다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1', screen: 'nope' }))
    })

    expect(document.body.textContent).toContain('r2-approve')
  })
})
