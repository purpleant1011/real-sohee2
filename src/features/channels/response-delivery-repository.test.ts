import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  approveAndClaimResponse,
  completeResponseDelivery,
  recordResponseProviderRequest,
} from './response-delivery-repository'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  responseJobId: '20000000-0000-4000-8000-000000000001',
  draftText: '확인 후 안내드리겠습니다.',
  draftFingerprint: 'a'.repeat(64),
}

const claim = {
  attemptId: '30000000-0000-4000-8000-000000000001',
  status: 'pending', providerReference: null, errorCode: null, isNew: true,
  workspaceId: input.workspaceId, responseJobId: input.responseJobId,
  connectionId: '40000000-0000-4000-8000-000000000001',
  provider: 'instagram', externalAccountId: 'ig-account-1', responseKind: 'instagram_dm',
  externalTargetId: 'scoped-user-1', draftText: input.draftText,
  draftFingerprint: input.draftFingerprint, idempotencyKey: 'b'.repeat(64),
} as const

describe('response delivery repository', () => {
  it('creates a server-only claim with stable draft-bound idempotency', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: claim, error: null })
    const result = await approveAndClaimResponse(input, { rpc })

    expect(result).toMatchObject({ ...claim, claimToken: expect.any(String) })
    expect(rpc).toHaveBeenCalledWith('approve_and_claim_channel_response', expect.objectContaining({
      p_workspace_id: input.workspaceId,
      p_response_job_id: input.responseJobId,
      p_draft_text: input.draftText,
      p_draft_fingerprint: input.draftFingerprint,
      p_idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/u),
      p_claim_token: expect.any(String),
    }))
  })

  it('returns an existing success without inventing a new provider claim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ...claim, status: 'succeeded', isNew: false, providerReference: 'reply-1',
    }, error: null })

    await expect(approveAndClaimResponse(input, { rpc })).resolves.toMatchObject({
      isNew: false, status: 'succeeded', providerReference: 'reply-1',
    })
  })

  it('records the outbound checkpoint and completes only the claimed attempt', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: claim.attemptId, error: null })
      .mockResolvedValueOnce({ data: claim.attemptId, error: null })
    const gateway = { rpc }

    await expect(recordResponseProviderRequest({
      claim: { ...claim, claimToken: 'claim-token-value-that-is-long-enough' },
      providerRequestId: 'request-1',
    }, gateway)).resolves.toBe(claim.attemptId)
    await expect(completeResponseDelivery({
      claim: { ...claim, claimToken: 'claim-token-value-that-is-long-enough' },
      status: 'succeeded', providerReference: 'provider-reply-1', errorCode: null,
      providerRequestId: 'request-1',
    }, gateway)).resolves.toBe(claim.attemptId)

    expect(rpc).toHaveBeenNthCalledWith(2, 'complete_channel_response_delivery', expect.objectContaining({
      p_attempt_id: claim.attemptId,
      p_idempotency_key: claim.idempotencyKey,
      p_status: 'succeeded',
      p_provider_reference: 'provider-reply-1',
      p_provider_request_id: 'request-1',
    }))
  })
})
