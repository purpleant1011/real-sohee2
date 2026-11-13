'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const deviceId = z.string().uuid().safeParse(formData.get('deviceId'))
  const workspace = await getCurrentWorkspaceContext()
  if (!deviceId.success || !workspace || (workspace.role !== 'owner' && workspace.role !== 'manager')) return
  const client = await createServerSupabaseClient()
  const { data, error } = await client.auth.getUser()
  const userId = data.user?.id
  if (error || !z.string().uuid().safeParse(userId).success) return
  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const result = await admin.rpc('revoke_connector_device', {
    p_workspace_id: workspace.workspaceId,
    p_actor_user_id: userId,
    p_device_id: deviceId.data,
  })
  if (!result.error && result.data === true) {
    revalidatePath('/app/settings/channels/naver')
    revalidatePath('/app/settings/channels/daangn')
  }
}
