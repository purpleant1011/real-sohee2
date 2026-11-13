// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import InboxWiringDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/inbox-wiring',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
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
  return InboxWiringDevPage({ searchParams: Promise.resolve(params) })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('/dev/mobile-r2/inbox-wiring 하네스 (ANI-1766)', () => {
  it('운영에서는 404 다', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await expect(renderPage({ r2: '1' })).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('플래그 OFF(기본)면 기존 R1 소통함을 그린다', async () => {
    await act(async () => {
      render(await renderPage())
    })

    expect(document.body.textContent).toContain('수신된 고객 문의 내역이 없습니다')
    expect(document.body.textContent).not.toContain('김예시')
  })

  it('r2=1 이고 좁은 화면이면 R2 소통함이 서버 스냅샷을 그린다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }))
    })

    expect(document.body.textContent).toContain('김예시')
    expect(document.body.textContent).toContain('답안 준비됨')
    expect(document.body.textContent).not.toContain('수신된 고객 문의 내역이 없습니다')
  })

  it('r2=1 이어도 넓은 화면이면 기존 R1 소통함 그대로다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }, 1024))
    })

    expect(document.body.textContent).toContain('수신된 고객 문의 내역이 없습니다')
    expect(document.body.textContent).not.toContain('김예시')
  })
})
