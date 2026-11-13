export type SendState = 'none' | 'accepted' | 'verified' | 'failed' | 'unknown'
export type CustomerResponse = 'none' | 'accepted' | 'declined'
export type LedgerState = 'none' | 'verified' | 'unknown'

export interface BookingInquiryDto {
  id: string
  workspaceId: string
  customerName: string
  inquiryText: string
  receivedAt: string
  /** 소희가 제안한 시간 후보. 비어 있으면 아직 후보가 없다. */
  candidates: Array<{ id: string; label: string }>
  /** 대표가 후보+문안을 승인한 시각. 없으면 미승인. */
  approvedAt: string | null
  send: SendState
  customerResponse: CustomerResponse
  ledger: LedgerState
  /** 예약금이 필수인 가게·시술일 때만 true. false/null 이면 입금 안내를 만들지 않는다. */
  depositRequired: boolean | null
}

export type StepState = 'done' | 'current' | 'waiting' | 'todo' | 'problem'
export interface TimelineStep { id: string; label: string; state: StepState; detail: string | null }
export type NextActionKind =
  | 'propose' | 'approve' | 'send_review' | 'recheck_send' | 'repropose'
  // 서버 nextAction 어휘(예약 회수)와 1:1 로 대응하는 항목. 화면에서 임의로 해석하지 않는다.
  | 'check_acceptance' | 'recheck_schedule'
export interface NextAction { kind: NextActionKind; label: string }

export interface BookingTimeline {
  steps: TimelineStep[]
  /** 지금 사용자가 할 일 1개. 기다리는 단계면 null. */
  next: NextAction | null
  /** 고객 수락 + 예약표 readback 이 모두 확인된 경우에만 true. 이것이 true 일 때만 '예약 확정' 표현을 쓴다. */
  confirmed: boolean
  headline: string
}

/** 같은 webhook 이 두 번 와도 이벤트 키 하나로 접는다(중복 예약 0). */
export function dedupeByKey<T extends { key: string }>(events: T[]): T[] {
  const seen = new Set<string>()
  return events.filter(e => (seen.has(e.key) ? false : (seen.add(e.key), true)))
}

/**
 * 단계는 '주장'이 아니라 사실 필드에서만 계산한다. 근거 없는 단계는 완료로 그리지 않는다(fail-closed).
 */
export function buildTimeline(b: BookingInquiryDto): BookingTimeline {
  const hasCandidates = b.candidates.length > 0
  const approved = b.approvedAt !== null && hasCandidates
  const delivered = approved && b.send === 'verified'
  const accepted = delivered && b.customerResponse === 'accepted'
  const confirmed = accepted && b.ledger === 'verified'

  const steps: TimelineStep[] = []
  steps.push({ id: 'inquiry', label: '문의 받음', state: 'done', detail: null })

  steps.push({
    id: 'candidates', label: '시간 후보', detail: hasCandidates ? b.candidates.map(c => c.label).join(' · ') : null,
    state: hasCandidates ? 'done' : 'current',
  })

  steps.push({
    id: 'approval', label: '사장님 확인',
    state: approved ? 'done' : hasCandidates ? 'current' : 'todo', detail: null,
  })

  let sendState: StepState = 'todo'
  let sendDetail: string | null = null
  if (approved) {
    if (b.send === 'verified') sendState = 'done'
    else if (b.send === 'accepted') { sendState = 'waiting'; sendDetail = '전송은 접수됐고 도착 확인을 기다려요' }
    else if (b.send === 'failed') { sendState = 'problem'; sendDetail = '보내지 못했어요' }
    else if (b.send === 'unknown') { sendState = 'problem'; sendDetail = '보냈는지 확인하지 못했어요' }
    else sendState = 'current'
  }
  steps.push({ id: 'send', label: '고객에게 안내', state: sendState, detail: sendDetail })

  let respState: StepState = 'todo'
  let respDetail: string | null = null
  if (delivered) {
    if (b.customerResponse === 'accepted') respState = 'done'
    else if (b.customerResponse === 'declined') { respState = 'problem'; respDetail = '고객이 다른 시간을 원해요' }
    else { respState = 'waiting'; respDetail = '고객 답을 기다려요' }
  }
  steps.push({ id: 'customer', label: '고객 수락', state: respState, detail: respDetail })

  let ledgerState: StepState = 'todo'
  let ledgerDetail: string | null = null
  if (accepted) {
    if (b.ledger === 'verified') ledgerState = 'done'
    else if (b.ledger === 'unknown') { ledgerState = 'problem'; ledgerDetail = '예약표 반영을 확인하지 못했어요' }
    else { ledgerState = 'waiting'; ledgerDetail = '예약표에 반영됐는지 확인 중이에요' }
  }
  steps.push({ id: 'ledger', label: '예약표 확정', state: ledgerState, detail: ledgerDetail })

  // 입금 안내는 예약금이 필수로 확인된 경우에만. 그 외에는 단계 자체를 만들지 않는다.
  if (b.depositRequired === true && accepted) {
    steps.push({ id: 'deposit', label: '예약금 안내', state: 'todo', detail: '이 예약은 예약금이 필요해요' })
  }

  let next: NextAction | null = null
  let headline: string
  if (confirmed) headline = '예약이 확정됐어요'
  else if (!hasCandidates) { next = { kind: 'propose', label: '시간 후보 정하기' }; headline = '문의만 받은 상태예요' }
  else if (!approved) { next = { kind: 'approve', label: '후보 시간 검토하기' }; headline = '사장님 확인이 필요해요' }
  else if (b.send === 'none') { next = { kind: 'send_review', label: '보내기 전 검토하기' }; headline = '고객에게 보낼 차례예요' }
  else if (b.send === 'failed' || b.send === 'unknown') { next = { kind: 'recheck_send', label: '전송 상태 다시 확인' }; headline = '전송 상태를 확인해야 해요' }
  else if (b.send === 'accepted') headline = '도착 확인을 기다려요'
  else if (b.customerResponse === 'declined') { next = { kind: 'repropose', label: '다른 시간 후보 정하기' }; headline = '다른 시간을 정해야 해요' }
  else if (b.customerResponse === 'none') headline = '고객 답을 기다려요'
  else headline = '예약표 반영을 확인하고 있어요'

  return { steps, next, confirmed, headline }
}
