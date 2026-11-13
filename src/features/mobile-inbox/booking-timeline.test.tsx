// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileBookingTimeline } from './booking-timeline-view'
import { buildTimeline, dedupeByKey, type BookingInquiryDto } from './booking-timeline-model'

function inq(o: Partial<BookingInquiryDto> = {}): BookingInquiryDto {
  return {
    id: 'b1', workspaceId: 'ws', customerName: '김민지', inquiryText: '목요일 오후 가능한가요?', receivedAt: '2026-10-22T05:00:00Z',
    candidates: [], approvedAt: null, send: 'none', customerResponse: 'none', ledger: 'none', depositRequired: null, ...o,
  }
}
const CAND = [{ id: 'c1', label: '목 오후 2시' }]
const APPROVED = { candidates: CAND, approvedAt: '2026-10-22T06:00:00Z' }

describe('buildTimeline', () => {
  it('문의만 있으면 확정 표현이 없고 다음 행동은 후보 정하기 1개', () => {
    const t = buildTimeline(inq())
    expect(t.confirmed).toBe(false)
    expect(t.next?.kind).toBe('propose')
    expect(t.steps.find(s => s.id === 'ledger')?.state).toBe('todo')
  })
  it('승인 전에는 보내기로 못 간다', () => {
    expect(buildTimeline(inq({ candidates: CAND })).next?.kind).toBe('approve')
  })
  it('접수만 된 전송은 완료가 아니라 기다림', () => {
    const t = buildTimeline(inq({ ...APPROVED, send: 'accepted' }))
    expect(t.steps.find(s => s.id === 'send')?.state).toBe('waiting')
    expect(t.next).toBeNull()
    expect(t.steps.find(s => s.id === 'customer')?.state).toBe('todo')
  })
  it('전달 확인 없이 고객 수락 값이 와도 수락·확정으로 그리지 않는다', () => {
    const t = buildTimeline(inq({ ...APPROVED, send: 'accepted', customerResponse: 'accepted', ledger: 'verified' }))
    expect(t.confirmed).toBe(false)
  })
  it('고객 수락만으로는 확정이 아니고 예약표 확인이 있어야 한다', () => {
    const base = { ...APPROVED, send: 'verified' as const, customerResponse: 'accepted' as const }
    expect(buildTimeline(inq({ ...base, ledger: 'none' })).confirmed).toBe(false)
    expect(buildTimeline(inq({ ...base, ledger: 'unknown' })).steps.find(s => s.id === 'ledger')?.state).toBe('problem')
    expect(buildTimeline(inq({ ...base, ledger: 'verified' })).confirmed).toBe(true)
  })
  it('예약금이 필수가 아니면 입금 단계를 만들지 않는다', () => {
    const base = { ...APPROVED, send: 'verified' as const, customerResponse: 'accepted' as const, ledger: 'verified' as const }
    expect(buildTimeline(inq({ ...base, depositRequired: false })).steps.some(s => s.id === 'deposit')).toBe(false)
    expect(buildTimeline(inq({ ...base, depositRequired: null })).steps.some(s => s.id === 'deposit')).toBe(false)
    expect(buildTimeline(inq({ ...base, depositRequired: true })).steps.some(s => s.id === 'deposit')).toBe(true)
  })
  it('전송 실패·불명은 재확인 1개, 고객 거절은 다른 후보', () => {
    expect(buildTimeline(inq({ ...APPROVED, send: 'unknown' })).next?.kind).toBe('recheck_send')
    expect(buildTimeline(inq({ ...APPROVED, send: 'verified', customerResponse: 'declined' })).next?.kind).toBe('repropose')
  })
  it('같은 webhook 이벤트 키는 한 번만 센다', () => {
    expect(dedupeByKey([{ key: 'a' }, { key: 'a' }, { key: 'b' }])).toHaveLength(2)
  })
})

describe('MobileBookingTimeline', () => {
  it('문의만 한 상태에서 확정 문구와 입금 문구가 없다', () => {
    const { container } = render(<MobileBookingTimeline inquiry={inq({ depositRequired: false })} />)
    expect(container.textContent).not.toContain('확정됐어요')
    expect(container.textContent).not.toContain('입금')
    expect(container.textContent).not.toContain('예약금')
  })
  it('다음 행동 버튼은 하나이고 누르면 종류를 넘긴다', () => {
    const go = vi.fn()
    render(<MobileBookingTimeline inquiry={inq({ candidates: CAND })} onNext={go} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '후보 시간 검토하기' }))
    expect(go).toHaveBeenCalledWith({ inquiryId: 'b1', kind: 'approve' })
  })
  it('확정은 전체 근거가 있을 때만 보인다', () => {
    render(<MobileBookingTimeline inquiry={inq({ ...APPROVED, send: 'verified', customerResponse: 'accepted', ledger: 'verified' })} />)
    expect(screen.getByRole('status').textContent).toBe('예약이 확정됐어요')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
