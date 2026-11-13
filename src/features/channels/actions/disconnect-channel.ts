'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const schema = z.object({ channel: z.enum(['instagram', 'threads']) }).strict()

export async function disconnectChannelAction(input: unknown) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: '연결 해제 요청을 확인해 주세요.' }
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return { ok: false as const, message: '채널 연결을 해제할 권한이 없습니다.' }
  }
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { ok: false as const, message: '로그인 상태를 다시 확인해 주세요.' }
  const admin = createAdminSupabaseClient()
  const result = await admin.rpc('disconnect_meta_channel' as never, {
    p_workspace_id: workspace.workspaceId,
    p_actor_user_id: data.user.id,
    p_provider: parsed.data.channel,
  } as never) as { data: unknown; error: unknown }
  if (result.error || result.data !== true) {
    return { ok: false as const, message: '채널 연결을 해제하지 못했습니다.' }
  }
  revalidatePath('/app/settings/channels')
  revalidatePath('/app/account')
  return { ok: true as const, message: '채널 연결과 저장된 자격 증명을 해제했습니다.' }
}
