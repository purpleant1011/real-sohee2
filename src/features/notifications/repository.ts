import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { sanitizeNotificationBody } from './safe-notification-body'
import { userStatusMessages } from './user-status-message'

type QueryResult = Promise<{ data: unknown; error: unknown }>
export type NotificationGateway = {
  getUser(): QueryResult
  getPreferences(workspaceId: string, userId: string): QueryResult
  listNotifications(workspaceId: string, userId: string): QueryResult
}

export type NotificationCenterData = Readonly<{
  userId: string
  preferences: Readonly<{ approvalEvents: boolean; scheduleEvents: boolean; publishEvents: boolean }>
  notifications: readonly Readonly<{
    id: string
    kind: 'approval' | 'schedule' | 'publish' | 'system'
    body: string
    href: string | null
    readAt: string | null
    createdAt: string
  }>[]
}>

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const preferenceSchema = z.object({ workspace_id: uuidSchema, user_id: uuidSchema, approval_events: z.boolean(), schedule_events: z.boolean(), publish_events: z.boolean() }).strict()
const hrefSchema = z.string().max(500).refine((value) => value === '/app' || (value.startsWith('/app/') && !value.startsWith('//')))
const notificationSchema = z.object({
  id: uuidSchema, workspace_id: uuidSchema, user_id: uuidSchema,
  kind: z.enum(['approval', 'schedule', 'publish', 'system']), body: z.string().min(1).max(200),
  href: hrefSchema.nullable(), read_at: timestampSchema.nullable(), created_at: timestampSchema,
}).strict()

function failure<T>(): ActionResult<T> { return { error: { message: userStatusMessages.notificationsUnavailable, requestId: 'notification-center' } } }

async function createGateway(): Promise<NotificationGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    async getUser() { return supabase.auth.getUser() },
    async getPreferences(workspaceId, userId) { return supabase.from('notification_preferences').select('workspace_id, user_id, approval_events, schedule_events, publish_events').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle() },
    async listNotifications(workspaceId, userId) { return supabase.from('notifications').select('id, workspace_id, user_id, kind, body, href, read_at, created_at').eq('workspace_id', workspaceId).eq('user_id', userId).order('created_at', { ascending: false }).limit(100) },
  }
}

export async function getNotificationCenter(workspaceId: string, providedGateway?: NotificationGateway): Promise<ActionResult<NotificationCenterData>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return failure()
  try {
    const gateway = providedGateway ?? await createGateway()
    const userResult = await gateway.getUser()
    const userId = uuidSchema.safeParse((userResult.data as { user?: { id?: unknown } } | null)?.user?.id)
    if (userResult.error || !userId.success) return failure()
    const [preferenceResult, notificationResult] = await Promise.all([
      gateway.getPreferences(parsedWorkspaceId.data, userId.data),
      gateway.listNotifications(parsedWorkspaceId.data, userId.data),
    ])
    const preferences = preferenceResult.data === null ? null : preferenceSchema.safeParse(preferenceResult.data)
    const notifications = z.array(notificationSchema).safeParse(notificationResult.data)
    if (preferenceResult.error || notificationResult.error || (preferences !== null && !preferences.success) || !notifications.success) return failure()
    if (
      (preferences !== null && (preferences.data.workspace_id !== parsedWorkspaceId.data || preferences.data.user_id !== userId.data)) ||
      notifications.data.some((item) => item.workspace_id !== parsedWorkspaceId.data || item.user_id !== userId.data)
    ) return failure()
    return { data: Object.freeze({
      userId: userId.data,
      preferences: Object.freeze(preferences === null ? { approvalEvents: true, scheduleEvents: true, publishEvents: true } : { approvalEvents: preferences.data.approval_events, scheduleEvents: preferences.data.schedule_events, publishEvents: preferences.data.publish_events }),
      notifications: Object.freeze(notifications.data.map((item) => Object.freeze({ id: item.id, kind: item.kind, body: item.kind === 'publish' ? '게시 처리 상태를 확인해 주세요.' : sanitizeNotificationBody(item.body), href: item.href, readAt: item.read_at, createdAt: item.created_at }))),
    }) }
  } catch { return failure() }
}
