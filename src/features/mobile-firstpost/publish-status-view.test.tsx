// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { publishStatusFor, type PublishStatusInput } from './publish-status'
import { PublishStatusPill, PublishStatusView } from './publish-status-view'

const view = (input: PublishStatusInput) => render(<PublishStatusView status={publishStatusFor(input)} />)

describe('PublishStatusView', () => {
  it('게시 확인일 때만 게시물 링크를 보여 준다', () => {
    view({
      deliveryStatus: 'succeeded',
      readbackUrl: 'https://www.instagram.com/p/example/',
      verifiedAt: '2026-10-24T03:00:00.000Z',
    })
    const link = screen.getByRole('link', { name: /게시물 보기/ })
    expect(link.getAttribute('href')).toBe('https://www.instagram.com/p/example/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('전송 접수만으로는 링크 없이 외부 확인 중으로 보여 준다', () => {
    view({ deliveryStatus: 'succeeded' })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('외부 확인 중')).toBeTruthy()
    expect(document.querySelector('[data-publish-state="CHECKING"]')).toBeTruthy()
  })

  it('실패 상태는 조치 필요 알약과 설명을 함께 보여 준다', () => {
    view({ deliveryStatus: 'failed', failureCause: 'READBACK_UNKNOWN' })
    expect(screen.getByText('게시 실패')).toBeTruthy()
    expect(document.querySelector('[data-publish-state="FAILED"]')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('수동 전달과 보관은 게시 확인 문구를 쓰지 않는다', () => {
    view({ manualDelivery: 'copy' })
    expect(screen.getByText('직접 전달')).toBeTruthy()
    expect(screen.queryByText('게시 확인')).toBeNull()

    view({ archived: true })
    expect(screen.getByText('발행 준비 완료 · 외부 게시 전')).toBeTruthy()
    expect(screen.queryByText('게시 확인')).toBeNull()
  })

  it('좁은 행용 알약은 상태 판정 결과를 그대로 옮긴다', () => {
    render(<PublishStatusPill status={publishStatusFor({ deliveryStatus: 'pending' })} />)
    expect(screen.getByText('전송 중')).toBeTruthy()
  })
})
