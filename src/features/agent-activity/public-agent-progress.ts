import type { AgentProgressEvent, AgentProgressKind } from '@/features/tool-runtime/agent-loop-engine'

const PUBLIC_PROGRESS_COPY: Record<AgentProgressKind, { title: string; detail: string }> = {
  planning: { title: '작업 준비', detail: '요청을 확인하고 있습니다.' },
  step_started: { title: '작업 확인 중', detail: '실행 가능 여부를 확인하고 있습니다.' },
  step_done: { title: '단계 처리됨', detail: '단계 응답을 받았습니다. 실제 결과는 실행 근거에서 확인해 주세요.' },
  step_failed: { title: '작업 확인 필요', detail: '단계를 처리하지 못했습니다.' },
  awaiting_approval: { title: '승인 대기', detail: '사장님의 확인 및 승인이 필요합니다.' },
}

// Legacy progress is ephemeral, not provider evidence. Never forward free-form
// model/tool text or additional payload fields through this compatibility stream.
export function projectPublicAgentProgress(input: unknown): AgentProgressEvent | null {
  if (!input || typeof input !== 'object') return null
  const { kind, stepIndex } = input as Record<string, unknown>
  if (typeof kind !== 'string' || !Object.hasOwn(PUBLIC_PROGRESS_COPY, kind)) return null
  if (typeof stepIndex !== 'number' || !Number.isSafeInteger(stepIndex) || stepIndex < 0) return null
  const publicKind = kind as AgentProgressKind
  return { kind: publicKind, stepIndex, ...PUBLIC_PROGRESS_COPY[publicKind] }
}
