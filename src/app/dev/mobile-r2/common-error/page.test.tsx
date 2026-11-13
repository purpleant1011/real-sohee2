// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CommonErrorPreviewPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
}))

describe('CommonErrorPreviewPage', () => {
  it('실서버 응답 예시를 정직한 문구로 그린다', () => {
    render(<CommonErrorPreviewPage />)
    expect(screen.getByRole('heading', { name: '공통 에러 상태' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '고객 수신 동의' })).toBeTruthy()
    // 확인 실패(error)만 alert 로 즉시 알리고, 인증·권한·오프라인은 상태 알림(status)으로 둔다.
    expect(within(screen.getByRole('region', { name: '공통 에러 상태' })).getAllByRole('alert')).toHaveLength(4)
    for (const text of [
      '로그인이 만료됐어요',
      '이 내용을 볼 권한이 없어요',
      '네트워크에 연결되지 않았어요',
      '서버에서 확인하지 못했어요',
    ]) {
      expect(within(screen.getByRole('region', { name: '공통 에러 상태' })).getByText(text)).toBeTruthy()
    }
    expect(document.body.textContent).not.toContain('Failed')
  })

  it('서버 근거 없는 granted 예시를 만들지 않고 철회와 미확인을 구분한다', () => {
    render(<CommonErrorPreviewPage />)
    expect(screen.getByText('수신 동의 철회')).toBeTruthy()
    expect(screen.getAllByText('수신 동의 미확인')).toHaveLength(2)
    expect(document.querySelector('[data-consent-status="granted"]')).toBeNull()
    expect(document.querySelectorAll('[data-consent-status="withdrawn"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-consent-status="unknown"]')).toHaveLength(2)
  })

  it('예시 화면에서 누른 행동만 알려 주고 실제 작업은 하지 않는다', () => {
    render(<CommonErrorPreviewPage />)
    const buttons = within(screen.getByRole('region', { name: '공통 에러 상태' })).getAllByRole('button')
    expect(buttons).toHaveLength(7)
    fireEvent.click(buttons[0])
    expect(screen.getByText(/실제 동작은 하지 않아요 · 로그인 만료 → 다시 로그인/)).toBeTruthy()
  })
})
