import type { SupabaseClient } from '@supabase/supabase-js'
import { projectActivityEvent, type ActivityKind, type AgentActivityEvent } from './activity-event'
import { isActivityRunStatus, type ActivityRunStatus } from './activity-run-status'

interface ActivityScope { workspaceId: string; runId: string }
interface AppendInput extends ActivityScope { kind: ActivityKind; dedupeKey: string; stepId?: string; simulated?: boolean }
const PUBLIC_COLUMNS = 'event_id,workspace_id,run_id,mission_id,step_id,sequence,observed_at,kind,simulated'

export async function readActivityRunStatus(db: SupabaseClient, scope: ActivityScope): Promise<ActivityRunStatus> {
  const { data, error } = await db.from('conversation_jobs').select('status')
    .eq('workspace_id', scope.workspaceId).eq('id', scope.runId).maybeSingle()
  if (error || !data || !isActivityRunStatus(data.status)) throw new Error('ACTIVITY_UNAVAILABLE')
  return data.status
}

function scopedEvent(row: unknown, scope: ActivityScope): AgentActivityEvent {
  const event = projectActivityEvent(row)
  if (!event || event.workspace_id !== scope.workspaceId || event.run_id !== scope.runId) {
    throw new Error('ACTIVITY_INVALID')
  }
  return event
}

export async function appendActivity(db: SupabaseClient, input: AppendInput): Promise<AgentActivityEvent> {
  const { data, error } = await db.rpc('append_agent_activity', {
    p_workspace_id: input.workspaceId, p_run_id: input.runId,
    p_step_id: input.stepId ?? null, p_kind: input.kind,
    p_dedupe_key: input.dedupeKey, p_simulated: input.simulated ?? false,
  })
  if (error) throw new Error('ACTIVITY_UNAVAILABLE')
  if (!Array.isArray(data) || data.length !== 1) throw new Error('ACTIVITY_INVALID')
  return scopedEvent(data[0], input)
}

export async function replayActivity(db: SupabaseClient, input: ActivityScope & { after: number }): Promise<AgentActivityEvent[]> {
  const { data, error } = await db.from('agent_activity_events').select(PUBLIC_COLUMNS)
    .eq('workspace_id', input.workspaceId).eq('run_id', input.runId)
    .gt('sequence', input.after).order('sequence', { ascending: true }).limit(200)
  if (error) throw new Error('ACTIVITY_UNAVAILABLE')
  if (!Array.isArray(data)) throw new Error('ACTIVITY_INVALID')
  let previous = input.after
  return data.map(row => {
    const event = scopedEvent(row, input)
    if (event.sequence <= previous) throw new Error('ACTIVITY_INVALID')
    previous = event.sequence
    return event
  })
}
