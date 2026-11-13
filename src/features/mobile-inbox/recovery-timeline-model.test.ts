import { describe, expect, it } from 'vitest'
import type { RecoveryView } from '@/features/booking-recovery/contracts'
import { isRecoveryCaseResponse, recoveryTimeline, SERVER_NEXT_ACTION } from './recovery-timeline-model'

const CASE_ID = '11111111-1111-4111-8111-111111111111'
const THREAD_ID = '22222222-2222-4222-8222-222222222222'

function view(overrides: Partial<RecoveryView> = {}): RecoveryView {
  return {
    caseId: CASE_ID,
    missionId: '33333333-3333-4333-8333-333333333333',
    version: 1,
    stage: 'DISCOVERED',
    statusLabel: '신규 문의 접수',
    sourceThreadId: THREAD_ID,
    sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-10-23T05:00:00.000Z',
    reply: null,
    offer: null,
    acceptance: null,
    approval: null,
    proposal: null,
    booking: null,
    nextAction: 'prepare_reply',
    revenue: { status: 'NOT_OBSERVED', amountKrw: null },
    ...overrides,
  }
}

const PROPOSAL: RecoveryView['proposal'] = {
  revision: 2,
  serviceId: 'svc-1',
  serviceName: '속눈썹펌',
  totalAmountKrw: 80000,
  depositKrw: 0,
  slotId: 'slot-1',
  startsAt: '2026-10-24T06:00:00.000Z',
  endsAt: '2026-10-24T07:00:00.000Z',
}

describe('recoveryTimeline', () => {
  it('문의만 있으면 후보·확정 표현이 없고 다음 행동은 준비 1개', () => {
    const t = recoveryTimeline(view())
    expect(t.confirmed).toBe(false)
    expect(t.headline).toBe('문의만 받은 상태예요')
    expect(t.next?.kind).toBe('propose')
    expect(t.steps.find((s) => s.id === 'candidates')?.state).toBe('current')
    expect(t.steps.find((s) => s.id === 'ledger')?.state).toBe('todo')
  })

  it('후보 슬롯이 없으면 단계가 done 이어도 후보를 완료로 그리지 않는다', () => {
    // DRAFT_READY 는 후보가 있다는 전제의 단계다. 근거가 없으면 fail-closed.
    const t = recoveryTimeline(view({ stage: 'DRAFT_READY' }))
    expect(t.steps.find((s) => s.id === 'candidates')?.state).toBe('current')
  })

  it('제안 슬롯이 있으면 후보 1개로 표기하고 시각을 붙인다', () => {
    const t = recoveryTimeline(
      view({ stage: 'AWAITING_SEND_APPROVAL', proposal: PROPOSAL, nextAction: 'approve_send' }),
    )
    const detail = t.steps.find((s) => s.id === 'candidates')?.detail
    expect(detail).toContain('속눈썹펌')
    expect(t.steps.find((s) => s.id === 'approval')?.state).toBe('current')
    expect(t.next?.kind).toBe('send_review')
  })

  it('접수만 된 전송은 완료가 아니라 기다림이고 고객 단계는 아직이다', () => {
    const t = recoveryTimeline(view({ stage: 'PROVIDER_ACCEPTED', proposal: PROPOSAL, nextAction: 'confirm_acceptance' }))
    expect(t.steps.find((s) => s.id === 'send')?.state).toBe('waiting')
    expect(t.steps.find((s) => s.id === 'customer')?.state).toBe('todo')
    expect(t.confirmed).toBe(false)
  })

  it('고객 수락만으로는 확정이 아니고 예약 행이 있어야 확정이다', () => {
    const accepted = view({ stage: 'CUSTOMER_ACCEPTED', proposal: PROPOSAL, nextAction: 'approve_booking' })
    expect(recoveryTimeline(accepted).confirmed).toBe(false)
    expect(recoveryTimeline(accepted).headline).not.toContain('확정됐어요')

    const confirmed = view({
      stage: 'BOOKING_CONFIRMED',
      proposal: PROPOSAL,
      booking: { id: 'b1', confirmedAt: '2026-10-24T08:00:00.000Z', status: 'CONFIRMED' },
      nextAction: null,
    })
    expect(recoveryTimeline(confirmed).confirmed).toBe(true)
    expect(recoveryTimeline(confirmed).headline).toBe('예약이 확정됐어요')
  })

  it('예약 행이 취소됐거나 없으면 BOOKING_CONFIRMED 라도 확정 표현을 쓰지 않는다', () => {
    const noBooking = view({ stage: 'BOOKING_CONFIRMED', proposal: PROPOSAL, booking: null, nextAction: null })
    expect(recoveryTimeline(noBooking).confirmed).toBe(false)
    expect(recoveryTimeline(noBooking).headline).toBe('예약 확정을 확인하고 있어요')

    const cancelled = view({
      stage: 'BOOKING_CONFIRMED',
      proposal: PROPOSAL,
      booking: { id: 'b1', confirmedAt: '2026-10-24T08:00:00.000Z', status: 'CANCELLED' },
      nextAction: null,
    })
    expect(recoveryTimeline(cancelled).confirmed).toBe(false)
  })

  it('예약금이 0이거나 없으면 입금 단계를 만들지 않고, 금액이 확인된 수락 건에만 만든다', () => {
    const accepted = { stage: 'CUSTOMER_ACCEPTED' as const, nextAction: 'approve_booking' as const }
    expect(
      recoveryTimeline(view({ ...accepted, proposal: PROPOSAL })).steps.some((s) => s.id === 'deposit'),
    ).toBe(false)
    expect(
      recoveryTimeline(view({ ...accepted, proposal: { ...PROPOSAL, depositKrw: 20000 } })).steps.some(
        (s) => s.id === 'deposit',
      ),
    ).toBe(true)
    // 고객 수락 전에는 금액이 있어도 입금 단계를 만들지 않는다.
    expect(
      recoveryTimeline(
        view({ stage: 'SEND_VERIFIED', proposal: { ...PROPOSAL, depositKrw: 20000 }, nextAction: null }),
      ).steps.some((s) => s.id === 'deposit'),
    ).toBe(false)
  })

  it('전송 결과 불명·거절은 확인 필요로 남고 다음 행동이 다르다', () => {
    const unknown = recoveryTimeline(view({ stage: 'RESULT_UNKNOWN', proposal: PROPOSAL, nextAction: 'reattest_schedule' }))
    expect(unknown.steps.find((s) => s.id === 'send')?.state).toBe('problem')
    expect(unknown.next?.kind).toBe('recheck_schedule')

    const declined = recoveryTimeline(view({ stage: 'DECLINED', proposal: PROPOSAL, nextAction: 'prepare_reply' }))
    expect(declined.steps.find((s) => s.id === 'customer')?.state).toBe('problem')
  })

  it('고객 수락 시각은 서버가 확인한 인바운드 메시지(acceptance)로만 표기한다', () => {
    const accepted = recoveryTimeline(
      view({
        stage: 'CUSTOMER_ACCEPTED',
        proposal: PROPOSAL,
        nextAction: 'approve_booking',
        acceptance: { inboundMessageId: 'm9', receivedAt: '2026-10-24T05:30:00.000Z' },
      }),
    )
    const detail = accepted.steps.find((s) => s.id === 'customer')?.detail
    expect(detail).toContain('고객이 수락했어요')
    expect(detail).toContain('10')
  })

  it('수락 근거가 없으면 수락 시각을 만들지 않고, 수락 전 단계에 값이 와도 쓰지 않는다', () => {
    const noEvidence = recoveryTimeline(
      view({ stage: 'CUSTOMER_ACCEPTED', proposal: PROPOSAL, nextAction: 'approve_booking' }),
    )
    expect(noEvidence.steps.find((s) => s.id === 'customer')?.detail).toBeNull()

    // 서버 단계가 아직 수락 전인데 acceptance 가 오면 그리지 않는다(낙관적 확정 금지).
    const early = recoveryTimeline(
      view({
        stage: 'AWAITING_CUSTOMER',
        proposal: PROPOSAL,
        nextAction: null,
        acceptance: { inboundMessageId: 'm9', receivedAt: '2026-10-24T05:30:00.000Z' },
      }),
    )
    expect(early.steps.find((s) => s.id === 'customer')?.detail).toBe('고객 답을 기다려요')
  })

  it('사람이 직접 봐야 하는 상태에는 자동 CTA 를 만들지 않는다', () => {
    expect(SERVER_NEXT_ACTION.review).toBeNull()
    expect(recoveryTimeline(view({ stage: 'HUMAN_REVIEW', nextAction: 'review' })).next).toBeNull()
    expect(recoveryTimeline(view({ stage: 'BLOCKED', nextAction: null })).next).toBeNull()
  })

  it('서버 nextAction 표는 여섯 가지를 모두 덮는다', () => {
    expect(Object.keys(SERVER_NEXT_ACTION).sort()).toEqual(
      ['approve_booking', 'approve_send', 'confirm_acceptance', 'prepare_reply', 'reattest_schedule', 'review'].sort(),
    )
  })
})

