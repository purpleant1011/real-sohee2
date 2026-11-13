/**
 * M05 사실 확인 (ANI-1677).
 *
 * 정본: `docs/mobile-r2/01-onboarding-creative-chat.md` §M05
 * - 가격·메뉴/서비스·영업시간·이벤트 기간·연락 방법 중 **누락된 사실만** 묻는다.
 * - 답을 모르면 '해당 정보 없이 진행'을 고른다. 그 선택도 기록되어 다시 묻지 않는다.
 * - 답변은 곧바로 정본이 되지 않는다. '수정 제안 → 사용자 확인'을 거쳐야 `CONFIRMED` 가 된다.
 * - 확인되지 않은 값(`PROPOSED`)은 홍보 문구 생성에 쓰지 않는다(`usableFactValues`).
 *
 * 이 파일은 네트워크를 모른다. 서버 저장·재개는 화면/호출 측 책임이다.
 */

/** 질문 순서. 한 화면 한 질문이므로 이 순서가 곧 질문 순서다. */
export const FACT_FIELDS = ['price', 'menu', 'hours', 'eventPeriod', 'contact'] as const

export type FactField = (typeof FACT_FIELDS)[number]

/** 사용자 화면 질문. 업종 중립 문구를 유지한다. */
export const FACT_QUESTIONS: Record<FactField, string> = {
  price: '이번에 알릴 가격이 정해져 있나요?',
  menu: '이번에 알릴 메뉴나 서비스가 있나요?',
  hours: '영업시간을 알려주실 수 있나요?',
  eventPeriod: '이벤트 기간이 정해져 있나요?',
  contact: '예약이나 문의는 어떻게 받으시나요?',
}

/** 답변 길이 제한(문자). 넘으면 저장하지 않고 화면에서 이유를 보여준다. */
export const FACT_ANSWER_MAX_LENGTH = 120

export type FactStatus = 'CONFIRMED' | 'PROPOSED' | 'SKIPPED'

export interface FactEntry {
  field: FactField
  status: FactStatus
  /** CONFIRMED/PROPOSED 에서만 존재. SKIPPED 는 값이 없다. */
  value?: string
}

export type FactRejectReason = 'EMPTY' | 'TOO_LONG' | 'NO_PROPOSAL' | 'ALREADY_CONFIRMED'

export type FactMutation =
  | { ok: true; state: readonly FactEntry[]; changed: boolean }
  | { ok: false; reason: FactRejectReason }

/** 화면 표기. 영문 상태 코드는 사용자 화면에 나가지 않는다. */
export const FACT_STATUS_LABEL: Record<FactStatus, string> = {
  CONFIRMED: '확인된 기억',
  PROPOSED: '소희의 제안',
  SKIPPED: '이번 홍보에는 쓰지 않음',
}

function ordered(entries: readonly FactEntry[]): readonly FactEntry[] {
  return [...entries].sort((a, b) => FACT_FIELDS.indexOf(a.field) - FACT_FIELDS.indexOf(b.field))
}

export function findFact(state: readonly FactEntry[], field: FactField): FactEntry | undefined {
  return state.find((entry) => entry.field === field)
}

/** 서버가 확인해 준 사업장 기억을 `CONFIRMED` 로 시작한다. 빈 값은 기억이 아니다. */
export function seedConfirmedFacts(memory: Partial<Record<FactField, string>>): readonly FactEntry[] {
  const entries: FactEntry[] = []
  for (const field of FACT_FIELDS) {
    const raw = memory[field]
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (!value) continue
    entries.push({ field, status: 'CONFIRMED', value })
  }
  return entries
}

/** 아직 한 번도 묻지 않은 항목. 확정·제안·건너뜀은 모두 '이미 물은 정보'다. */
export function unaskedFields(state: readonly FactEntry[]): readonly FactField[] {
  return FACT_FIELDS.filter((field) => !findFact(state, field))
}

