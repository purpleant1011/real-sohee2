import type {
  VaultChannel,
  VaultItem,
} from '../types'
import { toAdminVaultItemDto, toUserVaultItemDto } from './formatters'
import { periodBounds } from './period-bounds'
import type {
  PaginatedResult,
  VaultCalendarDto,
  VaultItemAdminDto,
  VaultItemUserDto,
  VaultListQueryParams,
  VaultSortField,
  VaultSortOrder,
  VaultStatusFilter,
  VaultSummaryDto,
} from './types'

export interface ExternalActionRequestRef {
  id: string
  workspaceId: string
  contentVersionId: string
  channel?: VaultChannel
}

export interface ExternalActionTarget {
  versionId: string
  channel?: VaultChannel
}

export interface IVaultQueryRepository {
  queryItems(workspaceId: string): Promise<VaultItem[]>
  countExternalActionRequestsForVersions(
    workspaceId: string,
    targets: Array<string | ExternalActionTarget>,
  ): Promise<number>
}

interface CursorPayload {
  v: string | null
  id: string
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.id === 'string') {
      return { v: parsed.v ?? null, id: parsed.id }
    }
    return null
  } catch {
    return null
  }
}

/**
 * In-memory repository for unit and boundary tests,
 * verifying isolation, counts, and zero-leak invariants.
 */
export class FakeVaultQueryRepository implements IVaultQueryRepository {
  private items: VaultItem[] = []
  private externalActionRequests: ExternalActionRequestRef[] = []
  public simulateFailure = false

  seedVaultItems(items: VaultItem[]): void {
    this.items = [...items]
  }

  seedExternalActionRequests(requests: ExternalActionRequestRef[]): void {
    this.externalActionRequests = [...requests]
  }

  async queryItems(workspaceId: string): Promise<VaultItem[]> {
    if (this.simulateFailure) {
      throw new Error('Database query failed: simulated connection or RLS error')
    }
    return this.items.filter((item) => item.workspaceId === workspaceId && item.deletedAt === null)
  }

  async countExternalActionRequestsForVersions(
    workspaceId: string,
    targets: Array<string | ExternalActionTarget>,
  ): Promise<number> {
    if (this.simulateFailure) {
      throw new Error('Database query failed: simulated connection or RLS error')
    }
    if (targets.length === 0) return 0
    const normalized: ExternalActionTarget[] = targets.map((t) =>
      typeof t === 'string' ? { versionId: t } : t,
    )
    const versionChannelMap = new Map<string, Set<VaultChannel>>()
    let hasChannelFilter = false
    for (const target of normalized) {
      if (target.channel) {
        hasChannelFilter = true
        let set = versionChannelMap.get(target.versionId)
        if (!set) {
          set = new Set()
          versionChannelMap.set(target.versionId, set)
        }
        set.add(target.channel)
      }
    }
    const versionSet = new Set(normalized.map((t) => t.versionId))

    return this.externalActionRequests.filter((req) => {
      if (req.workspaceId !== workspaceId || !versionSet.has(req.contentVersionId)) return false
      if (hasChannelFilter && req.channel) {
        const allowedChannels = versionChannelMap.get(req.contentVersionId)
        return allowedChannels ? allowedChannels.has(req.channel) : false
      }
      return true
    }).length
  }
}

/**
 * Supabase-backed repository executing workspace-scoped queries.
 */
export class SupabaseVaultQueryRepository implements IVaultQueryRepository {
  constructor(private readonly supabase: any) {}

