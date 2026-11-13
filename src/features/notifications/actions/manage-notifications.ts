'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const uuidSchema = z.string().uuid()
const preferenceInput = z.object({ approvalEvents: z.boolean(), scheduleEvents: z.boolean(), publishEvents: z.boolean() }).strict()
const readInput = z.object({ notificationId: uuidSchema }).strict()

export async function saveNotificationPreferencesAction(input: unknown): Promise<ActionResult<Readonly<{ saved: true }>>> {
  const parsed = preferenceInput.safeParse(input)
  if (!parsed.success) return { error: { message: '알림 설정을 확인해 주세요.', requestId: 'notification-preferences' } }
  try {
    const workspace = await getCurrentWorkspaceContext()
    if (!workspace) return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'notification-preferences' } }
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'notification-preferences' } }
    const values = {
      approval_events: parsed.data.approvalEvents, schedule_events: parsed.data.scheduleEvents, publish_events: parsed.data.publishEvents,
    }
    const { data: existing, error: updateError } = await supabase
      .from('notification_preferences')
      .update(values)
      .eq('workspace_id', workspace.workspaceId)
      .eq('user_id', userId)
      .select('workspace_id')
      .maybeSingle()
    if (updateError) return { error: { message: '알림 설정을 저장하지 못했습니다.', requestId: 'notification-preferences' } }
    if (!existing) {
      const { error: insertError } = await supabase.from('notification_preferences').insert({
        workspace_id: workspace.workspaceId,
        user_id: userId,
        ...values,
      })
      if (insertError) return { error: { message: '알림 설정을 저장하지 못했습니다.', requestId: 'notification-preferences' } }
    }
    revalidatePath('/app/notifications')
    return { data: { saved: true } }
  } catch { return { error: { message: '알림 설정을 저장하지 못했습니다.', requestId: 'notification-preferences' } } }
}

export async function markNotificationReadAction(input: unknown): Promise<ActionResult<Readonly<{ notificationId: string }>>> {
  const parsed = readInput.safeParse(input)
  if (!parsed.success) return { error: { message: '알림을 확인하지 못했습니다.', requestId: 'notification-read' } }
  try {
    const workspace = await getCurrentWorkspaceContext()
    if (!workspace) return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'notification-read' } }
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'notification-read' } }
    const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('workspace_id', workspace.workspaceId).eq('user_id', userId).eq('id', parsed.data.notificationId)
      .select('id').maybeSingle()
    const updatedId = uuidSchema.safeParse(data?.id)
    if (error || !updatedId.success || updatedId.data !== parsed.data.notificationId) return { error: { message: '알림 읽음 상태를 저장하지 못했습니다.', requestId: 'notification-read' } }
    revalidatePath('/app/notifications')
    return { data: { notificationId: updatedId.data } }
  } catch { return { error: { message: '알림 읽음 상태를 저장하지 못했습니다.', requestId: 'notification-read' } } }
}
