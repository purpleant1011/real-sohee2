/**
 * Shared Mission OS Display Helpers
 *
 * Guarantees:
 * 1. Honest execution progress copy (no false "소희 자율 진행 중" for BLOCKED, FAILED, PAUSED, CANCELLED, COMPLETED, RESULT_UNKNOWN)
 * 2. Honest observation display (finite observedValue required for green verified badge; malformed null/NaN/infinite treated as unverified evidence)
 */

export interface ExecutionProgressInput {
  requiresOwnerAction?: boolean
  canonicalStatus?: string | null
  status?: string | null
  executionState?: string | null
  isBlocked?: boolean | null
}

export function getHonestExecutionProgressText(
  input: ExecutionProgressInput,
  variant: 'list' | 'detail' = 'list'
): string {
  const isBlocked = Boolean(
    input.isBlocked ||
    input.canonicalStatus === 'BLOCKED' ||
    input.status === 'BLOCKED'
  )
  if (isBlocked) {
    return variant === 'detail'
      ? '진행이 차단된 상태입니다. 조치 사항을 확인해 주세요.'
      : '진행 차단 (조치 필요)'
  }

  const status = input.canonicalStatus || input.status
  const executionState = input.executionState

  if (status === 'FAILED' || executionState === 'STOPPED') {
    return variant === 'detail'
      ? '일시적인 오류로 중단되었습니다. 재시도 또는 확인이 필요합니다.'
      : '일시 실패 (재확인 필요)'
  }

  if (status === 'PAUSED' || executionState === 'PAUSED' || executionState === 'PAUSING') {
    return variant === 'detail'
      ? '임무가 일시 정지된 상태입니다. 언제든 다시 재개할 수 있습니다.'
      : '임무 일시 정지됨'
  }

  if (status === 'CANCELLED') {
    return variant === 'detail'
      ? '임무가 취소되었습니다.'
      : '임무 취소됨'
  }

  if (status === 'COMPLETED' || executionState === 'CLOSED') {
    return variant === 'detail'
      ? '모든 단계의 업무가 성공적으로 완료되었습니다.'
      : '업무 완료'
  }

  if (status === 'RESULT_UNKNOWN') {
    return variant === 'detail'
      ? '외부 플랫폼 발행 결과를 확인하고 있습니다. (중복 방지 락 적용 중)'
      : '외부 발행 결과 확인 중 (중복 방지 락)'
  }

  if (
    input.requiresOwnerAction ||
    status === 'AWAITING_APPROVAL' ||
    executionState === 'NEEDS_DECISION'
  ) {
    return variant === 'detail'
      ? '사장님 확인 및 승인이 필요한 단계입니다.'
      : '사장님 확인/승인 필요'
  }

  return variant === 'detail'
    ? '소희가 약정된 순서에 따라 차분히 진행하고 있습니다.'
    : '소희 자율 진행 중'
}

export type ObservationDisplayKind =
  | 'verified'
  | 'unverified_evidence'
  | 'read_failed'
  | 'zero'
  | 'pending'

export interface ObservationDisplayBadge {
  kind: ObservationDisplayKind
  badgeClass: string
  label: string
}

export function getObservationDisplayBadge(
  observationStatus: string | null | undefined,
  observedValue: unknown,
  variant: 'list' | 'detail' = 'list'
): ObservationDisplayBadge {
  if (observationStatus === 'READ_FAILED') {
    return {
      kind: 'read_failed',
      badgeClass: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
      label: variant === 'detail'
        ? '외부 플랫폼 성과 조회 실패 (재확인 필요)'
        : '성과 지표 조회 실패 (재확인 필요)',
    }
  }

  if (observationStatus === 'OBSERVED') {
    const isFiniteNumber =
      typeof observedValue === 'number' && Number.isFinite(observedValue)

    if (isFiniteNumber) {
      return {
        kind: 'verified',
        badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        label: variant === 'detail'
          ? `공식 성과 확인 완료 (${observedValue})`
          : `성과 확인 완료 (${observedValue})`,
      }
    }

    // Malformed evidence invariant: null, NaN, undefined, Infinity must NEVER show green verified
    return {
      kind: 'unverified_evidence',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
      label: '성과 근거 부족 (관측 수치 미확인)',
    }
  }

  if (observationStatus === 'VERIFIED_ZERO' || observationStatus === 'EMPTY_VERIFIED') {
    return {
      kind: 'zero',
      badgeClass: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
      label: '성과 확인 완료 (해당 기간 신규 성과 없음)',
    }
  }

  return {
    kind: 'pending',
    badgeClass: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    label: '성과 관측 대기 중',
  }
}
