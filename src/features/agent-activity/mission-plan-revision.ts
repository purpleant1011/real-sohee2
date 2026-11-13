export interface MissionPlanRevisionInput {
  workspaceId: string
  missionId: string
  runId: string
  threadId: string
  expectedVersion: number
  message: string
}

export interface MissionPlanConstraints {
  channels?: ['instagram']
  excludeDiscounts?: boolean
}

export function parseMissionPlanChange(message: string): MissionPlanConstraints | null {
  const text = message.trim().replace(/[.!?。]+$/, '').replace(/\s+/g, ' ')
  if (/^(인스타|인스타그램)만( 해줘| 해주세요)?$/.test(text)) return { channels: ['instagram'] }
  if (/^할인(은)? (제외(해줘|해 주세요)?|하지 마|하지 말아줘)$/.test(text)) return { excludeDiscounts: true }
  return null
}

export interface MissionPlanRevision {
  missionId: string
  traceId: string
  workItemId: string | null
  version: number
  constraints: MissionPlanConstraints
}

/** 승인 CAS를 먼저 닫는다. 이후 저장이 실패해도 이전 승인으로 외부 실행을 재개하지 않는다. */
export async function reviseMissionPlan(db: any, input: MissionPlanRevisionInput): Promise<MissionPlanRevision> {
  const change = parseMissionPlanChange(input.message)
  if (!change || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error('PLAN_CONFLICT')
  const { data: mission, error: missionError } = await db.from('marketing_missions').select('*')
    .eq('workspace_id', input.workspaceId).eq('id', input.missionId).maybeSingle()
  if (missionError || !mission || mission.status !== 'AWAITING_APPROVAL'
    || mission.source_conversation_job_id !== input.runId || mission.metadata?.threadId !== input.threadId
    || (mission.metadata?.planRevision ?? 0) !== input.expectedVersion) throw new Error('PLAN_CONFLICT')

  const { data: run, error: runError } = await db.from('conversation_jobs').select('id,plan_data')
    .eq('workspace_id', input.workspaceId).eq('id', input.runId).eq('thread_id', input.threadId).maybeSingle()
  if (runError || run?.plan_data?.missionId !== input.missionId) throw new Error('PLAN_CONFLICT')

  const { data: approvals, error: approvalError } = await db.from('agent_approvals').select('id,status,version')
    .eq('workspace_id', input.workspaceId).eq('action_run_id', input.runId)
  if (approvalError || !Array.isArray(approvals) || approvals.some(row => row.status === 'APPROVED')) throw new Error('PLAN_CONFLICT')
  for (const approval of approvals) {
    if (approval.status !== 'PENDING') continue
    const { data: expired, error } = await db.from('agent_approvals')
      .update({ status: 'EXPIRED', version: approval.version + 1, updated_at: new Date().toISOString() })
      .eq('workspace_id', input.workspaceId).eq('id', approval.id)
      .eq('status', 'PENDING').eq('version', approval.version).select('id').maybeSingle()
    if (error || !expired) throw new Error('PLAN_CONFLICT')
  }

  const previous = mission.metadata?.planConstraints || {}
  const constraints: MissionPlanConstraints = {
    ...(Array.isArray(previous.channels) && previous.channels.length === 1 && previous.channels[0] === 'instagram' ? { channels: ['instagram'] as ['instagram'] } : {}),
    ...(previous.excludeDiscounts === true ? { excludeDiscounts: true } : {}),
    ...change,
  }
  const version = input.expectedVersion + 1
  const { data: updated, error } = await db.from('marketing_missions').update({
    status: 'PLANNING',
    updated_at: new Date().toISOString(),
    approval_id: null,
    metadata: { ...mission.metadata, planRevision: version, planConstraints: constraints },
  }).eq('workspace_id', input.workspaceId).eq('id', input.missionId)
    .eq('status', 'AWAITING_APPROVAL').eq('updated_at', mission.updated_at).select('id').maybeSingle()
  if (error || !updated) throw new Error('PLAN_CONFLICT')
  return { missionId: input.missionId, traceId: mission.trace_id, workItemId: mission.metadata?.workItemId || null, version, constraints }
}
