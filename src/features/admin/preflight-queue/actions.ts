'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { createPreflightQueueGateway } from './repository'
import { recordOperatorAction, type OperatorActionResult } from './service'

const schema = z.object({
  kind: z.enum(['request_reconfirm', 'add_memo', 'keep_hold']),
  workspaceId: z.string().uuid(),
  vaultItemId: z.string().uuid(),
  note: z.string().max(500),
})

/** 권한 확인 후 vault_events 기록만 남긴다. 승인 상태는 바꾸지 않는다. */
export async function preflightQueueAction(_previousState: OperatorActionResult, formData: FormData): Promise<OperatorActionResult> {
  const parsed = schema.safeParse({
    kind: formData.get('kind'), workspaceId: formData.get('workspaceId'), vaultItemId: formData.get('vaultItemId'), note: String(formData.get('note') ?? ''),
  })
  if (!parsed.success) return { ok: false, message: '입력값을 확인해 주세요.' }
  const operator = await requireOperator('content.manage', parsed.data.workspaceId)
  const result = await recordOperatorAction(createPreflightQueueGateway(), operator.userId, parsed.data)
  if (!result.ok) return result
  revalidatePath('/admin/preflight')
  return result
}
