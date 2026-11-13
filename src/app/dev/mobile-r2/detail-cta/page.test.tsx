import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  usePathname: () => '/dev/mobile-r2/detail-cta',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

import { isConversationDetail } from '@/features/mobile-inbox/r2-conversation-detail'
import DetailCtaDevPage, {
  DETAIL_CTA_FIXTURE,
  DETAIL_CTA_THREAD_KEY,
  DETAIL_CTA_WORKSPACE_ID,
} from './page'

afterEach(() => vi.unstubAllEnvs())

describe('대화 상세 상태 하네스 — 운영 비노출', () => {
  it('운영(production)에서는 404 로 끝난다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => render(<DetailCtaDevPage />)).toThrow('NEXT_NOT_FOUND')
  })

  it('고정 응답은 실제 서버 계약 검사를 통과한다', () => {
    expect(isConversationDetail(DETAIL_CTA_FIXTURE, DETAIL_CTA_WORKSPACE_ID, DETAIL_CTA_THREAD_KEY)).toBe(
      true,
    )
  })

  it('고정 응답은 검토 가능 조건(답안·근거·지문·보낼 곳)을 갖춘다', () => {
    const { thread, targetLabel, fingerprint, delivery, complete } = DETAIL_CTA_FIXTURE
    expect(thread.draft?.sources.length).toBeGreaterThan(0)
    expect(targetLabel).toBeTruthy()
    expect(fingerprint).toHaveLength(64)
    expect(delivery).toBe('none')
    expect(complete).toBe(true)
  })
})

describe('대화 상세 상태 하네스 — 상태 재현', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/dev/mobile-r2/detail-cta')
    vi.unstubAllEnvs()
  })

  it('review=1 에서 재작성·저장·최종 검토는 고정 응답만 사용한다', async () => {
    window.history.replaceState({}, '', '/dev/mobile-r2/detail-cta?review=1')
    render(<DetailCtaDevPage />)
    expect(await screen.findByLabelText('답안 내용')).toHaveValue('목요일 2시 가능해요.')
    fireEvent.change(screen.getByLabelText('소희에게 수정 요청'), { target: { value: '더 공손하게' } })
    fireEvent.click(screen.getByRole('button', { name: '대화로 다시 쓰기' }))
    await waitFor(() => expect(screen.getByLabelText('답안 내용')).toHaveValue('문의해 주셔서 감사합니다. 가능한 시간을 확인해 안내해 드릴게요.'))
    expect(screen.getByRole('button', { name: '이 답안 보내기' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '답안 저장' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이 답안 보내기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '이 답안 보내기' }))
    expect(screen.getByRole('button', { name: '승인하고 전송' })).toBeVisible()
    expect(screen.getByText(/개발용 고정 응답/)).toBeVisible()
  })
  it('mode=offline 은 일반 오류가 아니라 오프라인 상태로 끝난다', async () => {
    window.history.replaceState({}, '', '/dev/mobile-r2/detail-cta?mode=offline')
    render(<DetailCtaDevPage />)
    expect(await screen.findByText('네트워크에 연결할 수 없습니다')).toBeTruthy()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  })

  it('mode=error 는 오프라인이 아니라 확인 실패로 끝난다', async () => {
    window.history.replaceState({}, '', '/dev/mobile-r2/detail-cta?mode=error')
    render(<DetailCtaDevPage />)
    expect(await screen.findByText('불러오지 못했어요')).toBeTruthy()
    expect(screen.queryByText('네트워크에 연결할 수 없습니다')).toBeNull()
  })
})