/** 다음에 물을 항목. 없으면 null. */
export function nextFactField(state: readonly FactEntry[]): FactField | null {
  return unaskedFields(state)[0] ?? null
}

/** 사용자 확인을 기다리는 제안. 있으면 새 질문보다 먼저 확인 화면을 보여준다. */
export function pendingProposal(state: readonly FactEntry[]): FactEntry | null {
  return state.find((entry) => entry.status === 'PROPOSED') ?? null
}

/**
 * 사용자가 답한 값은 정본이 아니라 **수정 제안**이 된다.
 * 이미 확정된 값과 같으면 다시 제안하지 않는다(동일 정보 재확인 없음).
 */
export function submitFactAnswer(state: readonly FactEntry[], field: FactField, raw: string): FactMutation {
  const value = raw.trim()
  if (!value) return { ok: false, reason: 'EMPTY' }
  if (value.length > FACT_ANSWER_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' }

  const current = findFact(state, field)
  if (current?.status === 'CONFIRMED' && current.value === value) {
    return { ok: true, state, changed: false }
  }

  const rest = state.filter((entry) => entry.field !== field)
  return { ok: true, state: ordered([...rest, { field, status: 'PROPOSED', value }]), changed: true }
}

/** 사용자가 제안을 확인해야만 `CONFIRMED` 가 된다. */
export function confirmFact(state: readonly FactEntry[], field: FactField): FactMutation {
  if (findFact(state, field)?.status !== 'PROPOSED') return { ok: false, reason: 'NO_PROPOSAL' }
  return {
    ok: true,
    state: ordered(state.map((entry) => (entry.field === field ? { ...entry, status: 'CONFIRMED' } : entry))),
    changed: true,
  }
}

/** 확인하지 않은 제안을 버린다. 버리면 그 항목은 다시 물을 수 있는 상태가 된다. */
export function discardProposal(state: readonly FactEntry[], field: FactField): FactMutation {
  if (findFact(state, field)?.status !== 'PROPOSED') return { ok: false, reason: 'NO_PROPOSAL' }
  return { ok: true, state: ordered(state.filter((entry) => entry.field !== field)), changed: true }
}

/**
 * '해당 정보 없이 진행'. 이미 확정된 기억은 지우지 않는다.
 * 건너뛴 항목은 다시 묻지 않는다.
 */
export function skipFact(state: readonly FactEntry[], field: FactField): FactMutation {
  const current = findFact(state, field)
  if (current?.status === 'CONFIRMED') return { ok: false, reason: 'ALREADY_CONFIRMED' }
  if (current?.status === 'SKIPPED') return { ok: true, state, changed: false }

  const rest = state.filter((entry) => entry.field !== field)
  return { ok: true, state: ordered([...rest, { field, status: 'SKIPPED' }]), changed: true }
}

/** 모든 항목이 확정 또는 '정보 없이'로 정리되어야 다음 단계로 간다. */
export function canProceed(state: readonly FactEntry[]): boolean {
  return unaskedFields(state).length === 0 && pendingProposal(state) === null
}

/**
 * 홍보 문구에 쓸 수 있는 값 = 사용자가 확인한 것만.
 * 제안 상태의 가격·할인율이 원고로 새어 나가지 않게 하는 경계다.
 */
export function usableFactValues(state: readonly FactEntry[]): Partial<Record<FactField, string>> {
  const values: Partial<Record<FactField, string>> = {}
  for (const entry of state) {
    if (entry.status === 'CONFIRMED' && entry.value) values[entry.field] = entry.value
  }
  return values
}

/** 화면 보조 문구용 집계. 실제 서버 값이 아니라 로컬 진행 상태다. */
export function factProgress(state: readonly FactEntry[]): { confirmed: number; skipped: number; remaining: number } {
  return {
    confirmed: state.filter((entry) => entry.status === 'CONFIRMED').length,
    skipped: state.filter((entry) => entry.status === 'SKIPPED').length,
    remaining: unaskedFields(state).length,
  }
}
