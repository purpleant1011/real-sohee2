import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  usePathname: () => '/dev/mobile-r2/booking-timeline',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

import BookingTimelineDevPage from './booking-timeline/page'

afterEach(() => vi.unstubAllEnvs())

describe('예약 문의 타임라인 폭 검수용 개발 페이지 — 운영 비노출', () => {
  it('하네스는 운영(production)에서 404 로 끝난다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => render(<BookingTimelineDevPage />)).toThrow('NEXT_NOT_FOUND')
  })

  it('개발 환경에서는 예시 타임라인을 그리고 수락 시각은 근거에서만 온다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { container } = render(<BookingTimelineDevPage />)

    expect(screen.getByText(/예시 화면이에요/)).toBeVisible()
    // 수락 시각은 fixture 의 acceptance(서울 기준 10. 23. 오후 2:00)로만 표기된다.
    expect(screen.getByText(/10\. 23\..*2:00에 고객이 수락했어요/)).toBeVisible()
    // 예약표 반영 전이므로 확정 문구를 쓰지 않는다.
    expect(container.textContent).not.toContain('확정됐어요')
    // 다음 행동은 문구 하나뿐이고, 동작하지 않는 버튼은 그리지 않는다.
    expect(container.textContent).toContain('다음 할 일 · 예약 확정 검토하기')
    expect(screen.queryByRole('button', { name: /예약 확정 검토하기/ })).toBeNull()
  })
})
