'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({ workspaceId: z.string().uuid(), actionId: z.string().uuid() }).strict()

export async function retryLocalPublishBeforeSubmitAction(
  input: unknown,
): Promise<ActionResult<{ retried: true }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '다시 실행할 게시 요청을 확인해 주세요.', requestId: 'local-publish-safe-retry' } }
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace || workspace.workspaceId !== parsed.data.workspaceId
    || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return { error: { message: '작업공간 소유자와 관리자만 제출 전 작업을 다시 실행할 수 있어요.', requestId: 'local-publish-safe-retry' } }
  }
  const client = await createServerSupabaseClient()
  const { data, error } = await client.auth.getUser()
  const userId = data.user?.id
  if (error || !z.string().uuid().safeParse(userId).success) {
    return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'local-publish-safe-retry' } }
  }
  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const result = await admin.rpc('retry_local_publish_before_submit', {
    p_workspace_id: parsed.data.workspaceId,
    p_actor_user_id: userId,
    p_action_id: parsed.data.actionId,
  })
  if (result.error || result.data !== true) {
    return { error: { message: '제출되지 않은 동일 승인 작업인지 확인하지 못했어요.', requestId: 'local-publish-safe-retry' } }
  }
  revalidatePath('/app/schedule')
  return { data: { retried: true } }
}
