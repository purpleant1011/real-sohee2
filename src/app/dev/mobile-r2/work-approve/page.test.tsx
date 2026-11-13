// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { notFound } from 'next/navigation'
import WorkApproveDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/work-approve',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children?: React.ReactNode }) => <div data-mobile-app-shell>{children}</div>,
  ShellScreen: ({ cta }: { cta?: { label: string; disabled?: boolean; disabledReason?: string } }) =>
    cta ? (
      <div>
        {cta.disabled && cta.disabledReason ? <p>{cta.disabledReason}</p> : null}
        <button type="button" disabled={cta.disabled}>
          {cta.label}
        </button>
      </div>
    ) : null,
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('/dev/mobile-r2/work-approve dev fixture route', () => {
  it('NODE_ENV === "production" 환경에서는 notFound()를 호출하여 404를 발생시킨다', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(
      WorkApproveDevPage({ searchParams: Promise.resolve({ state: 'unreviewed' }) }),
    ).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('비운영 환경에서 state=unreviewed 스냅샷을 렌더링하면 "승인" CTA가 표시된다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const page = await WorkApproveDevPage({ searchParams: Promise.resolve({ state: 'unreviewed' }) })
    render(page)

    expect(screen.getByRole('button', { name: '승인' })).toBeEnabled()
    expect(screen.getByRole('heading', { level: 1, name: '게시 전 최종 확인' })).toBeInTheDocument()
    expect(screen.getByText('@sohee.ai')).toBeInTheDocument()
  })

  it('state=approved 스냅샷을 렌더링하면 명시적 "지금 게시 요청" CTA가 활성화된다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const page = await WorkApproveDevPage({ searchParams: Promise.resolve({ state: 'approved' }) })
    render(page)

    expect(screen.getByRole('button', { name: '지금 게시 요청' })).toBeEnabled()
    expect(screen.getByText(/대상 계정과 내용·이미지가 승인되었습니다/)).toBeInTheDocument()
  })

  it('state=blocked 스냅샷(빈칸 미채움)은 "지금 게시 요청"이 비활성화된다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const page = await WorkApproveDevPage({ searchParams: Promise.resolve({ state: 'blocked' }) })
    render(page)

    const publishBtn = screen.getByRole('button', { name: '지금 게시 요청' })
    expect(publishBtn).toBeDisabled()
    expect(screen.getByText('채워지지 않은 빈칸이 있어 실제 게시할 수 없어요. 내용을 먼저 완성해 주세요.')).toBeInTheDocument()
  })

  it('state=naver 스냅샷은 네이버 블로그 전용 "이 원고로 게시 준비 승인" CTA가 렌더링된다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const page = await WorkApproveDevPage({ searchParams: Promise.resolve({ state: 'naver' }) })
    render(page)

    expect(screen.getByRole('button', { name: '이 원고로 게시 준비 승인' })).toBeEnabled()
    expect(screen.getByRole('heading', { level: 1, name: '게시 준비 승인' })).toBeInTheDocument()
  })

  it('state=naver_approved 스냅샷은 "승인됨" 잠금과 원고 복사 링크가 표시된다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const page = await WorkApproveDevPage({ searchParams: Promise.resolve({ state: 'naver_approved' }) })
    render(page)

    expect(screen.getByRole('button', { name: '승인됨' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '원고 복사하러 가기' })).toBeInTheDocument()
  })
})
