import { RECOVERY_STAGES, type RecoveryStage, type RecoveryView } from '@/features/booking-recovery/contracts'
import type { BookingTimeline, NextAction, StepState, TimelineStep } from './booking-timeline-model'

/**
 * 예약 회수 읽기 계약(`RecoveryView`)을 M14 타임라인으로 옮기는 어댑터.
 *
 * `BookingInquiryDto` 로 되돌리지 않는 이유: 그 DTO 는 승인 시각 같은 사실을 요구하는데
 * `RecoveryView` 에는 없고, 없는 시각을 만들어 넣으면 '확인된 척'이 된다.
 * 대신 서버 상태기계(`RECOVERY_STAGES`)를 그대로 단계로 옮긴다.
 */

type StepStates = readonly [StepState, StepState, StepState, StepState, StepState]

/** 단계 순서: 시간 후보 · 사장님 확인 · 고객에게 안내 · 고객 수락 · 예약표 확정. */
const STAGE_STEPS: Readonly<Record<RecoveryStage, StepStates>> = {
  DISCOVERED: ['current', 'todo', 'todo', 'todo', 'todo'],
  NEEDS_CONTEXT: ['current', 'todo', 'todo', 'todo', 'todo'],
  DRAFT_READY: ['done', 'current', 'todo', 'todo', 'todo'],
  AWAITING_SEND_APPROVAL: ['done', 'current', 'todo', 'todo', 'todo'],
  SEND_REQUESTED: ['done', 'done', 'waiting', 'todo', 'todo'],
  PROVIDER_ACCEPTED: ['done', 'done', 'waiting', 'todo', 'todo'],
  SEND_VERIFIED: ['done', 'done', 'done', 'waiting', 'todo'],
  AWAITING_CUSTOMER: ['done', 'done', 'done', 'waiting', 'todo'],
  CUSTOMER_ACCEPTED: ['done', 'done', 'done', 'done', 'waiting'],
  AWAITING_BOOKING_APPROVAL: ['done', 'done', 'done', 'done', 'current'],
  BOOKING_CONFIRMED: ['done', 'done', 'done', 'done', 'done'],
  RESULT_UNKNOWN: ['done', 'done', 'problem', 'todo', 'todo'],
  NEEDS_RECONCILIATION: ['done', 'done', 'problem', 'todo', 'todo'],
  HUMAN_REVIEW: ['done', 'problem', 'todo', 'todo', 'todo'],
  BLOCKED: ['done', 'problem', 'todo', 'todo', 'todo'],
  DECLINED: ['done', 'done', 'done', 'problem', 'todo'],
  EXPIRED: ['problem', 'todo', 'todo', 'todo', 'todo'],
}

const STAGE_HEADLINE: Readonly<Record<RecoveryStage, string>> = {
  DISCOVERED: '문의만 받은 상태예요',
  NEEDS_CONTEXT: '가능한 시간을 확인해야 해요',
  DRAFT_READY: '사장님 확인이 필요해요',
  AWAITING_SEND_APPROVAL: '사장님 확인이 필요해요',
  SEND_REQUESTED: '고객에게 안내를 보내는 중이에요',
  PROVIDER_ACCEPTED: '도착 확인을 기다려요',
  SEND_VERIFIED: '고객 답을 기다려요',
  AWAITING_CUSTOMER: '고객 답을 기다려요',
  CUSTOMER_ACCEPTED: '예약표 반영을 확인하고 있어요',
  AWAITING_BOOKING_APPROVAL: '예약 확정 확인이 필요해요',
  BOOKING_CONFIRMED: '예약 확정을 확인하고 있어요',
  RESULT_UNKNOWN: '전송 상태를 확인해야 해요',
  NEEDS_RECONCILIATION: '상태를 다시 맞추는 중이에요',
  HUMAN_REVIEW: '직접 확인이 필요해요',
  BLOCKED: '지금은 진행할 수 없어요',
  DECLINED: '다른 시간을 정해야 해요',
  EXPIRED: '시간 후보가 만료됐어요',
}

interface StageDetail {
  candidates?: string
  approval?: string
  send?: string
  customer?: string
  ledger?: string
}

const STAGE_DETAIL: Readonly<Partial<Record<RecoveryStage, StageDetail>>> = {
  SEND_REQUESTED: { send: '고객에게 보내는 중이에요' },
  PROVIDER_ACCEPTED: { send: '전송은 접수됐고 도착 확인을 기다려요' },
  SEND_VERIFIED: { customer: '고객 답을 기다려요' },
  AWAITING_CUSTOMER: { customer: '고객 답을 기다려요' },
  CUSTOMER_ACCEPTED: { ledger: '예약표에 반영됐는지 확인 중이에요' },
  RESULT_UNKNOWN: { send: '보냈는지 확인하지 못했어요' },
  NEEDS_RECONCILIATION: { send: '전송 결과를 다시 맞추는 중이에요' },
  DECLINED: { customer: '고객이 다른 시간을 원해요' },
  EXPIRED: { candidates: '시간 후보가 만료됐어요' },
}

/** 서버 `nextAction` → 화면 CTA. 어휘가 다르므로 해석을 코드 한 곳에 고정하고 테스트로 잠근다. */
export const SERVER_NEXT_ACTION: Readonly<Record<NonNullable<RecoveryView['nextAction']>, NextAction | null>> = {
  prepare_reply: { kind: 'propose', label: '시간 후보 정하기' },
  approve_send: { kind: 'send_review', label: '보낼 답변 검토하기' },
  confirm_acceptance: { kind: 'check_acceptance', label: '고객 수락 확인하기' },
  reattest_schedule: { kind: 'recheck_schedule', label: '일정 다시 확인하기' },
  approve_booking: { kind: 'approve', label: '예약 확정 검토하기' },
  // 사람이 직접 봐야 하는 상태다. 화면에서 자동 CTA 를 만들지 않는다.
  review: null,
}

