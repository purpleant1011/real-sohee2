import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import ResultsRangeDevPage from './page'
import { restoreResultsRangeFetchStub } from './harness'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/results-range',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

// 하네스는 모듈을 읽는 순간 `/reports/weekly` 만 가로채는 fetch 스텁을 브라우저 전역에 설치한다.
// 테스트가 다른 전역을 stub 했다면 여기서 원래대로 돌려놓고, 하네스 스텁은 다시 설치해 다음 테스트로 샌다.
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  restoreResultsRangeFetchStub()
  window.history.replaceState(null, '', '/')
})

describe('/dev/mobile-r2/results-range 하네스 (ANI-1782)', () => {
  it('운영에서는 404 다', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => ResultsRangeDevPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('개발 모드에서는 예시 화면이라는 안내가 보인다', async () => {
    render(ResultsRangeDevPage())

    expect(document.body.textContent).toContain('예시 화면 · 실제 데이터가 아닙니다')
    // 하네스가 무엇을 검수하는지도 같은 화면에 적혀 있어야 한다.
    expect(document.body.textContent).toContain('직접 선택')
    // 주간 리포트 응답을 기다리는 동안 화면이 사라지지 않게 정리한다.
    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
  })

  it('개발 모드에서는 예시 주간 리포트의 숫자를 그린다', async () => {
    render(ResultsRangeDevPage())

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
  })
})
