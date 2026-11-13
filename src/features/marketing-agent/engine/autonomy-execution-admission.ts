import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { readRuntimeControl } from './runtime-control-read'

/** 자동 발행은 희망 상태·과거 캐시가 아니라 현재 DB의 실제 RUNNING 근거로만 허가한다. */
export type AutonomyAdmissionBlockCode =
  | 'AUTONOMY_OFF'
  | 'AUTONOMY_PAUSED'
  | 'AGENT_BLOCKED'
  | 'AUTONOMY_UNVERIFIABLE'

export type AutonomyExecutionAdmission =
  | Readonly<{ admitted: true }>
  | Readonly<{ admitted: false; code: AutonomyAdmissionBlockCode }>

export type RuntimeControlRow = Readonly<{
  desired_mode: unknown
  actual_mode: unknown
  pause_reason: unknown
  kill_switch_active: unknown
}>

export function evaluateAutonomyExecutionAdmission(row: RuntimeControlRow | null): AutonomyExecutionAdmission {
  if (!row || typeof row.kill_switch_active !== 'boolean') return { admitted: false, code: 'AUTONOMY_UNVERIFIABLE' }
  if (row.kill_switch_active || row.actual_mode === 'BLOCKED') return { admitted: false, code: 'AGENT_BLOCKED' }
  if (row.desired_mode === 'OFF' || row.actual_mode === 'OFF') return { admitted: false, code: 'AUTONOMY_OFF' }
  if (row.desired_mode === 'PAUSED' || row.actual_mode === 'PAUSED') return { admitted: false, code: 'AUTONOMY_PAUSED' }
  if (row.desired_mode !== 'RUNNING' || row.actual_mode !== 'RUNNING') return { admitted: false, code: 'AUTONOMY_UNVERIFIABLE' }
  return { admitted: true }
}

const BLOCK_MESSAGES: Record<AutonomyAdmissionBlockCode, string> = {
  AUTONOMY_OFF: '자율근무가 꺼져 있어요. 먼저 켜 주세요.',
  AUTONOMY_PAUSED: '자율근무가 중지되어 있어요. 다시 켠 뒤 시도해 주세요.',
  AGENT_BLOCKED: '지금은 자동 작업이 막혀 있어요. 상태를 확인한 뒤 다시 시도해 주세요.',
  AUTONOMY_UNVERIFIABLE: '자율근무 상태를 확인하지 못해 실행을 시작하지 않았어요.',
}

export function autonomyAdmissionMessage(code: AutonomyAdmissionBlockCode): string {
  return BLOCK_MESSAGES[code]
}

export async function checkAutonomyExecutionAdmission(db: SupabaseClient, workspaceId: string): Promise<AutonomyExecutionAdmission> {
  try {
    const { data, error } = await db.from('workspace_runtime_control_states')
      .select('workspace_id,desired_mode,actual_mode,pause_reason,kill_switch_active')
      .eq('workspace_id', workspaceId).maybeSingle()
    if (error || !data || data.workspace_id !== workspaceId) return { admitted: false, code: 'AUTONOMY_UNVERIFIABLE' }
    const preliminary = evaluateAutonomyExecutionAdmission(data as RuntimeControlRow)
    if (!preliminary.admitted) return preliminary
    // RUNNING 행이어도 에너지·긴급 중지 원장이 누락되거나 차단 중이면 실행하지 않는다.
    const confirmed = await readRuntimeControl(db, workspaceId)
    return evaluateAutonomyExecutionAdmission({ ...confirmed, pause_reason: data.pause_reason, kill_switch_active: confirmed.killSwitchActive })
  } catch {
    return { admitted: false, code: 'AUTONOMY_UNVERIFIABLE' }
  }
}
