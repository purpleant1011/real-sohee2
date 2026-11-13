/**
 * ANI-1565 cost-vs-value (minimum). Only persisted sources are used:
 *  - credit_ledger_entries (kind = 'consume'): credits actually consumed
 *  - ai_usage_events: measured provider calls (tokens + computed credits; there is NO cost column)
 *  - vault_items.created_at: first save to the vault (the "first value" moment)
 * No table stores a real cost (KRW/USD) per workspace, so cost is always "집계 전". Never estimate it.
 */

export const NOT_AGGREGATED = '집계 전' as const

export interface WorkspaceRef {
  workspaceId: string
  name: string
  createdAt: string
}
export interface LedgerConsume {
  workspaceId: string
  amount: number
  occurredAt: string
}
export interface UsageEvent {
  workspaceId: string
  computedCredits: number
  occurredAt: string
}
export interface FirstSave {
  workspaceId: string
  createdAt: string
}

export interface CostValueSources {
  workspaces: WorkspaceRef[]
  firstSaves: FirstSave[]
  consumes: LedgerConsume[]
  usageEvents: UsageEvent[]
}

export interface CostValueRepository {
  load(): Promise<CostValueSources>
}

export interface CostValueRow {
  workspaceId: string
  name: string
  signedUpAt: string
  firstValueAt: string | null
  /** Credits consumed from signup up to (and including) the first vault save; since signup when none yet. */
  creditsToFirstValue: number
  reachedFirstValue: boolean
  measuredCallCount: number
  /** Real cost is not logged anywhere: always the not-aggregated marker. */
  costToFirstValue: typeof NOT_AGGREGATED
}

export type CostValueResult =
  | { kind: 'ok'; rows: CostValueRow[]; transformTrend: typeof NOT_AGGREGATED; costSource: typeof NOT_AGGREGATED }
  | { kind: 'error'; message: string }

export const COST_VALUE_ERROR = '비용 자료를 지금 확인할 수 없어요'

export function computeCostValue(sources: CostValueSources): CostValueRow[] {
  const firstSave = new Map<string, string>()
  for (const save of sources.firstSaves) {
    const current = firstSave.get(save.workspaceId)
    if (!current || Date.parse(save.createdAt) < Date.parse(current)) firstSave.set(save.workspaceId, save.createdAt)
  }
  return sources.workspaces.map((workspace) => {
    const first = firstSave.get(workspace.workspaceId) ?? null
    const within = (iso: string) => first === null || Date.parse(iso) <= Date.parse(first)
    const credits = sources.consumes
      .filter((row) => row.workspaceId === workspace.workspaceId && within(row.occurredAt))
      .reduce((sum, row) => sum + row.amount, 0)
    const calls = sources.usageEvents.filter((row) => row.workspaceId === workspace.workspaceId && within(row.occurredAt)).length
    return {
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      signedUpAt: workspace.createdAt,
      firstValueAt: first,
      creditsToFirstValue: credits,
      reachedFirstValue: first !== null,
      measuredCallCount: calls,
      costToFirstValue: NOT_AGGREGATED,
    }
  })
}

export async function buildCostValue(repository: CostValueRepository): Promise<CostValueResult> {
  try {
    const rows = computeCostValue(await repository.load())
    return { kind: 'ok', rows, transformTrend: NOT_AGGREGATED, costSource: NOT_AGGREGATED }
  } catch {
    // ERROR is never shown as an empty list or a zero.
    return { kind: 'error', message: COST_VALUE_ERROR }
  }
}
