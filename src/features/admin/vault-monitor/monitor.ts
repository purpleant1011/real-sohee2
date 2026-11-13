import { buildMetric, type AdminMetric } from '../same-truth/read-model'
import {
  VaultQueryService,
  type IVaultQueryRepository,
  type VaultItemAdminDto,
} from '../../vault/query'
import type { VaultApprovalState, VaultChannel, VaultReleaseGate } from '../../vault/types'

export const DEFAULT_STALE_AFTER_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const VAULT_SOURCE = 'public.vault_items'
const INVARIANT_SOURCE = 'public.vault_items + public.external_action_requests'

export interface MonitorWorkspaceRef {
  workspaceId: string
  datasetMode: 'ACTUAL' | 'TEST' | 'CANARY' | null
  actorKind: string | null
}

export interface ExternalActionLink {
  id: string
  workspaceId: string
  contentVersionId: string
  channel: VaultChannel
  status: string
  approvalFingerprint: string | null
}

export type VaultMonitorAccessKind = 'MONITOR_VIEW' | 'INVARIANT_DETAIL_VIEW'

export interface VaultMonitorAccessRecord {
  actorId: string
  accessKind: VaultMonitorAccessKind
  workspaceCount: number
  violationCount: number
  disclosedItemIds: string[]
}

/** The user-facing query repository plus the admin-only reads the monitor needs. */
export interface VaultMonitorRepository extends IVaultQueryRepository {
  listWorkspaces(): Promise<MonitorWorkspaceRef[]>
  listExternalActionLinks(workspaceId: string, versionIds: string[]): Promise<ExternalActionLink[]>
  recordAccess(record: VaultMonitorAccessRecord): Promise<void>
}

export interface GateBreakdown {
  reviewPending: number
  connectionPending: number
  userHeld: number
  releaseRequested: number
}

export interface MonitorItemRow {
  workspaceId: string
  itemId: string
  channelLabel: string
  statusLabel: string
  ageDays: number
}

export interface WorkspaceMonitorRow {
  workspaceId: string
  /** ERROR is never rendered as zero. */
  status: 'OK' | 'ERROR'
  countedInTotals: boolean
  datasetMode: MonitorWorkspaceRef['datasetMode']
  storedCount: number | null
  needsReapprovalCount: number | null
  invalidatedCount: number | null
  channelDistribution: Array<{ channelLabel: string; count: number }>
  gates: GateBreakdown
  oldestHeldAgeDays: number | null
}

export interface InvariantViolation {
  workspaceId: string
  itemId: string
  channelLabel: string
  releaseGate: VaultReleaseGate
  approvalState: VaultApprovalState
  /** Admin-only chain. Blank when audit recording failed (details withheld). */
  approvedFingerprint: string | null
  externalActions: Array<{ id: string; status: string; approvalFingerprint: string | null }>
}

export type VaultMonitorResult =
  | { kind: 'error'; message: string }
  | {
      kind: 'ok'
      observedAt: string
      staleAfterDays: number
      workspaces: WorkspaceMonitorRow[]
      failedWorkspaceCount: number
      cards: {
        stored: AdminMetric<number>
        needsReapproval: AdminMetric<number>
        invalidated: AdminMetric<number>
        violations: AdminMetric<number>
        staleHeld: AdminMetric<number>
        neglectedInvalidated: AdminMetric<number>
      }
      violations: InvariantViolation[]
      /** True when a violation exists but the audit record failed, so IDs/fingerprints are hidden. */
      detailsWithheld: boolean
      staleHeld: MonitorItemRow[]
      neglectedInvalidated: MonitorItemRow[]
    }

const CHANNEL_ORDER: VaultChannel[] = ['instagram', 'threads', 'naver_blog', 'daangn_business']

function ageDays(from: string | null, now: Date): number {
  const t = from ? Date.parse(from) : NaN
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
}

/** Pages through the user-screen service with the admin projection so both views share one model. */
async function readAllAdminItems(service: VaultQueryService, workspaceId: string): Promise<VaultItemAdminDto[]> {
  const all: VaultItemAdminDto[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 1000; guard++) {
    const page = await service.listItems(workspaceId, {
      view: 'admin', limit: 100, sort: 'created_at', order: 'asc', cursor,
    })
    all.push(...page.items)
    if (!page.hasMore || !page.nextCursor) return all
    cursor = page.nextCursor
  }
  throw new Error('VAULT_PAGINATION_GUARD')
}

export function parseStaleAfterDays(raw: string | undefined): number {
  const parsed = raw === undefined ? NaN : Number(raw)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : DEFAULT_STALE_AFTER_DAYS
}

