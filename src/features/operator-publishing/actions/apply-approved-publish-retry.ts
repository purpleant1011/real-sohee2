'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({ approvalRequestId: z.string().uuid() }).strict()

type ApplyResult = Readonly<{ applied: true; retryAttemptId: string }>

export async function applyApprovedPublishRetryAction(input: unknown): Promise<ActionResult<ApplyResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '승인된 게시 재시도 요청을 확인해 주세요.', requestId: 'operator-publish-retry-apply' } }
  const client = await createServerSupabaseClient() as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> }
  const { data, error } = await client.rpc('apply_approved_publish_retry', { p_approval_request_id: parsed.data.approvalRequestId })
  if (error || !data || typeof data !== 'object' || !('retry_attempt_id' in data) || typeof data.retry_attempt_id !== 'string') {
    return { error: { message: '승인된 게시 재시도를 적용하지 못했습니다. 현재 상태를 다시 확인해 주세요.', requestId: 'operator-publish-retry-apply' } }
  }
  return { data: { applied: true, retryAttemptId: data.retry_attempt_id } }
}
