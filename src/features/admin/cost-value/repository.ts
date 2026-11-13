import type { CostValueRepository, CostValueSources } from './cost-value'

type Db = { from(table: string): any }

const WORKSPACE_LIMIT = 50

async function rows<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const result = await query
  if (result.error || !Array.isArray(result.data)) throw new Error('COST_SOURCE_UNAVAILABLE')
  if (result.data.length >= 1000) throw new Error('COST_SOURCE_TRUNCATED')
  return result.data as T[]
}

/** Service-role reads only; the page enforces the operator permission before constructing this. */
export class SupabaseCostValueRepository implements CostValueRepository {
  constructor(private readonly db: Db) {}

  async load(): Promise<CostValueSources> {
    const workspaces = await rows<{ id: string; name: string | null; created_at: string }>(
      this.db.from('workspaces').select('id,name,created_at').order('created_at', { ascending: false }).limit(WORKSPACE_LIMIT),
    )
    const ids = workspaces.map((row) => row.id)
    if (ids.length === 0) return { workspaces: [], firstSaves: [], consumes: [], usageEvents: [] }
    const [saves, consumes, usage] = await Promise.all([
      rows<{ workspace_id: string; created_at: string }>(
        this.db.from('vault_items').select('workspace_id,created_at').in('workspace_id', ids).is('deleted_at', null).order('created_at', { ascending: true }),
      ),
      rows<{ workspace_id: string; amount: number; occurred_at: string }>(
        this.db.from('credit_ledger_entries').select('workspace_id,amount,occurred_at').in('workspace_id', ids).eq('kind', 'consume'),
      ),
      rows<{ workspace_id: string; computed_credits: number; occurred_at: string }>(
        this.db.from('ai_usage_events').select('workspace_id,computed_credits,occurred_at').in('workspace_id', ids),
      ),
    ])
    return {
      workspaces: workspaces.map((row) => ({ workspaceId: row.id, name: row.name ?? '이름 없음', createdAt: row.created_at })),
      firstSaves: saves.map((row) => ({ workspaceId: row.workspace_id, createdAt: row.created_at })),
      consumes: consumes.map((row) => ({ workspaceId: row.workspace_id, amount: Number(row.amount), occurredAt: row.occurred_at })),
      usageEvents: usage.map((row) => ({ workspaceId: row.workspace_id, computedCredits: Number(row.computed_credits), occurredAt: row.occurred_at })),
    }
  }
}
