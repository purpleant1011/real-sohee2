import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { creditKindLabel, formatKst, referenceCode } from '@/components/admin-ui/labels'
import type { CreditLedgerKind } from '@/features/credits/types'

export type RevenueStats = Readonly<{
  windowDays: number
  windowLabel: string
  /** null when the window had more rows than we aggregate (never a partial total presented as complete). */
  totalScDistributed: number | null
  totalScSettled: number | null
  burnRatePercent: number | null
  activeWorkspacesCount: number | null
  mrrKrw: null
  mrrGrowth: null
  idempotentStatus: null
  idempotentIssuesCount: null
}>

export type LedgerEntry = Readonly<{
  id: string
  referenceId: string
  timestamp: string
  workspace: string
  workspaceId: string
  type: string
  typeLabel: string
  amount: number
  amountLabel: string
  isPositive: boolean
  action: string
  idempotencyKey: string
}>

export type RevenueResult = Readonly<{
  stats: RevenueStats
  ledger: readonly LedgerEntry[]
  workspaces?: readonly RawWorkspace[]
}>

export type RevenueRepositoryResult = Readonly<{
  data: RevenueResult | null
  error: string | null
}>

export type RawCreditLedgerEntry = {
  id: string
  workspace_id: string
  kind: string
  action: string | null
  amount: number
  idempotency_key: string
  occurred_at: string
}

export type RawWorkspace = {
  id: string
  name: string | null
}

export type RevenueFilterOptions = Readonly<{
  workspaceId?: string
  kind?: CreditLedgerKind | string
}>

export type RevenueGateway = {
  fetchRecentLedger(
    sinceIso: string,
    limit?: number,
    filters?: { workspaceId?: string; kind?: string },
  ): Promise<{ data: RawCreditLedgerEntry[] | null; error: unknown }>
  fetchWorkspaces(ids: string[]): Promise<{ data: RawWorkspace[] | null; error: unknown }>
}

/** Ledger kinds that add spendable credits vs. kinds that spend them; reserve/release are temporary holds. */
const DISTRIBUTION_KINDS = new Set(['grant', 'adjustment', 'manual_adjust', 'refund', 'weekly_grant', 'signup_bonus'])
const CONSUMPTION_KINDS = new Set(['consume'])

export function aggregateRevenueStats(
  entries: readonly RawCreditLedgerEntry[],
  windowDays = 30,
  truncated = false,
): RevenueStats {
  const base = { windowDays, windowLabel: `최근 ${windowDays}일`, mrrKrw: null, mrrGrowth: null, idempotentStatus: null, idempotentIssuesCount: null } as const
  if (truncated) {
    return { ...base, totalScDistributed: null, totalScSettled: null, burnRatePercent: null, activeWorkspacesCount: null }
  }
  let totalDistributed = 0
  let totalSettled = 0
  const workspaceIds = new Set<string>()

  for (const entry of entries) {
    const kind = entry.kind.toLowerCase()
    if (DISTRIBUTION_KINDS.has(kind) && entry.amount > 0) totalDistributed += entry.amount
    else if (CONSUMPTION_KINDS.has(kind)) totalSettled += Math.abs(entry.amount)
    if (entry.workspace_id) workspaceIds.add(entry.workspace_id)
  }

  const burnRatePercent = totalDistributed > 0
    ? Math.round((totalSettled / totalDistributed) * 1000) / 10
    : null

  return { ...base, totalScDistributed: totalDistributed, totalScSettled: totalSettled, burnRatePercent, activeWorkspacesCount: workspaceIds.size }
}

