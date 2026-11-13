// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import FactsQuestionDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  usePathname: () => '/dev/mobile-r2/facts-question',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

function stubWidth(px = 390) {
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
  return FactsQuestionDevPage({ searchParams: Promise.resolve(params) })
}

describe('/dev/mobile-r2/facts-question dev leaf', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('운영(production) 환경에서는 404 notFound()로 fail-closed 차단된다', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('개발 환경에서 하네스가 마운트되며 상단에 예시/로컬선택/서버저장안함 정직한 배너가 표시된다 (fetch 0건)', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(await renderPage({ r2: '1' }))

    expect(screen.getByText('예시 화면이에요 · 로컬 선택만 동작하며 서버 저장이나 외부 API 호출은 없어요')).toBeInTheDocument()
    expect(screen.getByText('소희의 사실 확인')).toBeInTheDocument()
    // 초기 렌더 시 네트워크/API 호출 0건 단언
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preset=with_memory 시 기존 등록 기억 예시가 주입되어 menu 질문부터 시작한다 (fetch 0건)', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(await renderPage({ r2: '1', preset: 'with_memory' }))

    expect(screen.getByText('이번 초안에서 확인한 내용')).toBeInTheDocument()
    expect(screen.getByText('아메리카노 4,500원 (예시)')).toBeInTheDocument()
    // menu 질문 노출
    expect(screen.getByText('이번에 알릴 메뉴나 서비스가 있나요?')).toBeInTheDocument()
    // 예시 메모리 주입 시에도 네트워크 호출 0건 단언
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('입력→확인→skip→완료 전 구간에서 생성/API/게시 없이 fetch 호출 0건 유지 (실부작용 차단 회귀 검증)', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(await renderPage({ r2: '1', preset: 'full_sample' }))

    // 1. 초기 렌더
    expect(fetchSpy).not.toHaveBeenCalled()

    // 2. 모든 질문이 완료된 프리셋에서 홍보 초안 만들기 클릭
    const finishButton = screen.getByRole('button', { name: '홍보 초안 만들기' })
    fireEvent.click(finishButton)

    // 로컬 요약 배너 및 확정된 내용 확인
    expect(screen.getByText('로컬 확인 요약 (서버 실행 기능 없음)')).toBeInTheDocument()
    expect(screen.getByText(/아메리카노 4,500원/)).toBeInTheDocument()

    // 3. 완료 클릭 후에도 서버 fetch 호출이 전혀 없어야 함 (실부작용 0건 단언)
    expect(fetchSpy).not.toHaveBeenCalled()

    // 4. 다시 테스트하기 클릭 후에도 fetch 0건
    fireEvent.click(screen.getByRole('button', { name: '다시 테스트하기' }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
