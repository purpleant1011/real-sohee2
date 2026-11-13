// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileConversationDetail } from './detail-view'
import { deliveryChip, reviewGate, type ConversationDetailDto } from './detail-model'
import type { InboxThreadDto } from './inbox-model'

function thread(o: Partial<InboxThreadDto> = {}): InboxThreadDto {
  return {
    id: 't1', workspaceId: 'ws', channel: 'instagram_dm', customerName: '김민지', consent: 'granted',
    status: 'draft_ready', unread: true,
    lastMessage: { text: '예약 되나요', receivedAt: '2026-10-22T05:00:00Z', fromCustomer: true },
    draft: { text: '목요일 2시 가능해요.', sources: ['예약표'] }, sendBlockers: [], ...o,
  }
}
function detail(o: Partial<ConversationDetailDto> = {}): ConversationDetailDto {
  return {
    thread: thread(), targetLabel: '인스타 → 김민지', fingerprint: 'a'.repeat(64), version: 3, delivery: 'none',
    complete: true,
    messages: [{ id: 'm1', fromCustomer: true, text: '목요일 오후에\n예약 되나요', at: '2026-10-22T05:00:00Z' }], ...o,
  }
}
const FP = 'a'.repeat(64)

describe('reviewGate', () => {
  it('모든 조건이 맞을 때만 진행 가능', () => {
    expect(reviewGate(detail(), FP).canProceed).toBe(true)
  })
  it('열 때와 지금 지문이 다르면 재검토를 요구한다', () => {
    expect(reviewGate(detail({ fingerprint: 'b'.repeat(64) }), FP).block).toBe('CHANGED')
  })
  it('지문·대상·답안·근거가 없으면 fail-closed', () => {
    expect(reviewGate(detail({ fingerprint: null }), FP).block).toBe('NO_FINGERPRINT')
    expect(reviewGate(detail(), null).block).toBe('NO_FINGERPRINT')
    expect(reviewGate(detail({ targetLabel: null }), FP).block).toBe('NO_TARGET')
    expect(reviewGate(detail({ thread: thread({ draft: null }) }), FP).block).toBe('NO_DRAFT')
    expect(reviewGate(detail({ thread: thread({ draft: { text: 'x', sources: [] } }) }), FP).block).toBe('NO_SOURCE')
  })
  it('서버가 발송을 막으면 진행하지 못한다', () => {
    const g = reviewGate(detail({ thread: thread({ sendBlockers: ['PROVIDER_NOT_READY'] }) }), FP)
    expect(g.canProceed).toBe(false)
    expect(g.block).toBe('SEND_BLOCKED')
  })
  it('이미 접수·전달된 답장은 다시 보내지 못한다(중복 발송 방지)', () => {
    expect(reviewGate(detail({ delivery: 'accepted' }), FP).block).toBe('ALREADY_SENT')
    expect(reviewGate(detail({ delivery: 'verified' }), FP).block).toBe('ALREADY_SENT')
  })
})

describe('deliveryChip', () => {
  it('접수만으로는 전달됐다고 말하지 않는다', () => {
    expect(deliveryChip('accepted').label).toContain('도착 확인 전')
    expect(deliveryChip('verified').label).toBe('전달 확인됨')
    expect(deliveryChip('unknown').tone).toBe('warn')
  })
})

describe('MobileConversationDetail', () => {
  it('원문 전체·답안·참고 정보·보낼 곳을 보여주고 지문은 노출하지 않는다', () => {
    const { container } = render(<MobileConversationDetail detail={detail()} />)
    expect(container.textContent).toContain('예약 되나요')
    expect(screen.getByText('참고: 예약표')).toBeTruthy()
    expect(screen.getByText('인스타 → 김민지')).toBeTruthy()
    expect(container.textContent).not.toContain(FP)
  })
  it('진행 가능하면 CTA 가 버전과 함께 검토로 넘기고 aria-describedby 가 없다', () => {
    const go = vi.fn()
    render(<MobileConversationDetail detail={detail()} onProceedToReview={go} />)
    const cta = screen.getByRole('button', { name: '최종 검토로 넘어가기' })
    expect(cta).not.toHaveAttribute('aria-describedby')
    fireEvent.click(cta)
    expect(go).toHaveBeenCalledWith({ threadId: 't1', version: 3 })
  })
  it('권한이 없으면 CTA 는 막히고 복사 대안과 사유 aria-describedby 연결이 제공된다', () => {
    const go = vi.fn()
    render(<MobileConversationDetail detail={detail({ thread: thread({ sendBlockers: ['NO_SEND_SCOPE'] }) })} onProceedToReview={go} />)
    const cta = screen.getByRole('button', { name: '최종 검토로 넘어가기' }) as HTMLButtonElement
    expect(cta.disabled).toBe(true)
    expect(cta).toHaveAttribute('aria-describedby')
    const describedById = cta.getAttribute('aria-describedby')!
    const reasonEl = document.getElementById(describedById)
    expect(reasonEl).toBeTruthy()
    expect(reasonEl?.textContent).toContain('보내기 권한이 연결되지 않았어요')
    expect(cta.title).toContain('보내기 권한이 연결되지 않았어요')
    fireEvent.click(cta)
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '답안 복사' })).toBeTruthy()
  })
  it('열린 뒤 서버 지문이 바뀌면 재검토 안내로 막는다', () => {
    const { rerender } = render(<MobileConversationDetail detail={detail()} />)
    rerender(<MobileConversationDetail detail={detail({ fingerprint: 'c'.repeat(64) })} />)
    expect(screen.getByRole('status').textContent).toContain('다시 확인')
    expect((screen.getByRole('button', { name: '최종 검토로 넘어가기' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('원문 0건을 "대화 없음"으로 단정하지 않고 확인된 원문이 없다고 알린다', () => {
    render(<MobileConversationDetail detail={detail({ messages: [] })} />)
    expect(screen.getByText(/아직 확인된 원문이 없어요/)).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
  it('원문이 있으면 0건 안내를 그리지 않는다', () => {
    render(<MobileConversationDetail detail={detail()} />)
    expect(screen.queryByText(/아직 확인된 원문이 없어요/)).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
  it('서버가 원문을 다 읽지 못했으면(부분) 일부만 불러왔다고 알리고 읽은 원문은 그대로 보여준다', () => {
    render(<MobileConversationDetail detail={detail({ complete: false })} />)
    expect(screen.getByText(/일부 원문만 불러왔어요/)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
  it('완전히 읽은 대화에는 부분 안내를 그리지 않는다', () => {
    render(<MobileConversationDetail detail={detail()} />)
    expect(screen.queryByText(/일부 원문만 불러왔어요/)).toBeNull()
  })
  it('소희 답안 톤 칩에 shrink-0 whitespace-nowrap이 적용된다', () => {
    render(<MobileConversationDetail detail={detail()} />)
    const chip = screen.getByText('아직 보내지 않았어요')
    expect(chip.className).toContain('shrink-0')
    expect(chip.className).toContain('whitespace-nowrap')
  })
})
