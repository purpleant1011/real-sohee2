import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import WorkPreviewDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/work-preview',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

/** 하네스 검수 대상은 진입 게이트다. 셸 프레임(탭 바·헤더)은 이 테스트의 관심사가 아니다. */
vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children?: React.ReactNode }) => <div data-mobile-app-shell>{children}</div>,
  ShellScreen: ({ children }: { children?: React.ReactNode }) => <div data-shell-screen>{children}</div>,
}))

/** 사진 측정은 jsdom 에서 끝나지 않는다. 하네스는 진입 게이트만 검수하므로 재기를 끊는다. */
vi.mock('@/features/mobile-firstpost/measured-asset', () => ({
  useMeasuredImage: (asset: unknown) => ({ asset, status: asset ? 'failed' : 'none' }),
  useMeasuredAsset: (asset: unknown) => asset,
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
  return WorkPreviewDevPage({ searchParams: Promise.resolve(params) })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('/dev/mobile-r2/work-preview 하네스 (ANI-1678)', () => {
  it('운영에서는 404 다', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await expect(renderPage({ r2: '1' })).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('기본값은 플래그 OFF 라 기존 상세를 그린다', async () => {
    await act(async () => {
      render(await renderPage())
    })

    expect(document.querySelector('[data-legacy-work-detail]')).toBeTruthy()
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
  })

  it('r2=1 이고 좁은 화면이면 실라우트 진입점이 홍보 세트를 그린다', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1' }))
    })

    await waitFor(() => {
      expect(document.querySelector('[data-first-post-preview]')).toBeTruthy()
    })
    expect(document.querySelector('[data-legacy-work-detail]')).toBeNull()
    // 승인으로 가는 검토 동선은 있지만 게시 버튼은 이 화면에 없다.
    expect(document.body.textContent).toContain('이 내용 검토')
    expect(document.body.textContent).not.toContain('게시하기')
  })

  it('snapshot=0 이면 조회 실패 상태를 보여 준다(빈 화면으로 숨기지 않는다)', async () => {
    await act(async () => {
      render(await renderPage({ r2: '1', snapshot: '0' }))
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('불러오지 못했어요')
    })
  })
})
