// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PublishStatusPreviewPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
}))

describe('PublishStatusPreviewPage', () => {
  it('게시 상태 여섯 가지를 예시로 보여 주고, 확인된 예시에서만 게시 확인을 쓴다', () => {
    render(<PublishStatusPreviewPage />)
    for (const label of ['전송 중', '외부 확인 중', '게시 확인', '게시 실패', '결과 확인 불가', '직접 전달', '발행 준비 완료 · 외부 게시 전']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(document.querySelectorAll('[data-publish-state="VERIFIED"]')).toHaveLength(1)
    expect(document.querySelectorAll('a[href]')).toHaveLength(1)
  })
})
