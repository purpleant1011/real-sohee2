/**
 * M22(ANI-1709) 가게 기억 승인·거절의 화면 상태(5상태).
 *
 * - idle: 아직 누르지 않음
 * - submitting: 저장 요청 진행 중
 * - decided: 이번 요청으로 확정/거절됨
 * - already_handled: 다른 실행이 먼저 처리함(동시성·멱등). 성공과 섞지 않는다.
 * - failed: 저장 실패 또는 항목 없음. 성공으로 닫지 않는다.
 */

export type MemoryDecision = 'confirm' | 'reject'

export type MemoryDecisionUiState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'decided'; status: 'confirmed' | 'rejected' }
  | { kind: 'already_handled'; status: 'confirmed' | 'rejected' }
  | { kind: 'failed'; reason: 'not_found' | 'invalid' | 'unavailable' }

export const MEMORY_DECISION_MESSAGES = {
  submitting: '저장하고 있어요…',
  decidedConfirmed: '승인했어요.',
  decidedRejected: '거절했어요.',
  alreadyConfirmed: '이미 승인된 항목이에요.',
  alreadyRejected: '이미 거절된 항목이에요.',
  failedNotFound: '이미 처리됐거나 찾을 수 없는 항목이에요. 화면을 새로 고쳐 확인해 주세요.',
  failedInvalid: '확인할 내용이 없어 승인하지 않았어요. 화면을 새로 고쳐 확인해 주세요.',
  failedUnavailable: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const

/**
 * 서버 응답을 그대로 믿지 않는다. 응답한 제안 id 가 지금 누른 제안과 같고,
 * 200 + decided/already_handled + confirmed/rejected 조합일 때만 결과로 인정한다.
 */
export function decisionStateFromResponse(
  httpStatus: number,
  payload: unknown,
  proposalId: string,
): MemoryDecisionUiState {
  if (payload === null || typeof payload !== 'object') return { kind: 'failed', reason: 'unavailable' }
  const body = payload as Record<string, unknown>
  if (body.proposalId !== proposalId) return { kind: 'failed', reason: 'unavailable' }

  if (httpStatus === 404 && body.outcome === 'not_found') return { kind: 'failed', reason: 'not_found' }
  // 값이 비어 승인을 만들지 않은 경우. 저장 실패(unavailable)와 같은 문구로 뭉개지 않는다.
  if (httpStatus === 422 && body.outcome === 'invalid_proposal') return { kind: 'failed', reason: 'invalid' }

  const status = body.status === 'confirmed' || body.status === 'rejected' ? body.status : null
  if (
    httpStatus === 200
    && status !== null
    && (body.outcome === 'decided' || body.outcome === 'already_handled')
  ) {
    return { kind: body.outcome, status }
  }

  return { kind: 'failed', reason: 'unavailable' }
}

/** 카드에 표시할 문구. idle 이면 아무것도 그리지 않는다. */
export function decisionMessage(state: MemoryDecisionUiState): { tone: 'status' | 'alert'; text: string } | null {
  switch (state.kind) {
    case 'idle':
      return null
    case 'submitting':
      return { tone: 'status', text: MEMORY_DECISION_MESSAGES.submitting }
    case 'decided':
      return {
        tone: 'status',
        text: state.status === 'confirmed'
          ? MEMORY_DECISION_MESSAGES.decidedConfirmed
          : MEMORY_DECISION_MESSAGES.decidedRejected,
      }
    case 'already_handled':
      return {
        tone: 'status',
        text: state.status === 'confirmed'
          ? MEMORY_DECISION_MESSAGES.alreadyConfirmed
          : MEMORY_DECISION_MESSAGES.alreadyRejected,
      }
    case 'failed':
      return {
        tone: 'alert',
        text: state.reason === 'not_found' ? MEMORY_DECISION_MESSAGES.failedNotFound
          : state.reason === 'invalid' ? MEMORY_DECISION_MESSAGES.failedInvalid
          : MEMORY_DECISION_MESSAGES.failedUnavailable,
      }
  }
}
