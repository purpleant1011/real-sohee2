import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const channel = z.enum(['instagram', 'threads', 'naver_blog'])
const delegation = z.enum(['accepted', 'withdrawn', 'expired', 'unknown'])
const permission = z.enum(['ready', 'missing', 'expired', 'wrong_account', 'provider_error', 'unknown'])
const freshness = z.enum(['fresh', 'stale', 'unknown', 'empty', 'error'])
const connectionStatus = z.enum(['disconnected', 'connecting', 'connected', 'expired', 'reverify_required', 'missing_permission', 'wrong_account', 'provider_error', 'error']).catch('error')
const webhookStatus = z.enum(['pending', 'healthy', 'stale', 'error'])

export const operatorChannelRowSchema = z.object({
  workspace_id: uuid,
  workspace_name: z.string().min(1).max(200),
  channel,
  account_label: z.string().max(255).nullable(),
  connection_status: connectionStatus,
  delegation_status: delegation,
  technical_permission_status: permission,
  token_expires_at: timestamp.nullable(),
  webhook_status: webhookStatus,
  last_webhook_at: timestamp.nullable(),
  last_provider_event_at: timestamp.nullable(),
  last_error_code: z.string().max(120).nullable(),
  updated_at: timestamp,
  freshness,
  connector_type: z.enum(['oauth', 'browser_extension']).optional(),
  last_heartbeat_at: timestamp.nullable().optional(),
  extension_version: z.string().max(50).nullable().optional(),
}).strict()

export const operatorChannelResponseSchema = z.object({ items: z.array(operatorChannelRowSchema), source_state: z.enum(['ready', 'empty', 'not_connected']).optional() }).strict()
export const operatorChannelFiltersSchema = z.object({
  workspaceId: uuid.optional(),
  channel: channel.optional(),
  connectionStatus: connectionStatus.optional(),
  delegationStatus: delegation.optional(),
  risk: z.enum(['normal', 'attention']).optional(),
  limit: z.number().int().min(1).max(100).default(100),
}).strict()

export type OperatorChannelConnection = Readonly<{
  id?: string
  workspaceId: string
  workspaceName: string
  channel: 'instagram' | 'threads' | 'naver_blog'
  accountLabel: string | null
  connectionStatus: z.infer<typeof connectionStatus>
  delegationStatus: z.infer<typeof delegation>
  technicalPermissionStatus: z.infer<typeof permission>
  tokenExpiresAt: string | null
  webhookStatus: z.infer<typeof webhookStatus>
  lastWebhookAt: string | null
  lastProviderEventAt: string | null
  lastErrorCode: string | null
  updatedAt: string
  freshness: z.infer<typeof freshness>
  connectorType?: 'oauth' | 'browser_extension'
  lastHeartbeatAt?: string | null
  extensionVersion?: string | null
  metadata?: Record<string, unknown> | null
}>
export type OperatorChannelSourceState = 'ready' | 'empty' | 'not_connected' | 'unavailable'

export type OperatorChannelFilters = z.input<typeof operatorChannelFiltersSchema>
