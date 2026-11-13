import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  operatorChannelFiltersSchema,
  operatorChannelResponseSchema,
  type OperatorChannelConnection,
  type OperatorChannelFilters,
} from './schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
export type OperatorChannelRpcGateway = Readonly<{
  rpc(name: 'list_operator_channel_connections_v2', args: Readonly<Record<string, unknown>>): Promise<RpcResult>
}>

export type BrowserChannelRecord = Readonly<{
  id: string
  workspaceId: string
  workspaceName?: string | null
  channel: string
  accountLabel: string | null
  status: string
  lastSeenAt: string | null
  verifiedAt?: string | null
  updatedAt: string
  clientVersion?: string | null
  metadata?: Record<string, unknown> | null
}>

export type BrowserChannelGateway = Readonly<{
  listBrowserConnections(filters: Readonly<{ workspaceId?: string; channel?: string; limit?: number }>): Promise<{
    data: readonly BrowserChannelRecord[] | null
    error: unknown
  }>
}>

type Result = Readonly<{
  data: readonly OperatorChannelConnection[] | null
  sourceState?: 'ready' | 'empty' | 'not_connected' | 'unavailable'
  referenceTime?: number
  error: 'CHANNEL_INPUT_INVALID' | 'CHANNEL_LIST_UNAVAILABLE' | null
}>

async function productionGateway(): Promise<OperatorChannelRpcGateway> {
  const supabase = await createServerSupabaseClient()
  return {
    rpc: (name, args) =>
      (supabase as unknown as { rpc(rpcName: string, rpcArgs: Record<string, unknown>): Promise<RpcResult> }).rpc(name, args),
  }
}

async function productionBrowserGateway(): Promise<BrowserChannelGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient() as any
  return {
    async listBrowserConnections({ workspaceId, channel, limit = 100 }) {
      try {
        let query = supabase
          .from('browser_channel_connections')
          .select('id, workspace_id, device_id, channel, external_account_label, status, last_seen_at, verified_at, updated_at')
          .order('updated_at', { ascending: false })
          .limit(limit)

        if (workspaceId) {
          query = query.eq('workspace_id', workspaceId)
        }
        if (channel) {
          query = query.eq('channel', channel)
        } else {
          query = query.eq('channel', 'naver_blog')
        }

        const { data: conns, error: connErr } = await query
        if (connErr || !conns) {
          return { data: null, error: connErr }
        }

        const workspaceIds = [...new Set(conns.map((c: any) => c.workspace_id).filter(Boolean))]
        const deviceIds = [...new Set(conns.map((c: any) => c.device_id).filter(Boolean))]

        const [wsRes, devRes] = await Promise.all([
          workspaceIds.length > 0
            ? supabase.from('workspaces').select('id, name').in('id', workspaceIds)
            : Promise.resolve({ data: [] }),
          deviceIds.length > 0
            ? supabase.from('connector_devices').select('id, client_version, last_seen_at').in('id', deviceIds)
            : Promise.resolve({ data: [] }),
        ])

        const wsMap = new Map<string, string>()
        if (Array.isArray(wsRes.data)) {
          for (const w of wsRes.data) {
            if (w.id && w.name) wsMap.set(w.id, w.name)
          }
        }

        const devMap = new Map<string, { clientVersion?: string; lastSeenAt?: string }>()
        if (Array.isArray(devRes.data)) {
          for (const d of devRes.data) {
            if (d.id) devMap.set(d.id, { clientVersion: d.client_version, lastSeenAt: d.last_seen_at })
          }
        }

        const items: BrowserChannelRecord[] = conns.map((c: any) => {
          const dev = c.device_id ? devMap.get(c.device_id) : undefined
          return {
            id: c.id,
            workspaceId: c.workspace_id,
            workspaceName: wsMap.get(c.workspace_id) ?? null,
            channel: c.channel,
            accountLabel: c.external_account_label ?? null,
            status: c.status,
            lastSeenAt: c.last_seen_at ?? dev?.lastSeenAt ?? null,
            verifiedAt: c.verified_at ?? null,
            updatedAt: c.updated_at || new Date().toISOString(),
            clientVersion: dev?.clientVersion ?? null,
            metadata: null,
          }
        })

        return { data: items, error: null }
      } catch (err) {
        return { data: null, error: err }
      }
    },
  }
}

function mapBrowserStatusToConnectionStatus(status: string): OperatorChannelConnection['connectionStatus'] {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'reauth_required':
      return 'reverify_required'
    case 'target_mismatch':
      return 'wrong_account'
    case 'revoked':
    case 'disconnected':
      return 'disconnected'
    case 'expired':
      return 'expired'
    case 'connecting':
      return 'connecting'
    case 'missing_permission':
      return 'missing_permission'
    case 'provider_error':
      return 'provider_error'
    default:
      return 'error'
  }
}

