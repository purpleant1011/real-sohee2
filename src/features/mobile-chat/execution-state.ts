/**
 * 대화 화면의 실행 상태 표시 계약.
 *
 * 대화 버블이 만들어졌다는 사실은 업무 완료가 아니다. 서버가 준 단계만 표시하고,
 * 모르는 값은 '완료'가 아니라 확인 중으로 둔다.
 */

export const EXECUTION_STAGES = [
  'received',
  'verifying',
  'drafting',
  'awaiting_decision',
  'verifying_external',
] as const

export type ExecutionStage = (typeof EXECUTION_STAGES)[number]

const STAGE_LABELS: Record<ExecutionStage, string> = {
  received: '요청 받음',
  verifying: '정보 확인 중',
  drafting: '초안 준비 중',
  awaiting_decision: '사장님 결정 필요',
  verifying_external: '외부 결과 확인 중',
}

/** 서버 단계를 알 수 없을 때 쓰는 문구. 완료를 암시하지 않는다. */
export const UNKNOWN_STAGE_LABEL = '진행 상황 확인 중'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExecutionStage(value: unknown): value is ExecutionStage {
  return (
    typeof value === 'string' &&
    (EXECUTION_STAGES as readonly string[]).includes(value)
  )
}

/** 화이트리스트에 있는 서버 단계만 인정한다. 그 외에는 null. */
export function readExecutionStage(value: unknown): ExecutionStage | null {
  return isExecutionStage(value) ? value : null
}

/** 사장님에게 보여줄 단계 문구. 어떤 단계도 완료/게시됨을 뜻하지 않는다. */
export function executionLabel(stage: unknown): string {
  const known = readExecutionStage(stage)
  return known ? STAGE_LABELS[known] : UNKNOWN_STAGE_LABEL
}

/** 승인 카드는 사장님 결정이 필요한 단계에서만 붙는다. */
export function needsOwnerDecision(stage: unknown): boolean {
  return readExecutionStage(stage) === 'awaiting_decision'
}

/**
 * 외부 결과 확인 단계이면서 서버 산출물이 있을 때만 검증으로 본다.
 * 초안이 있다는 것만으로는 검증이 아니다.
 */
export function isExecutionVerified(
  stage: unknown,
  hasServerOutput: unknown,
): boolean {
  return readExecutionStage(stage) === 'verifying_external' && hasServerOutput === true
}

/**
 * 서버 payload 의 상태 필드(stage / execution_stage)에서만 단계를 읽는다.
 * 본문 텍스트나 문자열 payload 는 상태 근거가 아니다.
 */
export function stageFromServerPayload(payload: unknown): ExecutionStage | null {
  if (!isRecord(payload)) return null

  return (
    readExecutionStage(payload.stage) ??
    readExecutionStage(payload.execution_stage)
  )
}
