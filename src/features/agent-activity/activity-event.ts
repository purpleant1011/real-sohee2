import type { ToolExecutionResult } from '@/features/tool-runtime/types'

const COPY = {
  request_received: ['queued', '요청을 접수했습니다.'],
  planning_summary: ['running', '실행 가능한 작업을 검토하고 있습니다.'],
  tool_read_started: ['running', '연결된 도구에서 정보를 조회하고 있습니다.'],
  tool_read_verified: ['verified', '도구의 정보 조회가 확인되었습니다.'],
  tool_read_failed: ['failed', '도구 실행을 완료하지 못했습니다.'],
  capability_checked: ['running', '도구 실행 조건을 확인했습니다.'],
  artifact_created: ['proposed', '검토할 결과물을 준비했습니다.'],
  plan_proposed: ['proposed', '실행 계획을 제안했습니다.'],
  approval_needed: ['approval_needed', '실행 전 사장님의 승인이 필요합니다.'],
  action_submitted: ['running', '외부 작업을 요청했습니다. 결과 확인이 필요합니다.'],
  provider_accepted: ['running', '외부 서비스가 요청을 접수했습니다. 결과 확인이 필요합니다.'],
  externally_verified: ['verified', '외부 서비스의 독립 조회로 실행 결과를 확인했습니다.'],
  result_unknown: ['result_unknown', '실행 결과를 아직 확인하지 못했습니다.'],
  partial: ['result_unknown', '일부만 처리되어 결과 확인이 필요합니다.'],
  recovered: ['queued', '저장된 작업 기록을 복구했습니다.'],
  blocked: ['blocked', '실행 조건이 충족되지 않아 작업을 중단했습니다.'],
  pause_applied: ['blocked', '작업이 일시 중지되었습니다.'],
  human_handoff: ['blocked', '담당자의 확인이 필요합니다.'],
} as const

export type ActivityKind = keyof typeof COPY

export interface AgentActivityEvent {
  event_id: string
  workspace_id: string
  mission_id: string | null
  run_id: string
  step_id: string | null
  sequence: number
  observed_at: string
  kind: ActivityKind
  lifecycle: typeof COPY[ActivityKind][0]
  user_visible_summary: string
  sensitivity_level: 'public'
  simulated: boolean
}

export const isActivityKind = (kind: unknown): kind is ActivityKind =>
  typeof kind === 'string' && Object.hasOwn(COPY, kind)

export const isActivityId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function projectActivityEvent(value: unknown): AgentActivityEvent | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (
    !isActivityKind(row.kind) ||
    !isActivityId(row.event_id) ||
    !isActivityId(row.workspace_id) ||
    !isActivityId(row.run_id) ||
    (row.mission_id != null && !isActivityId(row.mission_id)) ||
    (row.step_id != null && (typeof row.step_id !== 'string' || !/^[1-9]\d{0,8}$/.test(row.step_id))) ||
    !Number.isSafeInteger(row.sequence) ||
    (row.sequence as number) < 1 ||
    typeof row.observed_at !== 'string' ||
    !Number.isFinite(Date.parse(row.observed_at)) ||
    typeof row.simulated !== 'boolean'
  ) {
    return null
  }
  const [lifecycle, summary] = COPY[row.kind]
  return {
    event_id: row.event_id,
    workspace_id: row.workspace_id,
    run_id: row.run_id,
    mission_id: (row.mission_id as string | null) ?? null,
    step_id: (row.step_id as string | null) ?? null,
    sequence: row.sequence as number,
    observed_at: row.observed_at,
    kind: row.kind,
    lifecycle,
    user_visible_summary: summary,
    sensitivity_level: 'public',
    simulated: row.simulated,
  }
}

// A handler's success flag, text, HTTP status or self-reported receipt is not independent readback.
export function activityForToolResult(result: ToolExecutionResult): ActivityKind {
  switch (result.status) {
    case 'AWAITING_APPROVAL':
      return 'approval_needed'
    case 'FAILED':
      return 'tool_read_failed'
    case 'DEGRADED':
      return 'partial'
    case 'BLOCKED':
    case 'DISCONNECTED':
    case 'NOT_IMPLEMENTED':
    case 'UNAVAILABLE':
      return 'blocked'
    default:
      return 'result_unknown'
  }
}
