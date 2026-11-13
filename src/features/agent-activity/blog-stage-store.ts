import type { SupabaseClient } from '@supabase/supabase-js'
import type { BlogStageFact } from './blog-progress-card'
import { projectBlogProgress } from './blog-progress-card'

interface Scope { workspaceId: string; runId: string }
type AppendInput = Scope & Omit<BlogStageFact, 'eventId' | 'workspaceId' | 'runId' | 'sequence' | 'observedAt'> & { dedupeKey: string }
const COLUMNS = 'event_id,workspace_id,run_id,sequence,observed_at,stage,status,provenance,source_id,sample_size,covered,total'

function toFact(row: Record<string, unknown>): BlogStageFact {
  return {
    eventId: row.event_id as string, workspaceId: row.workspace_id as string, runId: row.run_id as string,
    sequence: Number(row.sequence), observedAt: row.observed_at as string,
    stage: row.stage as BlogStageFact['stage'], status: row.status as BlogStageFact['status'],
    provenance: row.provenance as BlogStageFact['provenance'], sourceId: row.source_id as BlogStageFact['sourceId'],
    ...(row.sample_size != null ? { sampleSize: Number(row.sample_size) } : {}),
    ...(row.covered != null && row.total != null ? { coverage: { covered: Number(row.covered), total: Number(row.total) } } : {}),
  }
}

function scoped(row: unknown, scope: Scope): BlogStageFact {
  const fact = row && typeof row === 'object' ? toFact(row as Record<string, unknown>) : null
  if (!fact || fact.workspaceId !== scope.workspaceId || fact.runId !== scope.runId
    || !projectBlogProgress([fact], { ...scope, live: false })) throw new Error('BLOG_STAGE_INVALID')
  return fact
}

export async function appendBlogStageFact(db: SupabaseClient, input: AppendInput): Promise<BlogStageFact> {
  const { data, error } = await db.rpc('append_blog_stage_fact', {
    p_workspace_id: input.workspaceId, p_run_id: input.runId, p_stage: input.stage, p_status: input.status,
    p_provenance: input.provenance, p_source_id: input.sourceId, p_sample_size: input.sampleSize ?? null,
    p_covered: input.coverage?.covered ?? null, p_total: input.coverage?.total ?? null, p_dedupe_key: input.dedupeKey,
  })
  if (error) throw new Error('BLOG_STAGE_UNAVAILABLE')
  if (!Array.isArray(data) || data.length !== 1) throw new Error('BLOG_STAGE_INVALID')
  return scoped(data[0], input)
}

export async function replayBlogStageFacts(db: SupabaseClient, input: Scope & { after: number }): Promise<BlogStageFact[]> {
  const { data, error } = await db.from('blog_stage_facts').select(COLUMNS)
    .eq('workspace_id', input.workspaceId).eq('run_id', input.runId)
    .gt('sequence', input.after).order('sequence', { ascending: true }).limit(200)
  if (error) throw new Error('BLOG_STAGE_UNAVAILABLE')
  if (!Array.isArray(data)) throw new Error('BLOG_STAGE_INVALID')
  let previous = input.after
  return data.map(row => {
    const fact = scoped(row, input)
    if (fact.sequence <= previous) throw new Error('BLOG_STAGE_INVALID')
    previous = fact.sequence
    return fact
  })
}

type RecordedStage = Pick<BlogStageFact, 'stage' | 'status' | 'sourceId' | 'sampleSize' | 'coverage'> & { dedupeKey: string }
/** Adapts generation stage reports into idempotent server_record facts for one run and request. */
export function createStageRecorder(db: SupabaseClient, scope: Scope & { requestKey: string }) {
  return async (fact: RecordedStage) => {
    await appendBlogStageFact(db, {
      workspaceId: scope.workspaceId, runId: scope.runId, stage: fact.stage, status: fact.status,
      provenance: 'server_record', sourceId: fact.sourceId,
      ...(fact.sampleSize !== undefined ? { sampleSize: fact.sampleSize } : {}),
      ...(fact.coverage ? { coverage: fact.coverage } : {}),
      dedupeKey: `${scope.requestKey}:${fact.dedupeKey}`.slice(0, 128),
    })
  }
}