export async function listOperatorChannelConnections(
  input: OperatorChannelFilters = {},
  dependencies?: Readonly<{
    gateway?: OperatorChannelRpcGateway
    now?: () => number
    browserGateway?: BrowserChannelGateway
  }>,
): Promise<Result> {
  const parsed = operatorChannelFiltersSchema.safeParse(input)
  if (!parsed.success) return { data: null, sourceState: 'unavailable', error: 'CHANNEL_INPUT_INVALID' }

  try {
    const nowFn = dependencies?.now ?? Date.now
    const nowTime = nowFn()
    const targetChannel = parsed.data.channel

    let rpcConnections: OperatorChannelConnection[] = []
    let sourceState: 'ready' | 'empty' | 'not_connected' | 'unavailable' = 'ready'

    // 1. Fetch from RPC when targetChannel is undefined or is instagram/threads
    if (!targetChannel || targetChannel === 'instagram' || targetChannel === 'threads') {
      const gateway = dependencies?.gateway ?? await productionGateway()
      const result = await gateway.rpc('list_operator_channel_connections_v2', {
        p_workspace_id: parsed.data.workspaceId ?? null,
        p_channel: targetChannel ?? null,
        p_connection_status: parsed.data.connectionStatus ?? null,
        p_delegation_status: parsed.data.delegationStatus ?? null,
        p_risk: parsed.data.risk ?? null,
        p_limit: parsed.data.limit,
      })
      if (result.error) return { data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' }
      const wire = operatorChannelResponseSchema.safeParse(result.data)
      if (!wire.success) return { data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' }

      rpcConnections = wire.data.items.map((item) =>
        Object.freeze({
          workspaceId: item.workspace_id,
          workspaceName: item.workspace_name,
          channel: item.channel,
          accountLabel: item.account_label,
          connectionStatus: item.connection_status,
          delegationStatus: item.delegation_status,
          technicalPermissionStatus: item.technical_permission_status,
          tokenExpiresAt: item.token_expires_at,
          webhookStatus: item.webhook_status,
          lastWebhookAt: item.last_webhook_at,
          lastProviderEventAt: item.last_provider_event_at,
          lastErrorCode: item.last_error_code,
          updatedAt: item.updated_at,
          freshness: item.freshness,
          connectorType: item.connector_type ?? 'oauth',
          lastHeartbeatAt: item.last_heartbeat_at ?? null,
          extensionVersion: item.extension_version ?? null,
        }),
      )
      sourceState = wire.data.source_state ?? (rpcConnections.length === 0 ? 'empty' : 'ready')
    }

    // 2. Fetch from browser_channel_connections when targetChannel is undefined or is naver_blog
    let browserConnections: OperatorChannelConnection[] = []
    if (!targetChannel || targetChannel === 'naver_blog') {
      const browserGateway = dependencies?.browserGateway
        ?? (dependencies?.gateway ? { listBrowserConnections: async () => ({ data: [], error: null }) } : await productionBrowserGateway())

      const bResult = await browserGateway.listBrowserConnections({
        workspaceId: parsed.data.workspaceId,
        channel: targetChannel ?? 'naver_blog',
        limit: parsed.data.limit,
      })

      if (bResult.error && targetChannel === 'naver_blog') {
        return { data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' }
      }

      if (bResult.data) {
        browserConnections = bResult.data
          .filter((row) => row.channel === 'naver_blog')
          .map((row) => {
            const mappedStatus = mapBrowserStatusToConnectionStatus(row.status)
            const isFresh = row.lastSeenAt
              ? nowTime - new Date(row.lastSeenAt).getTime() < 24 * 60 * 60 * 1000
              : false

            return Object.freeze({
              id: row.id,
              workspaceId: row.workspaceId,
              workspaceName: row.workspaceName ?? '고객사',
              channel: 'naver_blog' as const,
              accountLabel: row.accountLabel,
              connectionStatus: mappedStatus,
              delegationStatus: 'accepted' as const,
              technicalPermissionStatus: mappedStatus === 'connected' ? ('ready' as const) : ('unknown' as const),
              tokenExpiresAt: null,
              webhookStatus: 'healthy' as const,
              lastWebhookAt: null,
              lastProviderEventAt: row.lastSeenAt,
              lastErrorCode: mappedStatus === 'error' ? 'EXTENSION_ERROR' : null,
              updatedAt: row.updatedAt,
              freshness: isFresh ? ('fresh' as const) : ('stale' as const),
              connectorType: 'browser_extension' as const,
              lastHeartbeatAt: row.lastSeenAt,
              extensionVersion: row.clientVersion ?? null,
              metadata: row.metadata ?? null,
            })
          })

        // Apply filters on browserConnections
        if (parsed.data.connectionStatus) {
          browserConnections = browserConnections.filter((c) => c.connectionStatus === parsed.data.connectionStatus)
        }
        if (parsed.data.delegationStatus) {
          browserConnections = browserConnections.filter((c) => c.delegationStatus === parsed.data.delegationStatus)
        }
        if (parsed.data.risk) {
          browserConnections = browserConnections.filter((c) => {
            const isNormal = c.connectionStatus === 'connected' || c.connectionStatus === 'disconnected'
            return parsed.data.risk === (isNormal ? 'normal' : 'attention')
          })
        }
      }
    }

    // workspace 경계: RPC·admin 조회가 필터를 무시하고 다른 workspace 행을 돌려주면
    // 빈 목록으로 숨기지 않고 fail-closed 한다(RLS 누락을 조용히 가리지 않는다).
    const requestedWorkspaceId = parsed.data.workspaceId
    if (
      requestedWorkspaceId
      && [...rpcConnections, ...browserConnections].some((c) => c.workspaceId !== requestedWorkspaceId)
    ) {
      return { data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' }
    }

    const merged = [...rpcConnections, ...browserConnections]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, parsed.data.limit)

    const finalSourceState = merged.length === 0 ? (targetChannel ? 'empty' : sourceState === 'empty' ? 'empty' : 'ready') : 'ready'

    return {
      data: merged,
      sourceState: merged.length === 0 ? 'empty' : finalSourceState,
      referenceTime: nowTime,
      error: null,
    }
  } catch {
    return { data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' }
  }
}
