import { createHash } from 'node:crypto'
import { containsFactPlaceholder } from './fact-placeholder'

export interface ApprovedFactRow {
  id: string
  workspace_id: string
  category: string
  content: string
  status: string
  source_candidate_id: string
  approved_by_user_id: string
  approved_at: string
  valid_from: string
  valid_until: string | null
  supersedes_fact_id: string | null
  created_at: string
}

export interface ApprovedFactSnapshot {
  readonly workspaceId: string
  readonly resolvedAt: string
  readonly facts: readonly Readonly<ApprovedFactRow>[]
  readonly hash: string
}

export type FactSnapshotAssessment =
  | {
      readonly state: 'CURRENT'
      readonly requiresOwnerReview: false
    }
  | {
      readonly state: 'REVIEW_REQUIRED'
      readonly requiresOwnerReview: true
      readonly reason: 'SNAPSHOT_MISSING' | 'WORKSPACE_MISMATCH' | 'FACTS_CHANGED'
    }

export type FactSnapshotLoader = typeof loadApprovedFactSnapshot

function timestamp(value: string): number {
  // Do not accept locale-dependent strings (e.g. "11/1") or a timezone-less date.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('INVALID_FACT_DATE')
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error('INVALID_FACT_DATE')
  return time
}

export function resolveApprovedFacts(input: {
  workspaceId: string
  at: string
  rows: readonly ApprovedFactRow[]
}): ApprovedFactSnapshot {
  const { workspaceId, rows } = input
  if (!workspaceId.trim()) throw new Error('INVALID_FACT_WORKSPACE')
  const at = timestamp(input.at)
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row.content !== 'string' || !row.content.trim() ||
      typeof row.category !== 'string' || !row.category.trim() || typeof row.id !== 'string') {
      throw new Error('INVALID_FACT_ROW')
    }
    if (row.workspace_id !== workspaceId) throw new Error('FACT_WORKSPACE_MISMATCH')
    if (!row.id || ids.has(row.id)) throw new Error('DUPLICATE_FACT_REVISION')
    ids.add(row.id)
  }
  const approved = rows.filter(row =>
    ['active', 'superseded', 'expired'].includes(row.status) &&
    row.approved_by_user_id?.trim() && row.approved_at && row.source_candidate_id?.trim(),
  )
  const byId = new Map(approved.map(row => [row.id, row]))
  for (const row of approved) {
    const lineage = new Set<string>([row.id])
    let parentId = row.supersedes_fact_id
    while (parentId) {
      if (lineage.has(parentId)) throw new Error('INVALID_FACT_LINEAGE')
      lineage.add(parentId)
      parentId = byId.get(parentId)?.supersedes_fact_id ?? null
    }
  }
  const starts = new Map<string, number>()
  for (const row of approved) {
    const start = timestamp(row.valid_from)
    if (row.valid_until !== null && timestamp(row.valid_until) <= start) throw new Error('INVALID_FACT_RANGE')
    timestamp(row.approved_at)
    starts.set(row.id, start)
  }
  // A replacement takes over at its effective date, not its confirmation date.
  // Once taken over, expiry of the new offer must never resurrect the old offer.
  const replaced = new Set(approved.filter(row => starts.get(row.id)! <= at && timestamp(row.approved_at) <= at)
    .map(row => row.supersedes_fact_id).filter((id): id is string => Boolean(id)))
  const facts = approved.filter(row => {
    if (starts.get(row.id)! > at || timestamp(row.approved_at) > at || replaced.has(row.id)) return false
    if (row.valid_until !== null && timestamp(row.valid_until) <= at) return false
    if (row.status === 'expired' || containsFactPlaceholder(row.content)) return false
    if (row.status === 'superseded' && !approved.some(next => next.supersedes_fact_id === row.id && starts.get(next.id)! > at)) return false
    return true
  }).sort((a, b) => a.id.localeCompare(b.id)).map(row => Object.freeze({
    id: row.id, workspace_id: row.workspace_id, category: row.category, content: row.content,
    status: row.status, source_candidate_id: row.source_candidate_id,
    approved_by_user_id: row.approved_by_user_id, approved_at: row.approved_at,
    valid_from: row.valid_from, valid_until: row.valid_until,
    supersedes_fact_id: row.supersedes_fact_id, created_at: row.created_at,
  }))
  const replacementParents = new Set<string>()
  for (const fact of facts) {
    if (!fact.supersedes_fact_id) continue
    if (replacementParents.has(fact.supersedes_fact_id)) throw new Error('FACT_VERSION_CONFLICT')
    replacementParents.add(fact.supersedes_fact_id)
  }
  const hash = createHash('sha256').update(JSON.stringify({ workspaceId, facts })).digest('hex')
  return Object.freeze({ workspaceId, resolvedAt: new Date(at).toISOString(), facts: Object.freeze(facts), hash })
}

type FactReader = {
  from(table: string): {
    select(columns: string, options?: { count?: string }): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown; count?: unknown }>
    }
  }
}

export async function loadApprovedFactSnapshot(
  client: FactReader,
  workspaceId: string,
  at = new Date().toISOString(),
): Promise<ApprovedFactSnapshot> {
  const { data, error, count } = await client.from('knowledge_facts')
    .select(
      'id,workspace_id,category,content,status,source_candidate_id,approved_by_user_id,approved_at,valid_from,valid_until,supersedes_fact_id,created_at',
      { count: 'exact' },
    )
    .eq('workspace_id', workspaceId)
  if (error || !Array.isArray(data)) throw new Error('FACT_READ_FAILED')
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count !== data.length) {
    throw new Error('FACT_READ_INCOMPLETE')
  }
  return resolveApprovedFacts({ workspaceId, at, rows: data as ApprovedFactRow[] })
}

export function assertFactSnapshotCurrent(previous: ApprovedFactSnapshot, current: ApprovedFactSnapshot): void {
  if (previous.workspaceId !== current.workspaceId || previous.hash !== current.hash) {
    throw new Error('FACT_SNAPSHOT_STALE')
  }
}

export function assessFactSnapshotCurrent(
  previous: ApprovedFactSnapshot | null | undefined,
  current: ApprovedFactSnapshot,
): FactSnapshotAssessment {
  if (!previous) {
    return { state: 'REVIEW_REQUIRED', requiresOwnerReview: true, reason: 'SNAPSHOT_MISSING' }
  }
  if (previous.workspaceId !== current.workspaceId) {
    return { state: 'REVIEW_REQUIRED', requiresOwnerReview: true, reason: 'WORKSPACE_MISMATCH' }
  }
  if (previous.hash !== current.hash) {
    return { state: 'REVIEW_REQUIRED', requiresOwnerReview: true, reason: 'FACTS_CHANGED' }
  }
  return { state: 'CURRENT', requiresOwnerReview: false }
}
