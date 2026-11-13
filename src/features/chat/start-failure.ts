/** 대화 시작 실패 원인을 사용자에게 보여 줄 짧은 코드로 줄인다. 내부 메시지 원문은 노출하지 않는다. */
export function describeStartFailure(error: unknown): string {
  if (error instanceof TypeError) return 'network'
  if (error instanceof Error && /^[a-z_]{3,40}$/.test(error.message)) return error.message
  return 'unknown'
}