export async function buildVaultMonitor(input: {
  repository: VaultMonitorRepository
  actorId: string
  now?: Date
  staleAfterDays?: number
}): Promise<VaultMonitorResult> {
  const { repository, actorId } = input
  const now = input.now ?? new Date()
  const staleAfterDays = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
  const observedAt = now.toISOString()

  let refs: MonitorWorkspaceRef[]
  try {
    refs = await repository.listWorkspaces()
  } catch {
    return { kind: 'error', message: '보관함 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  const service = new VaultQueryService(repository)
  const workspaces: WorkspaceMonitorRow[] = []
  const violations: InvariantViolation[] = []
  const staleHeld: MonitorItemRow[] = []
  const neglectedInvalidated: MonitorItemRow[] = []
  let failedTotals = 0
  let failedAny = 0

  for (const ref of refs) {
    const counted = ref.datasetMode === 'ACTUAL' && ref.actorKind === 'CUSTOMER'
    const gates: GateBreakdown = { reviewPending: 0, connectionPending: 0, userHeld: 0, releaseRequested: 0 }
    try {
      const summary = await service.getSummary(ref.workspaceId)
      const items = await readAllAdminItems(service, ref.workspaceId)
      const channelCounts = new Map<VaultChannel, number>()
      let oldest: number | null = null

      const heldCandidates = items.filter((item) => item.releaseGate !== null)
      const links = heldCandidates.length
        ? await repository.listExternalActionLinks(ref.workspaceId, heldCandidates.map((item) => item.versionId))
        : []

      for (const item of items) {
        if (item.releaseGate === 'HELD_PROVIDER_PENDING') gates.reviewPending++
        else if (item.releaseGate === 'HELD_CONNECTION_PENDING') gates.connectionPending++
        else if (item.releaseGate === 'HELD_USER') gates.userHeld++
        else if (item.releaseGate === 'RELEASE_REQUESTED') gates.releaseRequested++

        const base = item.heldAt ?? item.createdAt
        if (item.approvalState === 'APPROVED') {
          channelCounts.set(item.channel, (channelCounts.get(item.channel) ?? 0) + 1)
          const age = ageDays(base, now)
          oldest = oldest === null ? age : Math.max(oldest, age)
          if (age > staleAfterDays) {
            staleHeld.push({ workspaceId: ref.workspaceId, itemId: item.id, channelLabel: item.channelLabel, statusLabel: item.statusLabel, ageDays: age })
          }
        } else if (item.approvalState === 'INVALIDATED') {
          const age = ageDays(item.updatedAt, now)
          if (age > staleAfterDays) {
            neglectedInvalidated.push({ workspaceId: ref.workspaceId, itemId: item.id, channelLabel: item.channelLabel, statusLabel: item.statusLabel, ageDays: age })
          }
        }
      }

      for (const item of heldCandidates) {
        const linked = links.filter((link) => link.workspaceId === ref.workspaceId && link.contentVersionId === item.versionId && link.channel === item.channel)
        if (linked.length === 0) continue
        violations.push({
          workspaceId: ref.workspaceId,
          itemId: item.id,
          channelLabel: item.channelLabel,
          releaseGate: item.releaseGate,
          approvalState: item.approvalState,
          approvedFingerprint: item.approvedFingerprint,
          externalActions: linked.map((link) => ({ id: link.id, status: link.status, approvalFingerprint: link.approvalFingerprint })),
        })
      }

      workspaces.push({
        workspaceId: ref.workspaceId,
        status: 'OK',
        countedInTotals: counted,
        datasetMode: ref.datasetMode,
        storedCount: summary.stored_count,
        needsReapprovalCount: summary.needs_reapproval_count,
        invalidatedCount: summary.invalidated_count,
        channelDistribution: CHANNEL_ORDER.filter((c) => channelCounts.has(c)).map((c) => ({
          channelLabel: items.find((i) => i.channel === c)!.channelLabel,
          count: channelCounts.get(c)!,
        })),
        gates,
        oldestHeldAgeDays: oldest,
      })
    } catch {
      failedAny++
      if (counted) failedTotals++
      workspaces.push({
        workspaceId: ref.workspaceId, status: 'ERROR', countedInTotals: counted, datasetMode: ref.datasetMode,
        storedCount: null, needsReapprovalCount: null, invalidatedCount: null,
        channelDistribution: [], gates, oldestHeldAgeDays: null,
      })
    }
  }

  // Disclosing IDs/fingerprints requires a durable audit record first (fail-closed).
  let detailsWithheld = false
  const accessKind: VaultMonitorAccessKind = violations.length > 0 ? 'INVARIANT_DETAIL_VIEW' : 'MONITOR_VIEW'
  try {
    await repository.recordAccess({
      actorId, accessKind, workspaceCount: refs.length, violationCount: violations.length,
      disclosedItemIds: violations.map((v) => v.itemId),
    })
  } catch {
    detailsWithheld = violations.length > 0
  }
  const shownViolations = detailsWithheld
    ? violations.map((v) => ({ ...v, itemId: '', approvedFingerprint: null, externalActions: [] }))
    : violations

  const counted = workspaces.filter((w) => w.countedInTotals && w.status === 'OK')
  const sum = (pick: (w: WorkspaceMonitorRow) => number | null) => counted.reduce((acc, w) => acc + (pick(w) ?? 0), 0)
  const inCounted = (row: MonitorItemRow) => workspaces.some((w) => w.workspaceId === row.workspaceId && w.countedInTotals)
  const totalsKnown = failedTotals === 0
  const metric = (value: number, known: boolean, source: string) => buildMetric({
    value: known ? value : null, source, freshness_at: observedAt, dataset_mode: 'ACTUAL',
  }, now)

  return {
    kind: 'ok',
    observedAt,
    staleAfterDays,
    workspaces,
    failedWorkspaceCount: failedAny,
    cards: {
      stored: metric(sum((w) => w.storedCount), totalsKnown, VAULT_SOURCE),
      needsReapproval: metric(sum((w) => w.needsReapprovalCount), totalsKnown, VAULT_SOURCE),
      invalidated: metric(sum((w) => w.invalidatedCount), totalsKnown, VAULT_SOURCE),
      // The invariant covers every workspace; one unreadable workspace means "0" cannot be claimed.
      violations: metric(violations.length, failedAny === 0, INVARIANT_SOURCE),
      staleHeld: metric(staleHeld.filter(inCounted).length, totalsKnown, VAULT_SOURCE),
      neglectedInvalidated: metric(neglectedInvalidated.filter(inCounted).length, totalsKnown, VAULT_SOURCE),
    },
    violations: shownViolations,
    detailsWithheld,
    staleHeld: staleHeld.sort((a, b) => b.ageDays - a.ageDays),
    neglectedInvalidated: neglectedInvalidated.sort((a, b) => b.ageDays - a.ageDays),
  }
}
