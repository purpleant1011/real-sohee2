import type { MemoryItem } from './credit-model'

/**
 * M22(ANI-1709) 우리 가게 기억 — 확정/추측/변경 제안 승인 계약.
 * 승인 전 제안값은 외부 문구·고객 답변에 쓰지 않는다. 출처와 업데이트 시각을 항상 함께 보여준다.
 */

export type MemoryKind = 'price' | 'service' | 'policy' | 'hours' | 'other'
export type MemoryOrigin = 'owner_stated' | 'from_source' | 'sohee_inferred'

export interface MemoryCandidate {
  key: string
  kind: MemoryKind
  proposalId: string
  proposedValue: string
  /** 현재 확정된 값. 없으면 null. */
  currentValue: string | null
  origin: MemoryOrigin
  source: { label: string; href: string | null; observedAt: string } | null
  customerVisible: boolean
}

export type MemoryKindLabel = 'confirmed' | 'inferred' | 'change_proposal'

export const MEMORY_KIND_LABEL: Record<MemoryKindLabel, string> = {
  confirmed: '확정된 기억',
  inferred: '소희 추측',
  change_proposal: '변경 제안',
}

export const MEMORY_FIELD_LABEL: Record<MemoryKind, string> = {
  price: '가격',
  service: '서비스',
  policy: '이용 규칙',
  hours: '영업시간',
  other: '가게 정보',
}

/** 기존 확정값과 다르면 변경 제안, 출처 없이 소희가 만든 값이면 추측. */
export function classifyMemory(candidate: MemoryCandidate): MemoryKindLabel {
  if (candidate.currentValue !== null && candidate.currentValue !== candidate.proposedValue) return 'change_proposal'
  if (candidate.origin === 'sohee_inferred') return 'inferred'
  return 'confirmed'
}

export type MemoryBlockerCode =
  | 'missing_source'
  | 'empty_value'
  | 'inferred_not_customer_visible'
  | 'value_conflict'

export interface MemoryBlocker {
  code: MemoryBlockerCode
  message: string
  next: string | null
}

export interface MemoryReadiness {
  allowed: boolean
  requiresReconfirm: boolean
  blockers: MemoryBlocker[]
}

/** 승인 전 확인. 상충 값은 사장님이 다시 확인해야 승인된다. */
export function memoryReadiness(candidate: MemoryCandidate, options: { reconfirmed?: boolean } = {}): MemoryReadiness {
  const blockers: MemoryBlocker[] = []
  if (!candidate.proposedValue.trim()) blockers.push({ code: 'empty_value', message: '새 값이 비어 있어요', next: '값 입력' })
  if (!candidate.source || !candidate.source.label.trim()) {
    blockers.push({ code: 'missing_source', message: '정보 출처를 확인하지 못했어요', next: '출처 입력' })
  }
  const label = classifyMemory(candidate)
  if (label === 'inferred' && candidate.customerVisible) {
    blockers.push({ code: 'inferred_not_customer_visible', message: '소희 추측은 고객 안내에 쓸 수 없어요', next: '사장님 확인 필요' })
  }
  const requiresReconfirm = label === 'change_proposal'
  if (requiresReconfirm && !options.reconfirmed) {
    blockers.push({ code: 'value_conflict', message: `기존 ${MEMORY_FIELD_LABEL[candidate.kind]} 정보와 달라요`, next: '기존 값과 비교해 확인' })
  }
  return { allowed: blockers.length === 0, requiresReconfirm, blockers }
}

export interface MemoryPreview {
  fieldLabel: string
  kind: MemoryKindLabel
  kindLabel: string
  currentValue: string | null
  proposedValue: string
  sourceLabel: string | null
  observedAt: string | null
  customerVisible: boolean
  impactNote: string | null
}

/** 승인 화면에 그대로 쓰는 문구. 출처·업데이트 시각·발행 영향을 함께 보여준다. */
export function memoryPreview(candidate: MemoryCandidate): MemoryPreview {
  const kind = classifyMemory(candidate)
  const impact =
    candidate.kind === 'price' ? '가격이 바뀌면 발행 예정 문구와 가격표를 다시 확인해야 해요'
    : candidate.kind === 'policy' ? '이용 규칙이 바뀌면 예약 안내와 환불 안내를 다시 확인해야 해요'
    : candidate.kind === 'hours' ? '영업시간이 바뀌면 예약 가능 시간과 자동 답변이 함께 바뀌어요'
    : null
  return {
    fieldLabel: MEMORY_FIELD_LABEL[candidate.kind],
    kind,
    kindLabel: MEMORY_KIND_LABEL[kind],
    currentValue: candidate.currentValue,
    proposedValue: candidate.proposedValue,
    sourceLabel: candidate.source?.label ?? null,
    observedAt: candidate.source?.observedAt ?? null,
    customerVisible: candidate.customerVisible,
    impactNote: impact,
  }
}

export interface AppliedApproval {
  /** 실제로 확정 기억이 됐는지. false 면 items 는 넘긴 그대로다. */
  applied: boolean
  items: MemoryItem[]
  superseded: { key: string; previousValue: string } | null
  /** applied=false 인 이유. 화면이 승인 버튼을 잠그는 것과 같은 판정을 여기서도 쓴다. */
  blockers: MemoryBlocker[]
}

/**
 * 승인 반영. 기존 값은 덮어쓰되 무엇이 대체됐는지 돌려준다.
 *
 * 화면이 승인 버튼을 잠그는 판정(memoryReadiness)을 여기서도 다시 적용한다. 버튼이 잠겼다는
 * 사실만 믿고 빈 값·출처 미확인·추측을 `state: 'confirmed'` 로 만들면, 그 값이 확정 기억으로
 * 저장돼 고객 안내 문구에 쓰인다. 확인할 수 없는 값은 반영하지 않고 기존 기억을 그대로 둔다.
 * 값 상충(value_conflict)은 사장님이 비교 화면에서 직접 확인하는 단계라 여기서 막지 않는다.
 */
export function applyApproval(items: MemoryItem[], candidate: MemoryCandidate, at: string): AppliedApproval {
  const blockers = memoryReadiness(candidate).blockers.filter(b => b.code !== 'value_conflict')
  if (blockers.length > 0) return { applied: false, items, superseded: null, blockers }

  const existing = items.find(i => i.key === candidate.key) ?? null
  const superseded = existing && existing.value !== candidate.proposedValue
    ? { key: existing.key, previousValue: existing.value }
    : null
  const next: MemoryItem = { key: candidate.key, value: candidate.proposedValue, state: 'confirmed', approvedAt: at }
  const rest = items.filter(i => i.key !== candidate.key)
  return { applied: true, items: [...rest, next], superseded, blockers: [] }
}
