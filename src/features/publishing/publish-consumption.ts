import type { ExactApprovalPayload } from '@/features/missions/conversational-first-post'

/** Fence the entire JSONB snapshot, not just the lock: pause may keep the same lock. */
export function fenceMissionSnapshot(query: any, row: any): any {
  query = query.eq('status', row.status)
  query = row.metadata == null ? query.is('metadata', null) : query.eq('metadata', JSON.stringify(row.metadata))
  if (row.updated_at != null) query = query.eq('updated_at', row.updated_at)
  return query
}

export function nextMissionSnapshotVersion(metadata: any): number {
  const version = metadata?.snapshot_version ?? 1
  if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER) {
    throw new Error('INVALID_MISSION_SNAPSHOT_VERSION')
  }
  return version + 1
}

/** Only persistence is retried. Never invoke a provider from this loop. */
export async function persistPublishResult(admin: any, input: {
  missionId: string; workspaceId: string; lock: string; result: unknown; finalStatus: string; claimedMetadata: any
}): Promise<{ status: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: latest, error } = await admin.from('marketing_missions')
      .select('id, status, metadata, updated_at').eq('id', input.missionId).eq('workspace_id', input.workspaceId).maybeSingle()
    // No stale fallback: receipt reconciliation is required when current truth is unavailable.
    if (error || !latest || latest.metadata?.retryLock !== input.lock) return null
    const { retryLock: _lock, ...metadata } = latest.metadata
    const mayAdvance = latest.status === 'EXECUTING' &&
      (metadata.execution_state == null || ['READY', 'RUNNING', 'WAITING_EXTERNAL', 'OBSERVING'].includes(metadata.execution_state)) &&
      metadata.control_epoch === input.claimedMetadata?.control_epoch &&
      JSON.stringify(metadata.contract) === JSON.stringify(input.claimedMetadata?.contract)
    const isVerifiedStatus = input.finalStatus === 'COMPLETED' || input.finalStatus === 'PUBLISHED_VERIFIED'
    const status = mayAdvance ? input.finalStatus : latest.status
    const nextExecutionState = (mayAdvance && metadata.contract && isVerifiedStatus)
      ? 'OBSERVING'
      : metadata.execution_state
    const query = admin.from('marketing_missions').update({
      status,
      metadata: {
        ...metadata,
        ...(nextExecutionState ? { execution_state: nextExecutionState } : {}),
        executionResult: input.result,
        snapshot_version: nextMissionSnapshotVersion(metadata),
        updatedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq('id', input.missionId).eq('workspace_id', input.workspaceId).eq('metadata->>retryLock', input.lock)
    const { data: saved, error: saveError } = await fenceMissionSnapshot(query, latest).select('id')
    if (saveError) return null
    if (saved?.length) return { status }
  }
  return null
}

/** RPC absence/error is not permission to use the old non-atomic check. Never fall back to memory. */
export async function consumePublishApproval(admin: any, input: {
  workspaceId: string; missionId: string; fingerprint: string; payload: ExactApprovalPayload; claimToken: string
  expectedMetadata: unknown; expectedUpdatedAt: string | null; idempotencyKey?: string | null
}): Promise<{ status: number; body: { error: string; code: string } } | null> {
  try {
    const { data, error } = await admin.rpc('claim_first_post_publish', {
      p_workspace_id: input.workspaceId, p_mission_id: input.missionId, p_fingerprint: input.fingerprint,
      p_payload: input.payload, p_claim_token: input.claimToken,
      p_expected_metadata: input.expectedMetadata, p_expected_updated_at: input.expectedUpdatedAt,
      p_idempotency_key: input.idempotencyKey ?? null,
    })
    if (error || !data || typeof data.claimed !== 'boolean') throw new Error('Publish claim unavailable')
    if (data.claimed) return null
    return { status: 409, body: { error: '이미 사용됐거나 다른 게시에서 처리 중인 승인입니다. 저장된 결과를 다시 확인해 주세요.', code: typeof data.code === 'string' ? data.code : 'PUBLISH_APPROVAL_CONSUMED' } }
  } catch {
    return { status: 503, body: { error: '게시 중복 방지 원장을 확인하지 못해 실행하지 않았어요.', code: 'PUBLISH_CONSUMPTION_UNAVAILABLE' } }
  }
}