const NEXT_ACTIONS = Object.keys(SERVER_NEXT_ACTION) as ReadonlyArray<NonNullable<RecoveryView['nextAction']>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 슬롯 시각 표기. 가게 시간대가 있으면 그 기준, 없으면 기기 시간대(표기를 지어내지 않는다). */
function formatSlot(iso: string, timeZone?: string): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone,
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(at)
  } catch {
    return null
  }
}

function slotLabel(view: RecoveryView): string {
  const slot = view.offer ?? view.proposal
  if (!slot) return ''
  const when = formatSlot(slot.startsAt, view.offer?.timezone)
  return when ? `${slot.serviceName} · ${when}` : slot.serviceName
}

/**
 * 서버 계약을 확인한다. 다른 케이스 응답·알 수 없는 단계는 그리지 않고 실패로 다룬다.
 * `workspaceId` 는 `RecoveryView` 에 없으므로 경로 파라미터와 `caseId` 일치로만 검증한다.
 */
export function isRecoveryCaseResponse(value: unknown, caseId: string): value is { case: RecoveryView } {
  if (!isRecord(value)) return false
  const v = value.case
  if (!isRecord(v)) return false
  if (v.caseId !== caseId) return false
  if (typeof v.stage !== 'string' || !(RECOVERY_STAGES as readonly string[]).includes(v.stage)) return false
  if (typeof v.statusLabel !== 'string' || typeof v.observedAt !== 'string') return false
  if (typeof v.sourceThreadId !== 'string' || !v.sourceThreadId) return false
  if (v.nextAction != null && !(NEXT_ACTIONS as readonly string[]).includes(v.nextAction as string)) return false
  if (v.reply != null && !(isRecord(v.reply) && typeof v.reply.text === 'string' && typeof v.reply.fingerprint === 'string')) {
    return false
  }
  if (v.booking != null && !(isRecord(v.booking) && typeof v.booking.id === 'string' && typeof v.booking.confirmedAt === 'string')) {
    return false
  }
  if (v.offer != null && !isRecord(v.offer)) return false
  if (v.proposal != null && !isRecord(v.proposal)) return false
  // 수락 근거(고객 답변 메시지)는 서버가 확인한 참조와 시각이 함께 있어야 쓴다.
  if (v.acceptance != null) {
    if (!isRecord(v.acceptance)) return false
    if (typeof v.acceptance.inboundMessageId !== 'string' || !v.acceptance.inboundMessageId) return false
    if (typeof v.acceptance.receivedAt !== 'string' || Number.isNaN(Date.parse(v.acceptance.receivedAt))) return false
  }
  return true
}

/**
 * 서버 단계 → 타임라인. 단계는 '주장'이 아니라 서버 상태기계에서만 오고,
 * 확정 표현은 예약 행이 실제로 있을 때만 나온다(fail-closed).
 */
export function recoveryTimeline(view: RecoveryView): BookingTimeline {
  const slot = view.offer ?? view.proposal ?? null
  const candidates = slot ? [{ id: slot.slotId, label: slotLabel(view) }] : []
  const base = STAGE_STEPS[view.stage] ?? STAGE_STEPS.DISCOVERED
  // 후보 시간 근거가 없으면 '후보 정함'으로 그리지 않는다.
  const candidatesState: StepState = !slot && base[0] === 'done' ? 'current' : base[0]
  const states: StepStates = [candidatesState, base[1], base[2], base[3], base[4]]
  const detail = STAGE_DETAIL[view.stage] ?? {}
  /**
   * 고객 수락 시각은 서버가 '확인된 인바운드 메시지'로 내려준 값(`acceptance`)으로만 쓴다.
   * 수락 전 단계인데 값이 오면 화면에 쓰지 않는다(낙관적 확정 금지, fail-closed).
   */
  const acceptedAt = states[3] === 'done' && view.acceptance
    ? formatSlot(view.acceptance.receivedAt, view.offer?.timezone)
    : null

  const steps: TimelineStep[] = [
    { id: 'inquiry', label: '문의 받음', state: 'done', detail: null },
    {
      id: 'candidates',
      label: '시간 후보',
      state: states[0],
      detail: detail.candidates ?? (candidates.length ? candidates.map((c) => c.label).join(' · ') : null),
    },
    { id: 'approval', label: '사장님 확인', state: states[1], detail: detail.approval ?? null },
    { id: 'send', label: '고객에게 안내', state: states[2], detail: detail.send ?? null },
    {
      id: 'customer',
      label: '고객 수락',
      state: states[3],
      detail: detail.customer ?? (acceptedAt ? `${acceptedAt}에 고객이 수락했어요` : null),
    },
    { id: 'ledger', label: '예약표 확정', state: states[4], detail: detail.ledger ?? null },
  ]

  // 예약금은 금액이 확인된 경우에만, 고객 수락 뒤에만 단계로 만든다.
  const depositKrw = view.proposal?.depositKrw ?? view.offer?.depositKrw ?? null
  if (depositKrw !== null && depositKrw > 0 && states[3] === 'done') {
    steps.push({ id: 'deposit', label: '예약금 안내', state: 'todo', detail: '이 예약은 예약금이 필요해요' })
  }

  const confirmed =
    view.stage === 'BOOKING_CONFIRMED' && view.booking !== null && view.booking.status !== 'CANCELLED'
  const headline = confirmed ? '예약이 확정됐어요' : STAGE_HEADLINE[view.stage] ?? '진행 상황을 확인하고 있어요'
  const next = view.nextAction ? SERVER_NEXT_ACTION[view.nextAction] ?? null : null

  return { steps, next, confirmed, headline }
}
