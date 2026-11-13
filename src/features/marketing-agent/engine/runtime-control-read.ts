import type { SupabaseClient } from '@supabase/supabase-js'
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import type { ActualAgentMode, DesiredAgentMode } from './agent-control-state'

const ACTUAL = ['OFF', 'ARMING', 'RUNNING', 'DEGRADED', 'PAUSED', 'BLOCKED']
const DESIRED = ['OFF', 'RUNNING', 'PAUSED']
const numeric = (value: unknown): number | null => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

/** GET 전용. DB 행을 생성하거나 프로세스 캐시로 미확인 상태를 메우지 않는다. */
export async function readRuntimeControl(db: SupabaseClient, workspaceId: string) {
  const { data: row, error } = await db.from('workspace_runtime_control_states')
    .select('*').eq('workspace_id', workspaceId).maybeSingle()
  if (error) throw new Error('CONTROL_STATE_READ_FAILED')
  if (!row) throw new Error('CONTROL_STATE_MISSING')
  if (row.workspace_id !== workspaceId) throw new Error('CONTROL_STATE_READ_FAILED')
  const count = numeric(row.active_action_run_count)
  const version = numeric(row.version)
  if (!DESIRED.includes(row.desired_mode) || !ACTUAL.includes(row.actual_mode) ||
      typeof row.kill_switch_active !== 'boolean' || count === null || version === null || version < 1 ||
      typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('CONTROL_STATE_UNAVAILABLE')

  const [ledger, kill] = await Promise.all([
    db.from('agent_energy_ledgers').select('workspace_id,remaining_available_energy').eq('workspace_id', workspaceId).maybeSingle(),
    checkKillSwitchPreflight(db, { workspaceId }),
  ])
  if (ledger.error || !ledger.data || ledger.data.workspace_id !== workspaceId ||
      typeof ledger.data.remaining_available_energy !== 'number' || !Number.isFinite(ledger.data.remaining_available_energy) ||
      kill.scope === 'FAIL_CLOSED') throw new Error('CONTROL_GUARD_UNAVAILABLE')
  const blocked = row.kill_switch_active || kill.blocked || ledger.data.remaining_available_energy <= 0
  const actualMode: ActualAgentMode = blocked ? 'BLOCKED' : row.actual_mode as ActualAgentMode
  return {
    ...row,
    workspaceId,
    desiredMode: row.desired_mode as DesiredAgentMode,
    actualMode,
    actual_mode: actualMode,
    activeActionRunCount: count,
    killSwitchActive: row.kill_switch_active || kill.blocked,
    version,
    checkedAt: row.updated_at,
    updatedAt: row.updated_at,
    statusReason: blocked ? '안전 제어에 따라 멈춰 있어요.' : row.pause_reason || (actualMode === 'RUNNING' ? '자율근무 중' : '서버에서 확인한 상태'),
  }
}
