'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import { abortActiveChatStream } from '../active-chat-streams'
import { safeParseContentInterviewState } from '../content-interview'
import {
  terminalCancelledContentInterviewState,
  usageMetadataSchema,
} from '../content-interview-repository'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  messageId: z.string().uuid(),
}).strict()

export async function cancelMessageAction(input: unknown): Promise<ActionResult<Readonly<{
  messageId: string
  cancelled: true
}>>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '중단할 응답을 확인해 주세요.', requestId: 'chat-cancel' } }

  try {
    const client = await createServerSupabaseClient()
    const user = await client.auth.getUser()
    const userId = user.data.user?.id
    if (user.error || typeof userId !== 'string') {
      return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'chat-cancel' } }
    }

    const membership = await client.from('workspace_members').select('workspace_id')
      .eq('workspace_id', parsed.data.workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle()
    if (membership.error || !membership.data) {
      return { error: { message: '이 작업공간의 응답을 중단할 수 없습니다.', requestId: 'chat-cancel' } }
    }

    const admin = createAdminSupabaseClient()
    const current = await admin.from('messages').select('usage_metadata')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('id', parsed.data.messageId)
      .eq('role', 'sohee')
      .eq('status', 'streaming')
      .maybeSingle()
    if (current.error || !current.data) {
      return { error: { message: '이미 끝났거나 중단할 수 없는 응답입니다.', requestId: 'chat-cancel' } }
    }

    const currentMetadata = usageMetadataSchema.safeParse(current.data.usage_metadata).success
      ? usageMetadataSchema.parse(current.data.usage_metadata)
      : {}
    const interview = safeParseContentInterviewState(currentMetadata.soheeConversationInterview)
    const cancelledInterview = interview.success && ['collecting', 'ready_to_generate'].includes(interview.data.status)
      ? terminalCancelledContentInterviewState(interview.data)
      : undefined
    const nextMetadata = cancelledInterview
      ? { ...currentMetadata, soheeConversationInterview: cancelledInterview }
      : undefined

    const updateQuery = admin.from('messages').update({
      status: 'cancelled',
      error_code: 'CHAT_CANCELLED',
      content: '응답 생성을 중단했습니다.',
      completed_at: new Date().toISOString(),
      ...(nextMetadata ? { usage_metadata: nextMetadata as unknown as Json } : {}),
    }).eq('workspace_id', parsed.data.workspaceId)
      .eq('id', parsed.data.messageId)
      .eq('role', 'sohee')
      .eq('status', 'streaming')
    const result = await updateQuery.select('id').maybeSingle()

    if (result.error || result.data?.id !== parsed.data.messageId) {
      return { error: { message: '이미 끝났거나 중단할 수 없는 응답입니다.', requestId: 'chat-cancel' } }
    }

    abortActiveChatStream(parsed.data.messageId)
    revalidatePath('/app')
    return { data: { messageId: parsed.data.messageId, cancelled: true } }
  } catch {
    return { error: { message: '응답을 중단하지 못했습니다.', requestId: 'chat-cancel' } }
  }
}
