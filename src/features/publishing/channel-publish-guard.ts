/** G5 windows: a stranded EXECUTING row must not block the channel forever. */
export const CHANNEL_INFLIGHT_WINDOW_MS = 15 * 60_000

export interface ChannelGuardRejection {
  status: number
  body: { error: string; code: string; conflictingMissionId?: string }
}

/** Sibling EXECUTING row as read above. Columns are pinned in the select list. */
interface SiblingRow {
  id?: string
  status?: string
  updated_at?: string | null
  metadata?: { payload?: { channels?: Array<{ provider?: string }> } } | null
}

/**
 * Same workspace + overlapping channel: another mission is publishing right now, (직전 성공은 막지 않는다 — 연속 정상 게시 허용).
 * Fail-closed (503) when the sibling state cannot be read.
 */
export async function findChannelPublishConflict(
  admin: any,
  params: { workspaceId: string; missionId: string; channels: string[]; now?: number },
): Promise<ChannelGuardRejection | null> {
  const mine = new Set(params.channels)
  const { data, error } = await admin
    .from('marketing_missions')
    .select('id, status, metadata, updated_at')
    .eq('workspace_id', params.workspaceId)
    .eq('status', 'EXECUTING')
    .neq('id', params.missionId)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error || !Array.isArray(data)) {
    console.error('[channel-publish-guard] sibling read error:', error)
    return { status: 503, body: { error: '다른 게시 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'CHANNEL_GUARD_UNAVAILABLE' } }
  }
  const nowMs = params.now ?? Date.now()
  const conflict = (data as SiblingRow[]).find((row) => {
    if (row.status !== 'EXECUTING') return false
    const age = nowMs - Date.parse(row.updated_at ?? '')
    if (!(age >= 0 && age <= CHANNEL_INFLIGHT_WINDOW_MS)) return false
    const theirs = (row.metadata?.payload?.channels ?? []).map((c) => String(c.provider))
    return theirs.some((ch) => mine.has(ch))
  })
  if (!conflict) return null
  return {
    status: 409,
    body: {
      error: '같은 채널에 다른 게시물이 올라가는 중이에요. 끝난 뒤 다시 시도해 주세요.',
      code: 'CHANNEL_PUBLISH_IN_PROGRESS',
      conflictingMissionId: conflict.id,
    },
  }
}
