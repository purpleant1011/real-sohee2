'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  threadId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
}).strict()

type RetryPayload = Readonly<{
  content: string
  clientMessageId: string
  retryAssistantMessageId: string
}>

export async function retryMessageAction(input: unknown): Promise<ActionResult<RetryPayload>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '다시 시도할 응답을 확인해 주세요.', requestId: 'chat-retry' } }

  try {
    const client = await createServerSupabaseClient()
    const user = await client.auth.getUser()
    const userId = user.data.user?.id
    if (user.error || typeof userId !== 'string') {
      return { error: { message: '로그인 후 다시 시도해 주세요.', requestId: 'chat-retry' } }
    }

    const membership = await client.from('workspace_members').select('workspace_id')
      .eq('workspace_id', parsed.data.workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle()
    if (membership.error || !membership.data) {
      return { error: { message: '이 작업공간의 응답을 다시 시도할 수 없습니다.', requestId: 'chat-retry' } }
    }

    const assistant = await client.from('messages')
      .select('id, reply_to_message_id, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('thread_id', parsed.data.threadId)
      .eq('id', parsed.data.assistantMessageId)
      .eq('role', 'sohee')
      .maybeSingle()
    if (
      assistant.error
      || !assistant.data?.reply_to_message_id
      || (assistant.data.status !== 'failed' && assistant.data.status !== 'cancelled')
    ) {
      return { error: { message: '실패하거나 중단된 응답만 다시 시도할 수 있습니다.', requestId: 'chat-retry' } }
    }

    const original = await client.from('messages')
      .select('content, client_message_id')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('thread_id', parsed.data.threadId)
      .eq('id', assistant.data.reply_to_message_id)
      .eq('role', 'user')
      .maybeSingle()
    const content = z.string().trim().min(1).max(8_000).safeParse(original.data?.content)
    const clientMessageId = z.string().uuid().safeParse(original.data?.client_message_id)
    if (original.error || !content.success || !clientMessageId.success) {
      return { error: { message: '원래 질문을 복구하지 못했습니다.', requestId: 'chat-retry' } }
    }

    return {
      data: {
        content: content.data,
        clientMessageId: clientMessageId.data,
        retryAssistantMessageId: assistant.data.id,
      },
    }
  } catch {
    return { error: { message: '응답을 다시 준비하지 못했습니다.', requestId: 'chat-retry' } }
  }
}
