import { z } from 'zod'

export type DatasetMode = 'ACTUAL' | 'TEST' | 'CANARY'
export type MetricStatus = 'FRESH' | 'STALE' | 'UNKNOWN'
export type AdminMetric<T> = Readonly<{
  value: T | null
  source: string | null
  freshness_at: string | null
  dataset_mode: DatasetMode | null
  status: MetricStatus
}>

const registryRow = z.object({
  workspace_id: z.string().uuid(),
  dataset_mode: z.enum(['ACTUAL', 'TEST', 'CANARY']),
  actor_kind: z.enum(['CUSTOMER', 'OPERATOR', 'TESTER', 'UNCLASSIFIED']),
}).passthrough()
const uuid = z.string().uuid()
const FRESH_FOR_MS = 24 * 60 * 60 * 1000

export function buildMetric<T>(
  input: Omit<AdminMetric<T>, 'status'>,
  now = new Date(),
): AdminMetric<T> {
  const timestamp = input.freshness_at === null ? NaN : Date.parse(input.freshness_at)
  const elapsed = now.getTime() - timestamp
  const status = input.value === null || !input.source?.trim() || !['ACTUAL', 'TEST', 'CANARY'].includes(input.dataset_mode ?? '')
    || !Number.isFinite(elapsed) || elapsed < 0
    ? 'UNKNOWN'
    : elapsed > FRESH_FOR_MS ? 'STALE' : 'FRESH'
  return { ...input, status }
}

export interface SameTruthGateway {
  readRegistry(ids: readonly string[]): Promise<unknown>
  countVault(ids: readonly string[]): Promise<number>
}

type WorkspaceRow = Readonly<{ workspaceId: string; updatedAt: string | null }>
type CardInput = Readonly<{
  workspaces: readonly WorkspaceRow[] | null
  nextCursor: string | null
  gateway: SameTruthGateway
  now?: Date
}>

const unavailable = (source: string): AdminMetric<number> => buildMetric({
  value: null, source, freshness_at: null, dataset_mode: null,
})

/** A complete page and a complete registry join are required to claim a total. */
export async function readWorkspaceAndVaultCards({ workspaces, nextCursor, gateway, now = new Date() }: CardInput) {
  const workspaceSource = 'public.workspaces + public.workspace_registry'
  const vaultSource = 'public.vault_items + public.workspace_registry'
  const unknown = () => ({ workspaces: unavailable(workspaceSource), vault: unavailable(vaultSource) })
  // Empty pages do not prove there are no ACTUAL workspaces, particularly under
  // a filtered query. Keep the aggregate unknown until a complete cohort exists.
  if (workspaces === null || workspaces.length === 0 || nextCursor !== null || workspaces.some((row) => !uuid.safeParse(row.workspaceId).success)
    || new Set(workspaces.map((row) => row.workspaceId)).size !== workspaces.length) return unknown()

  try {
    const wire = await gateway.readRegistry(workspaces.map((row) => row.workspaceId))
    const parsed = z.array(registryRow).safeParse(wire)
    if (!parsed.success || parsed.data.length !== workspaces.length) return unknown()
    const byId = new Map(parsed.data.map((row) => [row.workspace_id, row]))
    if (byId.size !== workspaces.length || workspaces.some((row) => !byId.has(row.workspaceId))) return unknown()
    if (workspaces.some((row) => byId.get(row.workspaceId)!.actor_kind === 'UNCLASSIFIED')) return unknown()
    const actual = workspaces.filter((row) => {
      const classification = byId.get(row.workspaceId)!
      return classification.dataset_mode === 'ACTUAL' && classification.actor_kind === 'CUSTOMER'
    })
    if (actual.length === 0) return unknown()
    const stamp = Math.min(...actual.map((row) => row.updatedAt ? Date.parse(row.updatedAt) : NaN))
    const observedAt = new Date(now.getTime()).toISOString()
    const workspacesMetric = buildMetric({
      value: actual.length,
      source: workspaceSource,
      freshness_at: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
      dataset_mode: 'ACTUAL',
    }, now)
    // Never expose a stale/unknown workspace count as a valid ACTUAL vault cohort.
    if (workspacesMetric.status === 'UNKNOWN') return { workspaces: workspacesMetric, vault: unavailable(vaultSource) }
    let count: number
    try {
      count = await gateway.countVault(actual.map((row) => row.workspaceId))
    } catch {
      return { workspaces: workspacesMetric, vault: unavailable(vaultSource) }
    }
    if (!Number.isSafeInteger(count) || count < 0) return { workspaces: workspacesMetric, vault: unavailable(vaultSource) }
    return {
      workspaces: workspacesMetric,
      vault: buildMetric({ value: count, source: vaultSource, freshness_at: observedAt, dataset_mode: 'ACTUAL' }, now),
    }
  } catch {
    return unknown()
  }
}
