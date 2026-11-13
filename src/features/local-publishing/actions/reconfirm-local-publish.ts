'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({ workspaceId: z.string().uuid(), actionId: z.string().uuid() }).strict()

export async function reconfirmLocalPublishAction(input: unknown): Promise<ActionResult<{ reconfirmed: true }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '다시 확인할 게시 요청을 확인해 주세요.', requestId: 'local-publish-reconfirm' } }

  const workspace = await getCurrentWorkspaceContext()
  if (
    !workspace
    || workspace.workspaceId !== parsed.data.workspaceId
    || (workspace.role !== 'owner' && workspace.role !== 'manager')
  ) {
    return { error: { message: '작업공간 소유자와 관리자만 게시를 다시 확인할 수 있어요.', requestId: 'local-publish-reconfirm' } }
  }

  const client = await createServerSupabaseClient()
  const { data, error } = await client.auth.getUser()
  const userId = data.user?.id
  if (error || !z.string().uuid().safeParse(userId).success) {
    return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'local-publish-reconfirm' } }
  }

  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const result = await admin.rpc('reconfirm_local_publish', {
    p_workspace_id: parsed.data.workspaceId,
    p_actor_user_id: userId,
    p_action_id: parsed.data.actionId,
  })
  if (result.error || result.data !== true) {
    return { error: { message: '승인된 게시 버전을 다시 확인하지 못했어요. 현재 상태를 확인해 주세요.', requestId: 'local-publish-reconfirm' } }
  }

  revalidatePath('/app/schedule')
  return { data: { reconfirmed: true } }
}
