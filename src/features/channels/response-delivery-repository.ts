import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

type RpcGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

const uuid = z.string().uuid()
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const claimSchema = z.object({
  attemptId: uuid,
  status: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
  providerReference: z.string().min(1).max(500).nullable(),
  errorCode: z.string().min(1).max(120).nullable(),
  isNew: z.boolean(),
  workspaceId: uuid,
  responseJobId: uuid,
  connectionId: uuid,
  provider: z.enum(['instagram', 'threads']),
  externalAccountId: z.string().min(1).max(500),
  responseKind: z.enum(['instagram_comment_reply', 'instagram_dm', 'threads_reply']),
  externalTargetId: z.string().min(1).max(500),
  draftText: z.string().min(1).max(2200),
  draftFingerprint: sha256,
  idempotencyKey: sha256,
}).strict()

export type ClaimedResponse = Readonly<z.infer<typeof claimSchema> & { claimToken: string }>

async function userGateway(): Promise<RpcGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  return await createServerSupabaseClient() as unknown as RpcGateway
}

async function adminGateway(): Promise<RpcGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as RpcGateway
}

function logicalIdempotencyKey(jobId: string, fingerprint: string) {
  return createHash('sha256').update(`sohee:channel-response-delivery:${jobId}:${fingerprint}`).digest('hex')
}

export async function approveAndClaimResponse(input: Readonly<{
  workspaceId: string
  responseJobId: string
  draftText: string
  draftFingerprint: string
}>, providedGateway?: RpcGateway): Promise<ClaimedResponse> {
  const parsed = z.object({
    workspaceId: uuid,
    responseJobId: uuid,
    draftText: z.string().min(1).max(2200),
    draftFingerprint: sha256,
  }).strict().parse(input)
  const gateway = providedGateway ?? await userGateway()
  const claimToken = randomBytes(32).toString('base64url')
  const result = await gateway.rpc('approve_and_claim_channel_response', {
    p_workspace_id: parsed.workspaceId,
    p_response_job_id: parsed.responseJobId,
    p_draft_text: parsed.draftText,
    p_draft_fingerprint: parsed.draftFingerprint,
    p_claim_token: claimToken,
    p_idempotency_key: logicalIdempotencyKey(parsed.responseJobId, parsed.draftFingerprint),
  })
  const claim = claimSchema.safeParse(result.data)
  if (result.error || !claim.success) throw new Error('응답 승인과 전송 준비를 완료하지 못했습니다.')
  if (claim.data.workspaceId !== parsed.workspaceId || claim.data.responseJobId !== parsed.responseJobId) {
    throw new Error('응답 승인과 전송 준비를 완료하지 못했습니다.')
  }
  if (claim.data.isNew && (
    claim.data.status !== 'pending'
    || claim.data.draftText !== parsed.draftText
    || claim.data.draftFingerprint !== parsed.draftFingerprint
  )) throw new Error('응답 문안 버전을 다시 확인해 주세요.')
  return Object.freeze({ ...claim.data, claimToken })
}

export async function recordResponseProviderRequest(input: Readonly<{
  claim: ClaimedResponse
  providerRequestId: string
}>, providedGateway?: RpcGateway): Promise<string> {
  const requestId = z.string().min(1).max(255).parse(input.providerRequestId)
  const gateway = providedGateway ?? await adminGateway()
  const result = await gateway.rpc('record_channel_response_provider_request', {
    p_workspace_id: input.claim.workspaceId,
    p_attempt_id: input.claim.attemptId,
    p_idempotency_key: input.claim.idempotencyKey,
    p_claim_token: input.claim.claimToken,
    p_provider_request_id: requestId,
  })
  const attemptId = uuid.safeParse(result.data)
  if (result.error || !attemptId.success || attemptId.data !== input.claim.attemptId) {
    throw new Error('응답 전송 요청을 기록하지 못했습니다.')
  }
  return attemptId.data
}

export async function completeResponseDelivery(input: Readonly<{
  claim: ClaimedResponse
  status: 'succeeded' | 'failed' | 'unknown'
  providerReference: string | null
  errorCode: string | null
  providerRequestId: string | null
}>, providedGateway?: RpcGateway): Promise<string> {
  const gateway = providedGateway ?? await adminGateway()
  const result = await gateway.rpc('complete_channel_response_delivery', {
    p_workspace_id: input.claim.workspaceId,
    p_attempt_id: input.claim.attemptId,
    p_idempotency_key: input.claim.idempotencyKey,
    p_claim_token: input.claim.claimToken,
    p_status: input.status,
    p_provider_reference: input.providerReference,
    p_error_code: input.errorCode,
    p_provider_request_id: input.providerRequestId,
  })
  const attemptId = uuid.safeParse(result.data)
  if (result.error || !attemptId.success || attemptId.data !== input.claim.attemptId) {
    throw new Error('응답 전송 결과를 기록하지 못했습니다.')
  }
  return attemptId.data
}
