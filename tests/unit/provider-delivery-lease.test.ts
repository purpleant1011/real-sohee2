import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  issueProviderDeliveryLease,
  ensureActiveDeliveryLease,
  isLeaseTtlSufficient,
  DeliveryLeaseError,
} from '@/features/publishing/provider-delivery-lease'
import type { PublishRendition, ProviderDeliveryLease } from '@/features/media/media-asset-types'

describe('ProviderDeliveryLease Engine (ANI-1095)', () => {
  const dummyRendition: PublishRendition = {
    id: 'rendition-100',
    workspace_id: 'ws-test',
    source_media_asset_id: 'media-asset-1',
    channel: 'instagram',
    transform_policy_version: 'v10',
    format: 'image/jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspect_ratio: '1:1',
    storage_bucket: 'content-media',
    object_path: 'ws-test/cnt-1/ver-1/rendition-100.jpg',
    rendition_sha256: 'e'.repeat(64),
    created_at: new Date().toISOString(),
  }

  const mockGateway = {
    createSignedUrl: vi.fn().mockResolvedValue({
      signedUrl: 'https://your-project-ref.supabase.co/storage/v1/object/sign/content-media/test.jpg?token=abc',
      error: null,
    }),
    probeUrl: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'image/jpeg',
    }),
    insertLeaseRecord: vi.fn().mockResolvedValue({ error: null }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGateway.createSignedUrl.mockResolvedValue({
      signedUrl: 'https://your-project-ref.supabase.co/storage/v1/object/sign/content-media/test.jpg?token=abc',
      error: null,
    })
    mockGateway.probeUrl.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'image/jpeg',
    })
    mockGateway.insertLeaseRecord.mockResolvedValue({ error: null })
  })

  it('successfully issues a delivery lease with valid TTL and signed URL', async () => {
    const lease = await issueProviderDeliveryLease(
      dummyRendition,
      {
        workspaceId: 'ws-test',
        renditionId: dummyRendition.id,
        provider: 'instagram',
        ttlSeconds: 900,
      },
      mockGateway
    )

    expect(lease.workspace_id).toBe('ws-test')
    expect(lease.rendition_id).toBe(dummyRendition.id)
    expect(lease.provider).toBe('instagram')
    expect(lease.status).toBe('ACTIVE')
    expect(lease.delivery_url).toContain('https://')
    expect(isLeaseTtlSufficient(lease, 60)).toBe(true)
  })

  it('strictly rejects cross-workspace lease issuance', async () => {
    await expect(
      issueProviderDeliveryLease(
        dummyRendition,
        {
          workspaceId: 'ws-other-hacker',
          renditionId: dummyRendition.id,
          provider: 'instagram',
        },
        mockGateway
      )
    ).rejects.toThrow(DeliveryLeaseError)
  })

  it('fails closed if probe fails (e.g. 404 or private access forbidden)', async () => {
    const failingProbeGateway = {
      ...mockGateway,
      probeUrl: vi.fn().mockResolvedValue({ ok: false, status: 403, contentType: null }),
    }

    await expect(
      issueProviderDeliveryLease(
        dummyRendition,
        {
          workspaceId: 'ws-test',
          renditionId: dummyRendition.id,
          provider: 'instagram',
        },
        failingProbeGateway
      )
    ).rejects.toThrow('Delivery URL probe failed with HTTP status 403')
  })

  it('reuses active lease if TTL is sufficient (> 60s)', async () => {
    const activeLease: ProviderDeliveryLease = {
      id: 'existing-lease',
      workspace_id: 'ws-test',
      rendition_id: dummyRendition.id,
      provider: 'instagram',
      purpose: 'meta_publish',
      delivery_url: 'https://storage/signed/url',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 500_000).toISOString(),
      status: 'ACTIVE',
    }

    const lease = await ensureActiveDeliveryLease(
      activeLease,
      dummyRendition,
      { workspaceId: 'ws-test', renditionId: dummyRendition.id, provider: 'instagram' },
      mockGateway,
      false
    )

    expect(lease.id).toBe('existing-lease')
    expect(mockGateway.createSignedUrl).not.toHaveBeenCalled()
  })

  it('never blind republishes/refreshes if provider side effect already occurred', async () => {
    const expiredLease: ProviderDeliveryLease = {
      id: 'expired-lease',
      workspace_id: 'ws-test',
      rendition_id: dummyRendition.id,
      provider: 'instagram',
      purpose: 'meta_publish',
      delivery_url: 'https://storage/signed/url',
      issued_at: new Date(Date.now() - 2000_000).toISOString(),
      expires_at: new Date(Date.now() - 1000_000).toISOString(),
      status: 'ACTIVE',
    }

    // Since providerSideEffectOccurred = true, must retain lease and avoid new provider call
    const lease = await ensureActiveDeliveryLease(
      expiredLease,
      dummyRendition,
      { workspaceId: 'ws-test', renditionId: dummyRendition.id, provider: 'instagram' },
      mockGateway,
      true
    )

    expect(lease.id).toBe('expired-lease')
    expect(mockGateway.createSignedUrl).not.toHaveBeenCalled()
  })
})
