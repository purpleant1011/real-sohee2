import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { auditInstagramProviderRejectedRetry } from './instagram-retry-preparation'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  failedAttemptId: '20000000-0000-4000-8000-000000000001',
  expectedAccountLabel: '@sohee.ai',
}

const retryContext = {
  workspace_id: input.workspaceId,
  failed_attempt_id: input.failedAttemptId,
  schedule_id: '30000000-0000-4000-8000-000000000001',
  version_id: '40000000-0000-4000-8000-000000000001',
  channel_connection_id: '50000000-0000-4000-8000-000000000001',
  external_account_id: '17841441250302004',
  account_label: '@sohee.ai',
  derivative_size_bytes: 246534,
  media: [{
    media_asset_id: '60000000-0000-4000-8000-000000000001',
    bucket_id: 'content-media',
    object_path: 'workspace/content/source.png',
    mime_type: 'image/png',
  }],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Instagram final retry readiness audit', () => {
  it('verifies the official account, publish eligibility, and public JPEG without publishing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: retryContext, error: null })
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.test/derivative.jpg?signature=secret' },
      error: null,
    })
    const probe = vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '246534' },
    }))
    const loadCredential = vi.fn().mockResolvedValue({
      accessToken: 'secret-access-token',
      provider: 'instagram',
      externalAccountId: retryContext.external_account_id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    const fetchMeta = vi.fn()
      .mockResolvedValueOnce(json({ user_id: retryContext.external_account_id, username: 'sohee.ai' }))
      .mockResolvedValueOnce(json({ data: [{ quota_usage: 1, config: { quota_total: 100 } }] }))

    await expect(auditInstagramProviderRejectedRetry(input, {
      rpc, createSignedUrl, probe, loadCredential, fetchMeta,
    })).resolves.toEqual({
      accountLabel: '@sohee.ai',
      externalAccountId: retryContext.external_account_id,
      credentialActive: true,
      profileVerified: true,
      publishEligibilityVerified: true,
      jpegVerified: true,
      jpegContentType: 'image/jpeg',
      jpegContentLength: 246534,
    })

    expect(probe).toHaveBeenCalledWith(
      'https://storage.example.test/derivative.jpg?signature=secret',
      expect.objectContaining({ method: 'HEAD' }),
    )
    expect(fetchMeta).toHaveBeenCalledTimes(2)
    expect(fetchMeta.mock.calls.every(([, init]) =>
      new Headers(init?.headers).get('authorization') === 'Bearer secret-access-token')).toBe(true)
    expect(fetchMeta.mock.calls.every(([url]) => !String(url).includes('secret-access-token'))).toBe(true)
  })

  it('uses authoritative storage size when a public HEAD response omits content-length', async () => {
    const fetchMeta = vi.fn()
      .mockResolvedValueOnce(json({ user_id: retryContext.external_account_id, username: 'sohee.ai' }))
      .mockResolvedValueOnce(json({ data: [{ quota_usage: 1, config: { quota_total: 100 } }] }))

    await expect(auditInstagramProviderRejectedRetry(input, {
      rpc: vi.fn().mockResolvedValue({ data: retryContext, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.test/derivative.jpg?signature=secret' },
        error: null,
      }),
      probe: vi.fn().mockResolvedValue(new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })),
      loadCredential: vi.fn().mockResolvedValue({
        accessToken: 'secret-access-token',
        provider: 'instagram',
        externalAccountId: retryContext.external_account_id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }),
      fetchMeta,
    })).resolves.toEqual(expect.objectContaining({
      jpegVerified: true,
      jpegContentLength: 246534,
    }))
  })

  it('rejects a public JPEG whose declared response length conflicts with storage metadata', async () => {
    await expect(auditInstagramProviderRejectedRetry(input, {
      rpc: vi.fn().mockResolvedValue({ data: retryContext, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.test/derivative.jpg?signature=secret' },
        error: null,
      }),
      probe: vi.fn().mockResolvedValue(new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '1' },
      })),
      loadCredential: vi.fn(),
      fetchMeta: vi.fn(),
    })).rejects.toThrow('INSTAGRAM_READINESS_MEDIA_UNAVAILABLE')
  })

  it('classifies credential loading failures without exposing the underlying secret error', async () => {
    await expect(auditInstagramProviderRejectedRetry(input, {
      rpc: vi.fn().mockResolvedValue({ data: retryContext, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.test/derivative.jpg?signature=secret' },
        error: null,
      }),
      probe: vi.fn().mockResolvedValue(new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '246534' },
      })),
      loadCredential: vi.fn().mockRejectedValue(new Error('secret-dependent decrypt detail')),
      fetchMeta: vi.fn(),
    })).rejects.toThrow('INSTAGRAM_READINESS_CONNECTION_INVALID')
  })

  it('distinguishes an unreadable encrypted credential without exposing token material', async () => {
    await expect(auditInstagramProviderRejectedRetry(input, {
      rpc: vi.fn().mockResolvedValue({ data: retryContext, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.test/derivative.jpg?signature=secret' },
        error: null,
      }),
      probe: vi.fn().mockResolvedValue(new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '246534' },
      })),
      loadCredential: vi.fn().mockRejectedValue(new Error('채널 자격 증명을 열 수 없습니다.')),
      fetchMeta: vi.fn(),
    })).rejects.toThrow('INSTAGRAM_READINESS_CREDENTIAL_DECRYPT_FAILED')
  })
})
