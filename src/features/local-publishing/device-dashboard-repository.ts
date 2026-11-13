import 'server-only'

import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true }).nullable()

const deviceRowSchema = z.object({
  id: uuid,
  display_name: z.string().min(1).max(120),
  platform: z.enum(['windows', 'macos']),
  client_version: z.string().min(1).max(40),
  status: z.enum(['active', 'stale', 'revoked']),
  last_seen_at: timestamp,
}).strict()

const connectionRowSchema = z.object({
  id: uuid,
  device_id: uuid,
  channel: z.enum(['naver_blog', 'daangn_business']),
  external_account_label: z.string().min(1).max(255),
  target_url: z.string().url().max(2_048),
  environment: z.enum(['test', 'production']),
  status: z.enum(['connected', 'reauth_required', 'target_mismatch', 'unavailable', 'revoked']),
  last_seen_at: timestamp,
}).strict()

export type ConnectorDeviceView = Readonly<{
  id: string
  displayName: string
  platform: 'windows' | 'macos'
  clientVersion: string
  status: 'active' | 'stale' | 'revoked'
  lastSeenAt: string | null
}>

export type BrowserConnectionView = Readonly<{
  id: string
  deviceId: string
  channel: 'naver_blog' | 'daangn_business'
  accountLabel: string
  targetUrl: string
  environment: 'test' | 'production'
  status: 'connected' | 'reauth_required' | 'target_mismatch' | 'unavailable' | 'revoked'
  lastSeenAt: string | null
}>

export type ConnectorDashboardData = Readonly<{
  devices: readonly ConnectorDeviceView[]
  connections: readonly BrowserConnectionView[]
}>

export async function getConnectorDashboard(workspaceId: string): Promise<ConnectorDashboardData> {
  if (!uuid.safeParse(workspaceId).success) return Object.freeze({ devices: [], connections: [] })
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  const [deviceResult, connectionResult] = await Promise.all([
    supabase.from('connector_devices')
      .select('id, display_name, platform, client_version, status, last_seen_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    supabase.from('browser_channel_connections')
      .select('id, device_id, channel, external_account_label, target_url, environment, status, last_seen_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
  ])
  const devices = z.array(deviceRowSchema).safeParse(deviceResult.data)
  const connections = z.array(connectionRowSchema).safeParse(connectionResult.data)
  if (deviceResult.error || connectionResult.error || !devices.success || !connections.success) {
    return Object.freeze({ devices: [], connections: [] })
  }
  return Object.freeze({
    devices: Object.freeze(devices.data.map((row) => Object.freeze({
      id: row.id,
      displayName: row.display_name,
      platform: row.platform,
      clientVersion: row.client_version,
      status: row.status,
      lastSeenAt: row.last_seen_at,
    }))),
    connections: Object.freeze(connections.data.map((row) => Object.freeze({
      id: row.id,
      deviceId: row.device_id,
      channel: row.channel,
      accountLabel: row.external_account_label,
      targetUrl: row.target_url,
      environment: row.environment,
      status: row.status,
      lastSeenAt: row.last_seen_at,
    }))),
  })
}