export function formatLedgerEntries(
  entries: readonly RawCreditLedgerEntry[],
  workspaces: readonly RawWorkspace[],
): readonly LedgerEntry[] {
  const workspaceMap = new Map<string, string>()
  for (const ws of workspaces) {
    if (ws.name) {
      workspaceMap.set(ws.id, ws.name)
    }
  }

  return entries.map((entry) => {
    const wsName = workspaceMap.get(entry.workspace_id) || entry.workspace_id
    const kind = entry.kind.toLowerCase()
    // Ledger amounts are stored unsigned for holds and consumption; show the direction by kind.
    const isPositive = DISTRIBUTION_KINDS.has(kind) && entry.amount > 0
    const sign = isPositive ? '+' : CONSUMPTION_KINDS.has(kind) ? '-' : ''
    const amtLabel = `${sign}${Math.abs(entry.amount).toLocaleString()} SC`
    const typeLabel = creditKindLabel(entry.kind)
    const actionLabel = entry.action || '크레딧 거래'

    return {
      id: entry.id,
      referenceId: referenceCode(entry.id),
      timestamp: formatKst(entry.occurred_at),
      workspace: wsName,
      workspaceId: entry.workspace_id,
      type: entry.kind,
      typeLabel,
      amount: entry.amount,
      amountLabel: amtLabel,
      isPositive,
      action: actionLabel,
      idempotencyKey: entry.idempotency_key,
    }
  })
}

async function productionGateway(): Promise<RevenueGateway> {
  const adminDb = createAdminSupabaseClient()
  return {
    async fetchRecentLedger(sinceIso: string, limit = 2001, filters?: { workspaceId?: string; kind?: string }) {
      let query = (adminDb as any)
        .from('credit_ledger_entries')
        .select('id, workspace_id, kind, action, amount, idempotency_key, occurred_at')
        .gte('occurred_at', sinceIso)

      if (filters?.workspaceId) {
        query = query.eq('workspace_id', filters.workspaceId)
      }
      if (filters?.kind) {
        query = query.eq('kind', filters.kind)
      }

      return query.order('occurred_at', { ascending: false }).limit(limit)
    },
    async fetchWorkspaces(ids: string[]) {
      if (ids.length === 0) return { data: [], error: null }
      return (adminDb as any)
        .from('workspaces')
        .select('id, name')
        .in('id', ids)
    },
  }
}

export async function getOperatorRevenueData(
  dependenciesOrOptions?: {
    gateway?: RevenueGateway
    now?: () => Date
    workspaceId?: string
    kind?: CreditLedgerKind | string
  },
  maybeOptions?: RevenueFilterOptions,
): Promise<RevenueRepositoryResult> {
  try {
    const now = dependenciesOrOptions?.now ? dependenciesOrOptions.now() : new Date()
    const windowDays = 30
    const sinceIso = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    const gateway = dependenciesOrOptions?.gateway ?? await productionGateway()

    const workspaceId = maybeOptions?.workspaceId ?? dependenciesOrOptions?.workspaceId
    const kind = maybeOptions?.kind ?? dependenciesOrOptions?.kind
    const filters = (workspaceId || kind) ? { workspaceId, kind } : undefined

    // Fetch one row more than the aggregation cap so truncation is detected instead of hidden.
    const AGGREGATION_CAP = 2000
    const ledgerRes = await gateway.fetchRecentLedger(sinceIso, AGGREGATION_CAP + 1, filters)
    if (ledgerRes.error || !ledgerRes.data) {
      return { data: null, error: 'CREDIT_LEDGER_READ_FAILED' }
    }

    let rawData = ledgerRes.data
    if (workspaceId) {
      rawData = rawData.filter((e) => e.workspace_id === workspaceId)
    }
    if (kind) {
      rawData = rawData.filter((e) => e.kind.toLowerCase() === kind.toLowerCase())
    }

    const truncated = rawData.length > AGGREGATION_CAP
    const rawLedger = rawData.slice(0, AGGREGATION_CAP)
    const workspaceIds = Array.from(new Set(rawLedger.map((e) => e.workspace_id)))
    const workspacesRes = await gateway.fetchWorkspaces(workspaceIds)
    if (!Array.isArray(workspacesRes.data)) throw new Error('OPERATOR_WORKSPACE_READ_FAILED')
    const workspaces = workspacesRes.data

    const stats = aggregateRevenueStats(rawLedger, windowDays, truncated)
    const ledger = formatLedgerEntries(rawLedger, workspaces)

    return {
      data: { stats, ledger, workspaces },
      error: null,
    }
  } catch {
    return { data: null, error: 'CREDIT_LEDGER_READ_FAILED' }
  }
}
