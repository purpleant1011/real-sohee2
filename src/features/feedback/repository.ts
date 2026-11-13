import { submitFeedbackSchema, triageSchema, type FeedbackListResult, type FeedbackRow, type SubmitFeedbackInput, type TriageInput } from './types'

/** Supabase 호환 최소 표면. 서버(service role) 클라이언트를 주입한다. */
export type FeedbackClient = { from(table: string): any; rpc?(name: string, args?: Record<string, unknown>): any }

const COLUMNS = 'id,workspace_id,screen,kind,rating,message,tags,status,content_id,run_id,admin_note,created_by,created_at,deleted_at'
const TABLE = 'user_feedback'

export async function submitFeedback(
  client: FeedbackClient,
  ctx: { workspaceId: string; userId: string },
  raw: unknown,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'INVALID' | 'FAILED'; message: string }> {
  const parsed = submitFeedbackSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'INVALID', message: parsed.error.issues[0]?.message ?? '입력을 확인해 주세요.' }
  const input: SubmitFeedbackInput = parsed.data
  try {
    const { data, error } = await client.from(TABLE).insert({
      workspace_id: ctx.workspaceId, created_by: ctx.userId, screen: input.screen, kind: input.kind,
      rating: input.rating ?? null, message: input.message,
    }).select('id').maybeSingle()
    if (error || !data?.id) return { ok: false, reason: 'FAILED', message: '의견을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
    return { ok: true, id: data.id as string }
  } catch {
    return { ok: false, reason: 'FAILED', message: '의견을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
  }
}

async function list(run: () => Promise<{ data: unknown; error: unknown }>): Promise<FeedbackListResult> {
  try {
    const { data, error } = await run()
    if (error || !Array.isArray(data)) return { status: 'ERROR' }
    return { status: 'OK', items: data as FeedbackRow[] }
  } catch {
    return { status: 'ERROR' }
  }
}

/** 관리자 허브용: 전체 사업장 의견(삭제 제외), 최신순. */
export function listFeedbackForAdmin(client: FeedbackClient, limit = 200): Promise<FeedbackListResult> {
  return list(() => client.from(TABLE).select(COLUMNS).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit))
}

/** 사용자용: 자기 사업장 의견만. 운영 메모는 읽지 않는다. */
export function listFeedbackForWorkspace(client: FeedbackClient, workspaceId: string, limit = 50): Promise<FeedbackListResult> {
  return list(() => client.from(TABLE)
    .select('id,workspace_id,screen,kind,rating,message,status,created_by,created_at,deleted_at')
    .eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit))
}

export async function triageFeedback(client: FeedbackClient, raw: unknown): Promise<{ ok: boolean }> {
  const parsed = triageSchema.safeParse(raw)
  if (!parsed.success) return { ok: false }
  const { id, workspaceId, status, tags, contentId, runId, adminNote }: TriageInput = parsed.data
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status !== undefined) patch.status = status
  if (tags !== undefined) patch.tags = Array.from(new Set(tags))
  if (contentId !== undefined) patch.content_id = contentId
  if (runId !== undefined) patch.run_id = runId
  if (adminNote !== undefined) patch.admin_note = adminNote
  try {
    const { data, error } = await client.from(TABLE).update(patch).eq('id', id).eq('workspace_id', workspaceId).is('deleted_at', null).select('id')
    return { ok: !error && Array.isArray(data) && data.length === 1 }
  } catch {
    return { ok: false }
  }
}

/** 삭제 요청: 즉시 소프트 삭제(목록에서 사라짐). 30일 뒤 purge 함수가 하드 삭제한다. */
export async function requestFeedbackDeletion(client: FeedbackClient, ctx: { workspaceId: string; id: string; userId?: string }): Promise<{ ok: boolean }> {
  try {
    let q = client.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', ctx.id).eq('workspace_id', ctx.workspaceId).is('deleted_at', null)
    if (ctx.userId) q = q.eq('created_by', ctx.userId)
    const { data, error } = await q.select('id')
    return { ok: !error && Array.isArray(data) && data.length === 1 }
  } catch {
    return { ok: false }
  }
}

export async function purgeDeletedFeedback(client: FeedbackClient, retentionDays = 30): Promise<{ ok: true; removed: number } | { ok: false }> {
  try {
    const { data, error } = await client.rpc!('purge_deleted_user_feedback', { p_retention_days: retentionDays })
    return error || typeof data !== 'number' ? { ok: false } : { ok: true, removed: data }
  } catch {
    return { ok: false }
  }
}

/** 코호트 보드용: 사업장별 처리 전(새 의견/확인 중) 불만 수. 조회 실패 시 undefined(알 수 없음). */
export async function countOpenComplaintsByWorkspace(client: FeedbackClient, ids: readonly string[]): Promise<Map<string, number> | undefined> {
  if (ids.length === 0) return new Map()
  try {
    const { data, error } = await client.from(TABLE).select('workspace_id')
      .in('workspace_id', ids).is('deleted_at', null).in('status', ['NEW', 'REVIEWING']).in('kind', ['PROBLEM', 'PREVIEW_MISMATCH'])
    if (error || !Array.isArray(data)) return undefined
    const map = new Map<string, number>(ids.map((id) => [id, 0]))
    for (const row of data as { workspace_id: string }[]) map.set(row.workspace_id, (map.get(row.workspace_id) ?? 0) + 1)
    return map
  } catch {
    return undefined
  }
}
