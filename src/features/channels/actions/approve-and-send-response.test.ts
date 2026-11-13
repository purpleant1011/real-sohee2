import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), record: vi.fn(), provider: vi.fn(), complete: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('../response-delivery-repository', () => ({
  approveAndClaimResponse: mocks.claim,
  recordResponseProviderRequest: mocks.record,
  completeResponseDelivery: mocks.complete,
}))
vi.mock('../meta-response-provider', () => ({ sendApprovedMetaResponse: mocks.provider }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { approveAndSendResponseAction } from './approve-and-send-response'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  responseJobId: '20000000-0000-4000-8000-000000000001',
  draftText: '확인 후 안내드리겠습니다.',
}
const claim = {
  attemptId: '30000000-0000-4000-8000-000000000001', status: 'pending',
  providerReference: null, errorCode: null, isNew: true,
  workspaceId: input.workspaceId, responseJobId: input.responseJobId,
  connectionId: '40000000-0000-4000-8000-000000000001', provider: 'instagram',
  externalAccountId: 'ig-account-1', responseKind: 'instagram_comment_reply',
  externalTargetId: 'comment-1', draftText: input.draftText, draftFingerprint: 'a'.repeat(64),
  idempotencyKey: 'b'.repeat(64), claimToken: 'claim-token-value-that-is-long-enough',
}

describe('approveAndSendResponseAction', () => {
  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    mocks.claim.mockResolvedValue(claim)
    mocks.record.mockResolvedValue(claim.attemptId)
    mocks.provider.mockResolvedValue({ providerReference: 'reply-1' })
    mocks.complete.mockResolvedValue(claim.attemptId)
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it('approves and sends the exact draft once from one action', async () => {
    await expect(approveAndSendResponseAction(input)).resolves.toMatchObject({ data: { status: 'sent' } })
    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(mocks.record).toHaveBeenCalledOnce()
    expect(mocks.provider).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenCalledOnce()
  })

  it('returns an existing success without another provider call', async () => {
    mocks.claim.mockResolvedValue({ ...claim, isNew: false, status: 'succeeded', providerReference: 'reply-1' })
    await expect(approveAndSendResponseAction(input)).resolves.toMatchObject({ data: { status: 'sent' } })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('keeps an existing unknown result blocked from blind retry', async () => {
    mocks.claim.mockResolvedValue({ ...claim, isNew: false, status: 'unknown', errorCode: 'RESULT_UNKNOWN' })
    await expect(approveAndSendResponseAction(input)).resolves.toMatchObject({ data: { status: 'unknown' } })
    expect(mocks.provider).not.toHaveBeenCalled()
  })

  it('records a provider unknown outcome without exposing provider details', async () => {
    mocks.provider.mockRejectedValue({ code: 'RESULT_UNKNOWN' })
    await expect(approveAndSendResponseAction(input)).resolves.toMatchObject({
      data: { status: 'unknown', errorCode: 'RESULT_UNKNOWN' },
    })
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }))
  })

  it('does not call the provider when the outbound checkpoint cannot be recorded', async () => {
    mocks.record.mockRejectedValue(new Error('checkpoint unavailable'))
    await expect(approveAndSendResponseAction(input)).resolves.toMatchObject({
      data: { status: 'unknown', errorCode: 'RESULT_UNKNOWN' },
    })
    expect(mocks.provider).not.toHaveBeenCalled()
  })

  it('returns unknown when a successful provider result cannot be durably completed', async () => {
    mocks.complete.mockRejectedValue(new Error('completion unavailable'))
    await expect(approveAndSendResponseAction(input)).resolves.toMatchObject({
      data: { status: 'unknown', errorCode: 'RESULT_UNKNOWN' },
    })
    expect(mocks.provider).toHaveBeenCalledOnce()
  })

  it('fails closed for malformed input before a claim', async () => {
    await expect(approveAndSendResponseAction({ ...input, draftText: '' })).resolves.toHaveProperty('error')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
})