describe('isRecoveryCaseResponse', () => {
  it('케이스 id 가 다르거나 단계를 모르면 그리지 않는다', () => {
    expect(isRecoveryCaseResponse({ case: view() }, CASE_ID)).toBe(true)
    expect(isRecoveryCaseResponse({ case: view() }, 'other')).toBe(false)
    expect(isRecoveryCaseResponse({ case: view({ stage: 'MADE_UP' as never }) }, CASE_ID)).toBe(false)
    expect(isRecoveryCaseResponse({}, CASE_ID)).toBe(false)
    expect(isRecoveryCaseResponse(null, CASE_ID)).toBe(false)
  })

  it('알 수 없는 nextAction 은 계약 위반으로 본다', () => {
    expect(isRecoveryCaseResponse({ case: view({ nextAction: 'ship_it' as never }) }, CASE_ID)).toBe(false)
  })

  it('수락 근거가 불완전하면 케이스 응답 전체를 계약 위반으로 본다', () => {
    const caseOf = (acceptance: unknown) => ({ case: { ...view(), acceptance } })
    expect(isRecoveryCaseResponse(caseOf({ inboundMessageId: '', receivedAt: '2026-10-24T05:30:00.000Z' }), CASE_ID)).toBe(false)
    expect(isRecoveryCaseResponse(caseOf({ inboundMessageId: 'm9', receivedAt: '언젠가' }), CASE_ID)).toBe(false)
    expect(isRecoveryCaseResponse(caseOf('accepted'), CASE_ID)).toBe(false)
    expect(isRecoveryCaseResponse(caseOf({ inboundMessageId: 'm9', receivedAt: '2026-10-24T05:30:00.000Z' }), CASE_ID)).toBe(true)
  })
})
