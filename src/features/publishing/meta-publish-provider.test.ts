import { describe, expect, it, vi } from 'vitest'
import { MetaProviderError } from '@/lib/providers/meta-api'
import { publishApprovedMetaContent } from './meta-publish-provider'

const common = {
  reservation: {
    workspaceId: '10000000-0000-4000-8000-000000000001',
    scheduleId: '20000000-0000-4000-8000-000000000001',
    channelConnectionId: '30000000-0000-4000-8000-000000000001',
    channel: 'instagram' as const,
  },
  material: {
    payload: {
      workspaceId: '10000000-0000-4000-8000-000000000001', contentId: '11000000-0000-4000-8000-000000000001',
      scheduleId: '20000000-0000-4000-8000-000000000001', versionId: '40000000-0000-4000-8000-000000000001',
      channelConnectionId: '30000000-0000-4000-8000-000000000001',
      fingerprint: 'a'.repeat(64), channel: 'instagram' as const,
      externalAccountId: '1789001', text: '승인된 본문', media: [], isAiGenerated: false,
    },
    mediaUrls: ['https://storage.example.test/signed-image'],
  },
}

describe('live Meta publish provider', () => {
  it('uses the exact connected account credential and Instagram adapter', async () => {
    const loadCredential = vi.fn().mockResolvedValue({ accessToken: 'secret-token', provider: 'instagram', externalAccountId: '1789001', expiresAt: null })
    const instagramPublish = vi.fn().mockResolvedValue({ providerPostId: 'ig-post-1' })
    const threadsPublish = vi.fn()
    const onProviderRequestId = vi.fn().mockResolvedValue(undefined)
    await expect(publishApprovedMetaContent({ ...common, onProviderRequestId }, { loadCredential, instagramPublish, threadsPublish }))
      .resolves.toEqual({ ok: true, providerPostId: 'ig-post-1', errorCode: null })
    expect(instagramPublish).toHaveBeenCalledWith({
      accountId: '1789001', accessToken: 'secret-token', caption: '승인된 본문',
      imageUrls: ['https://storage.example.test/signed-image'], isAiGenerated: false,
      onContainerCreated: onProviderRequestId,
    })
    expect(threadsPublish).not.toHaveBeenCalled()
  })

  it('fails closed if the stored connection account differs from the approved payload', async () => {
    const dependencies = {
      loadCredential: vi.fn().mockResolvedValue({ accessToken: 'secret-token', provider: 'instagram', externalAccountId: 'different-account', expiresAt: null }),
      instagramPublish: vi.fn(), threadsPublish: vi.fn(),
    }
    await expect(publishApprovedMetaContent(common, dependencies)).resolves.toEqual({
      ok: false, providerPostId: null, destinationUrl: null, errorCode: 'TOKEN_EXPIRED',
    })
    expect(dependencies.instagramPublish).not.toHaveBeenCalled()
  })

  it('persists the opaque Meta diagnostic instead of the rejected response body', async () => {
    const dependencies = {
      loadCredential: vi.fn().mockResolvedValue({ accessToken: 'secret-token', provider: 'instagram', externalAccountId: '1789001', expiresAt: null }),
      instagramPublish: vi.fn().mockRejectedValue(new MetaProviderError(
        'PROVIDER_REJECTED',
        'META_C36003_S2207009_VALIDATION',
      )),
      threadsPublish: vi.fn(),
    }

    await expect(publishApprovedMetaContent(common, dependencies)).resolves.toEqual({
      ok: false,
      providerPostId: null,
      destinationUrl: null,
      errorCode: 'META_C36003_S2207009_VALIDATION',
    })
  })
})
