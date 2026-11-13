/**
 * 체험 마지막 요약 화면 설정값 (ANI-1554).
 * 숫자와 정책은 이 파일에서만 정한다. 화면 컴포넌트에 직접 쓰지 않는다.
 */

/**
 * 글 1건을 사장님이 직접 쓸 때 걸리는 시간(분)의 추정값.
 * 근거: 소규모 사업장 안내글 1건(문구 구상, 작성, 다듬기, 사진 고르기)을 직접 하는 데
 * 걸리는 일반적인 시간을 보수적으로 잡은 가정이다. 실측 데이터가 아니며,
 * 실제 사용 데이터로 보정되기 전까지 화면에는 항상 "추정"으로 표시한다.
 * 변경 시 근거를 함께 갱신할 것.
 */
export const MINUTES_SAVED_PER_POST = 30
export const MINUTES_SAVED_BASIS =
  '글 1건을 직접 쓸 때 걸리는 시간을 보수적으로 잡은 가정이에요. 실제로 잰 값이 아니에요.'

/** 체험 종료 후 보관 글 처리 정책. 사용자 결정 전까지 UNDECIDED. */
export type TrialEndPolicyKind =
  | 'UNDECIDED'
  | 'KEEP_ALL'
  | 'KEEP_N_DAYS'
  | 'EXPORT_THEN_DELETE'

export interface TrialEndPolicy {
  kind: TrialEndPolicyKind
  /** KEEP_N_DAYS일 때만 사용 */
  keepDays: number | null
}

export const TRIAL_END_POLICY: TrialEndPolicy = { kind: 'UNDECIDED', keepDays: null }

/** 요약 화면을 보여 줄 남은 일수 기준(D-3). */
export const SUMMARY_DAYS_BEFORE_END = 3
