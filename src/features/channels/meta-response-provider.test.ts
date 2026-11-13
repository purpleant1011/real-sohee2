import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { sendApprovedMetaResponse } from './meta-response-provider'
import type { ClaimedResponse } from './response-delivery-repository'

const base: ClaimedResponse = {
  attemptId: '30000000-0000-4000-8000-000000000001', status: 'pending',
  providerReference: null, errorCode: null, isNew: true,
  workspaceId: '10000000-0000-4000-8000-000000000001',
  responseJobId: '20000000-0000-4000-8000-000000000001',
  connectionId: '40000000-0000-4000-8000-000000000001',
  provider: 'instagram', externalAccountId: 'ig-account-1', responseKind: 'instagram_dm',
  externalTargetId: 'scoped-user-1', draftText: '승인 문안', draftFingerprint: 'a'.repeat(64),
  idempotencyKey: 'b'.repeat(64), claimToken: 'claim-token-value-that-is-long-enough',
}

function dependencies() {
  return {
    loadCredential: vi.fn().mockResolvedValue({
      provider: 'instagram', externalAccountId: 'ig-account-1', accessToken: 'server-token', expiresAt: null,
    }),
    instagram: {
      sendCommentReply: vi.fn().mockResolvedValue({ providerReplyId: 'ig-reply-1' }),
      sendDirectMessage: vi.fn().mockResolvedValue({ providerMessageId: 'ig-message-1' }),
    },
    threads: { sendReply: vi.fn().mockResolvedValue({ providerReplyId: 'threads-reply-1' }) },
  }
}

describe('Meta response provider', () => {
  let origAllowlist: string | undefined

  beforeEach(() => {
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it('blocks response delivery when workspace is not allowlisted', async () => {
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '99999999-9999-9999-9999-999999999999'
    const dm = dependencies()
    await expect(sendApprovedMetaResponse(base, dm)).rejects.toThrow(
      '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.'
    )
    expect(dm.instagram.sendDirectMessage).not.toHaveBeenCalled()
  })

  it('maps each supported response kind to exactly one provider method', async () => {
    const dm = dependencies()
    await expect(sendApprovedMetaResponse(base, dm)).resolves.toEqual({ providerReference: 'ig-message-1' })
    expect(dm.instagram.sendDirectMessage).toHaveBeenCalledWith({
      accountId: 'ig-account-1', recipientId: 'scoped-user-1', accessToken: 'server-token', text: '승인 문안',
    })
    expect(dm.instagram.sendCommentReply).not.toHaveBeenCalled()

    const comment = dependencies()
    await sendApprovedMetaResponse({ ...base, responseKind: 'instagram_comment_reply' }, comment)
    expect(comment.instagram.sendCommentReply).toHaveBeenCalledOnce()

    const threads = dependencies()
    threads.loadCredential.mockResolvedValue({
      provider: 'threads', externalAccountId: 'threads-account-1', accessToken: 'server-token', expiresAt: null,
    })
    await sendApprovedMetaResponse({
      ...base, provider: 'threads', externalAccountId: 'threads-account-1', responseKind: 'threads_reply',
    }, threads)
    expect(threads.threads.sendReply).toHaveBeenCalledOnce()
  })

  it.each([
    ['instagram_dm', 'instagram', 'message'],
    ['instagram_comment_reply', 'instagram', 'comment_reply'],
    ['threads_reply', 'threads', 'reply'],
  ] as const)('loads the exact permission for %s', async (responseKind, provider, capability) => {
    const source = dependencies()
    source.loadCredential.mockResolvedValue({
      provider, externalAccountId: base.externalAccountId, accessToken: 'server-token', expiresAt: null,
    })
    await sendApprovedMetaResponse({ ...base, responseKind, provider }, source)
    expect(source.loadCredential).toHaveBeenCalledWith(base.workspaceId, base.connectionId, provider, capability)
  })

  it('blocks delivery when cancellation arrives during credential loading', async () => {
    const source = dependencies()
    const controller = new AbortController()
    source.loadCredential.mockImplementation(async () => {
      controller.abort()
      return { provider: 'instagram', externalAccountId: base.externalAccountId, accessToken: 'server-token', expiresAt: null }
    })
    await expect(sendApprovedMetaResponse(base, source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.instagram.sendDirectMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['instagram_dm', 'instagram'], ['instagram_comment_reply', 'instagram'], ['threads_reply', 'threads'],
  ] as const)('passes caller cancellation to %s', async (responseKind, provider) => {
    const source = dependencies()
    source.loadCredential.mockResolvedValue({ provider, externalAccountId: base.externalAccountId, accessToken: 'server-token', expiresAt: null })
    const controller = new AbortController()
    await sendApprovedMetaResponse({ ...base, responseKind, provider }, source, controller.signal)
    const adapter = responseKind === 'instagram_dm' ? source.instagram.sendDirectMessage
      : responseKind === 'instagram_comment_reply' ? source.instagram.sendCommentReply : source.threads.sendReply
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })

  it('rejects a credential account mismatch before any provider call', async () => {
    const source = dependencies()
    source.loadCredential.mockResolvedValue({
      provider: 'instagram', externalAccountId: 'different-account', accessToken: 'server-token', expiresAt: null,
    })

    await expect(sendApprovedMetaResponse(base, source)).rejects.toThrow('채널 연결 정보를 확인해 주세요.')
    expect(source.instagram.sendDirectMessage).not.toHaveBeenCalled()
    expect(source.instagram.sendCommentReply).not.toHaveBeenCalled()
  })
})
