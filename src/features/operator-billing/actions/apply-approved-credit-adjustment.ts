'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { applyApprovedCreditAdjustment } from '../credit-adjust-apply-repository'

const inputSchema = z.object({ approvalRequestId: z.string().uuid() }).strict()

export async function applyApprovedCreditAdjustmentAction(input: unknown): Promise<ActionResult<{ applied: true; ledgerEntryId: string; accountVersion: number }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '승인된 크레딧 조정 요청을 확인해 주세요.', requestId: 'operator-credit-adjust-apply' } }
  const result = await applyApprovedCreditAdjustment(parsed.data)
  if (result.error || !result.data) return { error: { message: '승인된 크레딧 조정을 적용하지 못했습니다. 현재 상태를 다시 확인해 주세요.', requestId: 'operator-credit-adjust-apply' } }
  return { data: { applied: true, ledgerEntryId: result.data.ledgerEntryId, accountVersion: result.data.accountVersion } }
}
