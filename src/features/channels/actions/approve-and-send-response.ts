'use server'

import { createHash, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { MetaProviderError } from '@/lib/providers/meta-api'
import { sendApprovedMetaResponse } from '../meta-response-provider'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import {
  approveAndClaimResponse,
  completeResponseDelivery,
  recordResponseProviderRequest,
} from '../response-delivery-repository'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  responseJobId: z.string().uuid(),
  draftText: z.string().trim().min(1).max(2200),
}).strict()

export type ApproveAndSendResponseResult = Readonly<{
  status: 'sent' | 'failed' | 'unknown'
  errorCode: string | null
}>

const fail = (message: string): ActionResult<ApproveAndSendResponseResult> => ({
  error: { message, requestId: 'approve-and-send-response' },
})

function providerErrorCode(error: unknown): 'RATE_LIMITED' | 'TOKEN_EXPIRED' | 'TEMPORARY_NETWORK' | 'RESULT_UNKNOWN' | 'PROVIDER_REJECTED' {
  if (error instanceof MetaProviderError) return error.code
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (['RATE_LIMITED', 'TOKEN_EXPIRED', 'TEMPORARY_NETWORK', 'RESULT_UNKNOWN', 'PROVIDER_REJECTED'].includes(String(code))) {
      return code as ReturnType<typeof providerErrorCode>
    }
  }
  return 'PROVIDER_REJECTED'
}

export async function approveAndSendResponseAction(input: unknown): Promise<ActionResult<ApproveAndSendResponseResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('응답 문안과 전송 대상을 다시 확인해 주세요.')
  const value = parsed.data

  if (!isMetaLiveAllowed(value.workspaceId)) {
    return fail('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
  }

  const draftFingerprint = createHash('sha256').update(value.draftText).digest('hex')

  try {
    const claim = await approveAndClaimResponse({ ...value, draftFingerprint })
    if (!claim.isNew) {
      if (claim.status === 'succeeded') return { data: { status: 'sent', errorCode: null } }
      if (claim.status === 'unknown' || claim.status === 'pending') {
        return { data: { status: 'unknown', errorCode: claim.errorCode ?? 'RESULT_UNKNOWN' } }
      }
      return { data: { status: 'failed', errorCode: claim.errorCode ?? 'PROVIDER_REJECTED' } }
    }

    const providerRequestId = randomUUID()
    try {
      await recordResponseProviderRequest({ claim, providerRequestId })
    } catch {
      return { data: { status: 'unknown', errorCode: 'RESULT_UNKNOWN' } }
    }

    try {
      const sent = await sendApprovedMetaResponse(claim)
      try {
        await completeResponseDelivery({
          claim, status: 'succeeded', providerReference: sent.providerReference,
          errorCode: null, providerRequestId,
        })
      } catch {
        return { data: { status: 'unknown', errorCode: 'RESULT_UNKNOWN' } }
      }
      revalidatePath('/app/inbox')
      return { data: { status: 'sent', errorCode: null } }
    } catch (error) {
      const code = providerErrorCode(error)
      const status = code === 'RESULT_UNKNOWN' ? 'unknown' : 'failed'
      try {
        await completeResponseDelivery({
          claim, status, providerReference: null, errorCode: code, providerRequestId,
        })
      } catch {
        return { data: { status: 'unknown', errorCode: 'RESULT_UNKNOWN' } }
      }
      revalidatePath('/app/inbox')
      return { data: { status, errorCode: code } }
    }
  } catch {
    return fail('응답 승인과 전송을 시작하지 못했습니다. 최신 상태를 다시 확인해 주세요.')
  }
}
