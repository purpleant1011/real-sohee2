import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  clientCursorSchema,
  listInputSchema,
  listRpcResponseSchema,
  operatorWorkspaceDetailSchema,
  type OperatorWorkspaceDetail,
  type OperatorWorkspaceSummary,
  type WorkspaceErrorCode,
  type WorkspaceListResult,
} from './schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>

export type OperatorWorkspaceRpcGateway = Readonly<{
  rpc(name: 'list_operator_workspaces', args: Readonly<{
    p_cursor_created_at: string | null
    p_cursor_id: string | null
    p_cursor_fingerprint: string | null
    p_query: string | null
    p_status: string | null
    p_limit: number
    p_member_filter?: string | null
  }>): Promise<RpcResult>
  rpc(name: 'get_operator_workspace_detail', args: Readonly<{ p_workspace_id: string }>): Promise<RpcResult>
}>

type Dependencies = Readonly<{ gateway: OperatorWorkspaceRpcGateway; now?: Date }>
type Result<T> = Readonly<
  | { data: T; error: null }
  | { data: null; error: WorkspaceErrorCode }
>

const dbErrors = new Set<WorkspaceErrorCode>([
  'AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED',
  'OPERATOR_SCOPE_DENIED', 'WORKSPACE_INPUT_INVALID', 'CURSOR_INVALID',
  'WORKSPACE_LIST_UNAVAILABLE', 'WORKSPACE_DETAIL_UNAVAILABLE',
])

function safeError(error: unknown, fallback: WorkspaceErrorCode): WorkspaceErrorCode {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  return dbErrors.has(message as WorkspaceErrorCode) ? message as WorkspaceErrorCode : fallback
}

export function encodeWorkspaceCursor(cursor: z.infer<typeof clientCursorSchema>): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeWorkspaceCursor(value: string): z.infer<typeof clientCursorSchema> {
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('CURSOR_INVALID')
  }
  const parsed = clientCursorSchema.safeParse(decoded)
  if (!parsed.success) throw new Error('CURSOR_INVALID')
  return parsed.data
}

function freshness(
  source: z.infer<typeof listRpcResponseSchema>['items'][number]['source_timestamps'],
  now: Date,
): OperatorWorkspaceSummary['dataFreshness'] {
  if (source.workspace === null) return 'unknown'
  const available = Object.values(source).filter((value): value is string => value !== null)
  const timestamps = available.map((value) => Date.parse(value))
  if (timestamps.some((value) => !Number.isFinite(value) || value > now.getTime())) return 'unknown'
  return timestamps.some((value) => now.getTime() - value > 86_400_000) ? 'stale' : 'fresh'
}

function mapItem(item: z.infer<typeof listRpcResponseSchema>['items'][number], now: Date): OperatorWorkspaceSummary {
  return Object.freeze({
    workspaceId: item.workspace_id,
    workspaceName: item.workspace_name,
    timezone: item.timezone,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    workspaceKind: item.workspace_kind,
    lifecycleStatus: item.lifecycle_status,
    businessName: item.business_name,
    agreementStatus: item.agreement_status,
    planCode: item.plan_code,
    memberCount: item.member_count,
    availableCredits: item.available_credits,
    instagramStatus: item.instagram_status,
    threadsStatus: item.threads_status,
    publishedThisMonth: item.published_this_month,
    failedThisMonth: item.failed_this_month,
    lastActivityAt: item.last_activity_at,
    dataFreshness: freshness(item.source_timestamps, now),
    memberStatus: item.member_status,
  })
}

async function productionGateway(): Promise<OperatorWorkspaceRpcGateway> {
  const supabase = await createServerSupabaseClient()
  return {
    async rpc(name, args) {
      return supabase.rpc(name as never, args as never) as unknown as RpcResult
    },
  }
}

export async function listOperatorWorkspaces(
  input: unknown,
  dependencies?: Dependencies,
): Promise<Result<WorkspaceListResult>> {
  const parsed = listInputSchema.safeParse(input)
  if (!parsed.success) return { data: null, error: 'WORKSPACE_INPUT_INVALID' }
  const normalizedQuery = parsed.data.query?.trim() || null

  let cursor: z.infer<typeof clientCursorSchema> | null = null
  if (parsed.data.cursor !== null) {
    try {
      cursor = decodeWorkspaceCursor(parsed.data.cursor)
      if (
        cursor.query !== normalizedQuery ||
        cursor.status !== parsed.data.status ||
        (cursor.member ?? null) !== (parsed.data.member ?? null)
      ) {
        return { data: null, error: 'CURSOR_INVALID' }
      }
    } catch {
      return { data: null, error: 'CURSOR_INVALID' }
    }
  }

  let result: RpcResult
  try {
    const gateway = dependencies?.gateway ?? await productionGateway()
    result = await gateway.rpc('list_operator_workspaces', {
      p_cursor_created_at: cursor?.created_at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_cursor_fingerprint: cursor?.cursor_fingerprint ?? null,
      p_query: normalizedQuery,
      p_status: parsed.data.status,
      p_limit: parsed.data.limit,
      p_member_filter: parsed.data.member ?? null,
    })
  } catch (error) {
    return { data: null, error: safeError(error, 'WORKSPACE_LIST_UNAVAILABLE') }
  }
  if (result.error) return { data: null, error: safeError(result.error, 'WORKSPACE_LIST_UNAVAILABLE') }
  const wire = listRpcResponseSchema.safeParse(result.data)
  if (!wire.success) return { data: null, error: 'WORKSPACE_LIST_UNAVAILABLE' }

  const nextCursor = wire.data.next_cursor === null ? null : encodeWorkspaceCursor({
    ...wire.data.next_cursor,
    query: normalizedQuery,
    status: parsed.data.status,
    member: parsed.data.member ?? null,
  })
  return {
    data: {
      items: wire.data.items.map((item) => mapItem(item, dependencies?.now ?? new Date())),
      nextCursor,
    },
    error: null,
  }
}

export async function getOperatorWorkspace(
  workspaceId: string,
  dependencies?: Dependencies,
): Promise<Result<OperatorWorkspaceDetail>> {
  if (!z.string().uuid().safeParse(workspaceId).success) return { data: null, error: 'WORKSPACE_INPUT_INVALID' }
  let result: RpcResult
  try {
    const gateway = dependencies?.gateway ?? await productionGateway()
    result = await gateway.rpc('get_operator_workspace_detail', { p_workspace_id: workspaceId })
  } catch (error) {
    return { data: null, error: safeError(error, 'WORKSPACE_DETAIL_UNAVAILABLE') }
  }
  if (result.error) return { data: null, error: safeError(result.error, 'WORKSPACE_DETAIL_UNAVAILABLE') }
  const wire = operatorWorkspaceDetailSchema.safeParse(result.data)
  if (!wire.success || wire.data.workspace_id !== workspaceId || wire.data.channels.some((channel) => channel.workspace_id !== workspaceId)) {
    return { data: null, error: 'WORKSPACE_DETAIL_UNAVAILABLE' }
  }
  return {
    data: {
      ...mapItem(wire.data, dependencies?.now ?? new Date()),
      memberAggregates: wire.data.member_aggregates,
      channels: wire.data.channels,
    },
    error: null,
  }
}
