import { FakeVaultQueryRepository, SupabaseVaultQueryRepository, type ExternalActionTarget } from '../../vault/query'
import type { VaultChannel, VaultItem } from '../../vault/types'
import type {
  ExternalActionLink,
  MonitorWorkspaceRef,
  VaultMonitorAccessRecord,
  VaultMonitorRepository,
} from './monitor'

type Db = { from(table: string): any }

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** Service-role reads only; operator authorization is enforced by the page before this is created. */
export class SupabaseVaultMonitorRepository extends SupabaseVaultQueryRepository implements VaultMonitorRepository {
  constructor(private readonly db: Db) {
    super(db)
  }

  async listWorkspaces(): Promise<MonitorWorkspaceRef[]> {
    const pageSize = 1000
    let page = 0
    let allItems: Array<{ workspace_id: string }> = []

    while (true) {
      const baseQuery = this.db.from('vault_items').select('workspace_id').is('deleted_at', null)
      const hasRange = typeof baseQuery.range === 'function'
      const query = hasRange ? baseQuery.range(page * pageSize, (page + 1) * pageSize - 1) : baseQuery
      const items = await query
      if (items.error || !Array.isArray(items.data)) throw new Error('VAULT_WORKSPACES_UNAVAILABLE')
      allItems = allItems.concat(items.data)
      if (items.data.length < pageSize || !hasRange) {
        if (items.data.length >= pageSize && !hasRange) {
          throw new Error('VAULT_WORKSPACES_TRUNCATED')
        }
        break
      }
      page++
    }

    const ids = [...new Set<string>(allItems.map((row: { workspace_id: string }) => row.workspace_id))]
    if (ids.length === 0) return []

    const byId = new Map<string, { dataset_mode: MonitorWorkspaceRef['datasetMode']; actor_kind: string }>()
    for (const chunk of chunkArray(ids, 100)) {
      const registry = await this.db.from('workspace_registry').select('workspace_id,dataset_mode,actor_kind').in('workspace_id', chunk)
      if (registry.error || !Array.isArray(registry.data)) throw new Error('REGISTRY_UNAVAILABLE')
      for (const row of registry.data) {
        byId.set(row.workspace_id, row)
      }
    }

    return ids.map((workspaceId) => ({
      workspaceId,
      datasetMode: byId.get(workspaceId)?.dataset_mode ?? null,
      actorKind: byId.get(workspaceId)?.actor_kind ?? null,
    }))
  }

  async listExternalActionLinks(workspaceId: string, versionIds: string[]): Promise<ExternalActionLink[]> {
    if (versionIds.length === 0) return []
    const allLinks: ExternalActionLink[] = []

    for (const chunk of chunkArray(versionIds, 100)) {
      const result = await this.db.from('external_action_requests')
        .select('id,workspace_id,content_version_id,channel,status,approval_fingerprint')
        .eq('workspace_id', workspaceId)
        .in('content_version_id', chunk)
      if (result.error || !Array.isArray(result.data)) throw new Error('EXTERNAL_ACTIONS_UNAVAILABLE')
      for (const row of result.data) {
        allLinks.push({
          id: row.id,
          workspaceId: row.workspace_id,
          contentVersionId: row.content_version_id,
          channel: row.channel,
          status: row.status,
          approvalFingerprint: row.approval_fingerprint,
        })
      }
    }

    return allLinks
  }

  async recordAccess(record: VaultMonitorAccessRecord): Promise<void> {
    const result = await this.db.from('vault_monitor_access_events').insert({
      actor_id: record.actorId,
      access_kind: record.accessKind,
      workspace_count: record.workspaceCount,
      violation_count: record.violationCount,
      disclosed_item_ids: `{${record.disclosedItemIds.join(',')}}`,
    })
    if (result.error) throw new Error('VAULT_MONITOR_AUDIT_UNAVAILABLE')
  }
}

/** In-memory double for unit tests. */
export class FakeVaultMonitorRepository extends FakeVaultQueryRepository implements VaultMonitorRepository {
  workspaces: MonitorWorkspaceRef[] = []
  links: ExternalActionLink[] = []
  accessLog: VaultMonitorAccessRecord[] = []
  failAudit = false
  failWorkspaceIds = new Set<string>()
  override async queryItems(workspaceId: string): Promise<VaultItem[]> {
    if (this.failWorkspaceIds.has(workspaceId)) throw new Error('simulated workspace failure')
    return super.queryItems(workspaceId)
  }

  override async countExternalActionRequestsForVersions(
    workspaceId: string,
    targets: Array<string | ExternalActionTarget>,
  ): Promise<number> {
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

    return this.links.filter((l) => {
      if (l.workspaceId !== workspaceId || !versionSet.has(l.contentVersionId)) return false
      if (hasChannelFilter && l.channel) {
        const allowedChannels = versionChannelMap.get(l.contentVersionId)
        return allowedChannels ? allowedChannels.has(l.channel) : false
      }
      return true
    }).length
  }

  async listWorkspaces(): Promise<MonitorWorkspaceRef[]> {
    if (this.simulateFailure) throw new Error('simulated')
    return this.workspaces
  }

  async listExternalActionLinks(workspaceId: string, versionIds: string[]): Promise<ExternalActionLink[]> {
    const set = new Set(versionIds)
    return this.links.filter((l) => l.workspaceId === workspaceId && set.has(l.contentVersionId))
  }

  async recordAccess(record: VaultMonitorAccessRecord): Promise<void> {
    if (this.failAudit) throw new Error('audit down')
    this.accessLog.push(record)
  }
}
