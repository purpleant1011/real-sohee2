import type { AgentControlState } from '@/features/marketing-agent/engine/agent-control-state'
import type {
  WorkboardSnapshot,
  WorkboardRuntimeState,
  WorkboardMission,
  AppliedRule,
  WorkboardProof,
  WorkboardNextAction,
  DataFreshness,
} from './workboard-types'

export interface BuildWorkboardSnapshotParams {
  workspaceId: string
  controlState: AgentControlState
  mission?: WorkboardMission | null
  rules?: AppliedRule[]
  rawProof?: WorkboardProof | null
  nextAction?: WorkboardNextAction | null
  ownerActionRequiredCount?: number
  now?: Date
}

export function buildWorkboardSnapshot(params: BuildWorkboardSnapshotParams): WorkboardSnapshot {
  const { workspaceId, controlState } = params
  const now = params.now || new Date()

  // 1. Determine truthful WorkboardRuntimeState
  let runtimeState: WorkboardRuntimeState = 'IDLE'

  if (controlState.actualMode === 'BLOCKED' || controlState.killSwitchActive) {
    runtimeState = 'BLOCKED'
  } else if (controlState.actualMode === 'PAUSED' || controlState.desiredMode === 'PAUSED') {
    runtimeState = 'PAUSED'
  } else if (controlState.actualMode === 'DEGRADED') {
    runtimeState = 'DEGRADED'
  } else if ((params.ownerActionRequiredCount ?? 0) > 0) {
    runtimeState = 'OWNER_ACTION_REQUIRED'
  } else if (controlState.actualMode === 'RUNNING' && controlState.desiredMode === 'RUNNING') {
    runtimeState = 'RUNNING'
  } else if (controlState.actualMode === 'OFF' || controlState.desiredMode === 'OFF') {
    runtimeState = 'IDLE'
  } else {
    runtimeState = 'IDLE'
  }

  // 2. Determine DataFreshness
  let freshness: DataFreshness = 'UNKNOWN'
  if (controlState.lastHeartbeatAt) {
    const lastHeartbeatTime = new Date(controlState.lastHeartbeatAt).getTime()
    if (!isNaN(lastHeartbeatTime)) {
      const diffMs = now.getTime() - lastHeartbeatTime
      // 5 minutes threshold for freshness
      freshness = diffMs < 0 ? 'UNKNOWN' : diffMs <= 5 * 60 * 1000 ? 'FRESH' : 'STALE'
    }
  }

  if (runtimeState === 'RUNNING' && freshness !== 'FRESH') {
    runtimeState = 'DEGRADED'
  }

  // Persisted applied rules only; default policy names are not execution evidence.
  const appliedRules: AppliedRule[] = params.rules ?? []

  // 4. Resolve Mission (Never hallucinate fake mission; only render explicit or null)
  const mission: WorkboardMission | null = params.mission ?? null

  // 5. Resolve Last Proof (Never invent proof if rawProof is null)
  const lastProof: WorkboardProof | null = params.rawProof ?? null

  // 6. Resolve Next Action
  const nextAction: WorkboardNextAction | null = params.nextAction ?? null

  return {
    workspaceId,
    runtimeState,
    statusReason: runtimeState === 'DEGRADED' && freshness !== 'FRESH'
      ? '최근 업무 실행 신호를 확인하지 못했어요. 자동 업무 상태를 다시 확인해 주세요.'
      : controlState.statusReason || '대기 중',
    mission,
    appliedRules,
    lastProof,
    nextAction,
    ownerActionRequiredCount: params.ownerActionRequiredCount || 0,
    freshness,
    updatedAt: now.toISOString(),
  }
}