  async queryItems(workspaceId: string): Promise<VaultItem[]> {
    const { data, error } = await this.supabase
      .from('vault_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)

    if (error || !Array.isArray(data)) {
      throw new Error(error ? `Database query failed: ${error.message} (code: ${error.code})` : 'Database query returned no row list')
    }

    return data.map((row: any) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      contentId: row.content_id,
      versionId: row.version_id,
      channel: row.channel,
      releaseGate: row.release_gate,
      holdReason: row.hold_reason,
      heldAt: row.held_at,
      heldBy: row.held_by,
      targetDate: row.target_date,
      approvedFingerprint: row.approved_fingerprint,
      fingerprintSchemaVersion: row.fingerprint_schema_version,
      policyVersion: row.policy_version,
      specVersion: row.spec_version,
      approvalState: row.approval_state,
      approvedBy: row.approved_by,
      bundleId: row.bundle_id,
      idempotencyKey: row.idempotency_key,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async countExternalActionRequestsForVersions(
    workspaceId: string,
    targets: Array<string | ExternalActionTarget>,
  ): Promise<number> {
    if (targets.length === 0) return 0

    const normalized: ExternalActionTarget[] = targets.map((t) =>
      typeof t === 'string' ? { versionId: t } : t,
    )
    const versionIds = [...new Set(normalized.map((t) => t.versionId))]
    if (versionIds.length === 0) return 0

    const versionChannelMap = new Map<string, Set<VaultChannel>>()
    let hasChannelFilter = false
    for (const target of normalized) {
      if (target.channel) {
        hasChannelFilter = true
        let set = versionChannelMap.get(target.versionId)
        if (!set) {
          set = new Set()
          versionChannelMap.set(target.versionId, set)
        }
        set.add(target.channel)
      }
    }

    const chunkSize = 100
    let totalViolationCount = 0

    for (let i = 0; i < versionIds.length; i += chunkSize) {
      const chunk = versionIds.slice(i, i + chunkSize)

      if (!hasChannelFilter) {
        const { count, error } = await this.supabase
          .from('external_action_requests')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .in('content_version_id', chunk)

        if (error) {
          throw new Error(`External actions count failed: ${error.message}`)
        }

        totalViolationCount += count ?? 0
      } else {
        const { data, error } = await this.supabase
          .from('external_action_requests')
          .select('id, content_version_id, channel')
          .eq('workspace_id', workspaceId)
          .in('content_version_id', chunk)

        if (error || !Array.isArray(data)) {
          throw new Error(error ? `External actions count failed: ${error.message}` : 'External actions count returned no row list')
        }

        const rows = data as Array<{ id: string; content_version_id: string; channel: VaultChannel }>
        for (const row of rows) {
          const channels = versionChannelMap.get(row.content_version_id)
          if (channels && channels.has(row.channel)) {
            totalViolationCount++
          }
        }
      }
    }

    return totalViolationCount
  }
}

export class VaultQueryService {
  constructor(private readonly repository: IVaultQueryRepository) {}

  /**
   * Lists vault items with period, channel, status filtering,
   * deterministic keyset cursor pagination, and user/admin DTO projections.
   */
  async listItems(
    workspaceId: string,
    params: VaultListQueryParams & { view: 'admin' },
  ): Promise<PaginatedResult<VaultItemAdminDto>>
  async listItems(
    workspaceId: string,
    params?: VaultListQueryParams & { view?: 'user' },
  ): Promise<PaginatedResult<VaultItemUserDto>>
  async listItems(
    workspaceId: string,
    params?: VaultListQueryParams,
  ): Promise<PaginatedResult<VaultItemUserDto | VaultItemAdminDto>>
  async listItems(
    workspaceId: string,
    params: VaultListQueryParams = {},
  ): Promise<PaginatedResult<VaultItemUserDto | VaultItemAdminDto>> {
    const rawItems = await this.repository.queryItems(workspaceId)

    // 1. Period filter
    const period = params.period ?? 'all'
    const bounds = periodBounds(period, new Date(), params.ym)

    let filtered = rawItems.filter((item) => {
      if (bounds.isUnscheduled) {
        return item.targetDate === null
      }
      if (bounds.start && bounds.end) {
        if (!item.targetDate) return false
        return item.targetDate >= bounds.start && item.targetDate <= bounds.end
      }
      return true
    })

    // 2. Channel filter
    if (params.channel) {
      filtered = filtered.filter((item) => item.channel === params.channel)
    }

    // 3. Status filter
    if (params.status) {
      filtered = filtered.filter((item) => this.matchesStatusFilter(item, params.status!))
    }

    // 4. Sorting
    const sortField: VaultSortField = params.sort ?? 'target_date'
    const sortOrder: VaultSortOrder = params.order ?? 'asc'
    filtered.sort((a, b) => this.compareItems(a, b, sortField, sortOrder))

    // 5. Cursor filtering
    if (params.cursor) {
      const cursorPayload = decodeCursor(params.cursor)
      if (cursorPayload) {
        filtered = this.applyCursorFilter(filtered, cursorPayload, sortField, sortOrder)
      }
    }

    // 6. Pagination slice
    const limit = Math.max(1, Math.min(params.limit ?? 20, 100))
    const hasMore = filtered.length > limit
    const pageItems = filtered.slice(0, limit)

    let nextCursor: string | null = null
    if (hasMore && pageItems.length > 0) {
      const lastItem = pageItems[pageItems.length - 1]
      const sortVal = this.getSortValue(lastItem, sortField)
      nextCursor = encodeCursor({ v: sortVal, id: lastItem.id })
    }

    // 7. Projection (User vs Admin)
    const isViewAdmin = params.view === 'admin'
    const projectedItems = pageItems.map((item) =>
      isViewAdmin ? toAdminVaultItemDto(item) : toUserVaultItemDto(item),
    )

    return {
      items: projectedItems,
      nextCursor,
      hasMore,
      totalCount: filtered.length,
    }
  }

  /**
   * Calendar view: aggregates counts and channel breakdown per date for the given month.
   */
  async getCalendar(workspaceId: string, ym?: string): Promise<VaultCalendarDto> {
    const rawItems = await this.repository.queryItems(workspaceId)
    const bounds = periodBounds('month', new Date(), ym)
    const targetYm = ym || (bounds.start ? bounds.start.slice(0, 7) : new Date().toISOString().slice(0, 7))

    const days: Record<string, { total: number; channels: Partial<Record<VaultChannel, number>> }> = {}
    let unscheduledCount = 0

    for (const item of rawItems) {
      if (!item.targetDate) {
        unscheduledCount++
        continue
      }

      if (bounds.start && bounds.end) {
        if (item.targetDate >= bounds.start && item.targetDate <= bounds.end) {
          const dateKey = item.targetDate
          if (!days[dateKey]) {
            days[dateKey] = { total: 0, channels: {} }
          }
          days[dateKey].total++
          days[dateKey].channels[item.channel] = (days[dateKey].channels[item.channel] ?? 0) + 1
        }
      }
    }

    return {
      ym: targetYm,
      days,
      unscheduled_count: unscheduledCount,
    }
  }

  /**
   * Summary KPI: computes stored, needs_reapproval, invalidated counts
   * and queries actual external_action_requests count for held items.
   */
  async getSummary(workspaceId: string): Promise<VaultSummaryDto> {
    const rawItems = await this.repository.queryItems(workspaceId)

    let storedCount = 0
    let needsReapprovalCount = 0
    let invalidatedCount = 0
    let thisWeekCount = 0

    const bounds = periodBounds('this_week', new Date())
    const heldTargets: ExternalActionTarget[] = []

    for (const item of rawItems) {
      if (item.approvalState === 'APPROVED') {
        storedCount++
        heldTargets.push({ versionId: item.versionId, channel: item.channel })
      } else if (item.approvalState === 'NEEDS_REAPPROVAL') {
        needsReapprovalCount++
      } else if (item.approvalState === 'INVALIDATED') {
        invalidatedCount++
      }

      if (item.targetDate && bounds.start && bounds.end) {
        if (item.targetDate >= bounds.start && item.targetDate <= bounds.end) {
          thisWeekCount++
        }
      }
    }

    // Actual COUNT of external actions linked to held versions and matching channels
    const externalActionCount = await this.repository.countExternalActionRequestsForVersions(
      workspaceId,
      heldTargets,
    )

    const externalActionWarning =
      externalActionCount > 0
        ? `경고: 보관 상태인 항목에 외부 게시(external_action) 기록이 ${externalActionCount}건 존재합니다. 불변식 위반을 점검하십시오.`
        : null

    return {
      stored_count: storedCount,
      needs_reapproval_count: needsReapprovalCount,
      invalidated_count: invalidatedCount,
      total_count: rawItems.length,
      external_action_count: externalActionCount,
      external_action_warning: externalActionWarning,
      this_week_count: thisWeekCount,
    }
  }

  private matchesStatusFilter(item: VaultItem, filter: VaultStatusFilter | string): boolean {
    switch (filter) {
      case 'held':
      case '보관':
        return item.approvalState === 'APPROVED'
      case 'needs_reapproval':
      case '재확인 필요':
        return item.approvalState === 'NEEDS_REAPPROVAL'
      case 'invalidated':
      case '무효':
        return item.approvalState === 'INVALIDATED'
      case 'on_hold':
      case '보류':
        return item.releaseGate !== null || item.holdReason !== null
      default:
        return true
    }
  }

  private getSortValue(item: VaultItem, field: VaultSortField): string | null {
    switch (field) {
      case 'target_date':
        return item.targetDate
      case 'held_at':
        return item.heldAt
      case 'created_at':
        return item.createdAt
    }
  }

  private compareItems(
    a: VaultItem,
    b: VaultItem,
    field: VaultSortField,
    order: VaultSortOrder,
  ): number {
    const valA = this.getSortValue(a, field)
    const valB = this.getSortValue(b, field)

    // Null values sort last
    if (valA === null && valB === null) return a.id.localeCompare(b.id)
    if (valA === null) return 1
    if (valB === null) return -1

    const cmp = valA.localeCompare(valB)
    if (cmp !== 0) {
      return order === 'asc' ? cmp : -cmp
    }
    return order === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)
  }

  private applyCursorFilter(
    items: VaultItem[],
    cursor: CursorPayload,
    field: VaultSortField,
    order: VaultSortOrder,
  ): VaultItem[] {
    return items.filter((item) => {
      const val = this.getSortValue(item, field)
      if (order === 'asc') {
        if (cursor.v === null) {
          if (val === null) return item.id > cursor.id
          return false
        }
        if (val === null) return true
        if (val > cursor.v) return true
        if (val === cursor.v) return item.id > cursor.id
        return false
      } else {
        // desc
        if (cursor.v === null) {
          if (val === null) return item.id < cursor.id
          return true
        }
        if (val === null) return false
        if (val < cursor.v) return true
        if (val === cursor.v) return item.id < cursor.id
        return false
      }
    })
  }
}
