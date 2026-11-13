import { describe, expect, it, vi } from 'vitest'
import { applyVaultEdit, type VaultEditRepository } from '../../edit'
import type { VaultItem, VaultVariantPayload } from '../../types'

describe('Vault Edit Telemetry Funnel Hooks', () => {
  const ws = '11111111-1111-4111-8111-111111111111'
  const actor = '22222222-2222-4222-8222-222222222222'

  function makeItem(overrides: Partial<VaultItem> = {}): VaultItem {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      workspaceId: ws,
      contentId: '44444444-4444-4444-8444-444444444444',
      versionId: '55555555-5555-4555-8555-555555555555',
      channel: 'instagram',
      bundleId: null,
      releaseGate: null,
      holdReason: null,
      heldAt: null,
      heldBy: null,
      targetDate: null,
      idempotencyKey: 'idem-key-1',
      approvedFingerprint: 'a'.repeat(64),
      fingerprintSchemaVersion: 3,
      policyVersion: 'vault-save-v1',
      specVersion: 'ig-v1',
      approvalState: 'APPROVED',
      approvedBy: actor,
      deletedAt: null,
      createdAt: '2026-10-05T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
      ...overrides,
    }
  }

  function makePayload(text = '기존 본문입니다'): VaultVariantPayload {
    return {
      id: '66666666-6666-4666-8666-666666666666',
      workspaceId: ws,
      vaultItemId: '33333333-3333-4333-8333-333333333333',
      payload: {
        title: '제목입니다',
        text,
        hashtags: ['#태그'],
        targetAccountId: 'acc-1',
        media: [{ position: 0, type: 'image', mimeType: 'image/jpeg', sizeBytes: 100, renditionContentDigest: 'a'.repeat(64) }],
        settings: { category: null, visibility: 'PUBLIC', coupon: null },
        textBlockRenderSpec: {
          channel: 'instagram',
          blocks: [{ type: 'body', text }],
          digest: 'd'.repeat(64),
        },
      },
      previewArtifacts: {},
      createdAt: '2026-10-05T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
    }
  }

  // Ref helper: base64url of 16-byte UUID hex
  function itemRef(item: VaultItem): string {
    const hex = item.id.replace(/-/g, '')
    return Buffer.from(hex, 'hex').toString('base64url')
  }

  it('triggers vault_edited event when text edit invalidates approval', async () => {
    const item = makeItem()
    const sidecar = makePayload()
    const repo: VaultEditRepository = {
      getItem: vi.fn().mockResolvedValue(item),
      getPayload: vi.fn().mockResolvedValue(sidecar),
      listImageCandidates: vi.fn().mockResolvedValue([item]),
      changeMany: vi.fn().mockResolvedValue({ [item.id]: '2026-10-07T12:00:01Z' }),
    }

    const recordFunnelEvent = vi.fn().mockResolvedValue(undefined)

    await applyVaultEdit(
      repo,
      {
        workspaceId: ws,
        actorId: actor,
        itemRef: itemRef(item),
        expectedVersion: item.updatedAt,
        operation: 'edit',
        changes: { text: '새롭게 변경된 본문입니다' },
        now: new Date('2026-10-07T12:00:00Z'),
      },
      { recordFunnelEvent },
    )

    expect(recordFunnelEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ws,
        userId: actor,
        event: 'vault_edited',
        channel: 'instagram',
        properties: expect.objectContaining({
          vaultItemId: item.id,
          contentId: item.contentId,
          versionId: item.versionId,
        }),
      }),
    )
  })

  it('triggers reapproved event when item is reapproved', async () => {
    const item = makeItem({ approvalState: 'INVALIDATED', approvedFingerprint: null })
    const sidecar = makePayload()
    const repo: VaultEditRepository = {
      getItem: vi.fn().mockResolvedValue(item),
      getPayload: vi.fn().mockResolvedValue(sidecar),
      listImageCandidates: vi.fn().mockResolvedValue([item]),
      changeMany: vi.fn().mockResolvedValue({ [item.id]: '2026-10-07T12:00:01Z' }),
    }

    const recordFunnelEvent = vi.fn().mockResolvedValue(undefined)

    await applyVaultEdit(
      repo,
      {
        workspaceId: ws,
        actorId: actor,
        itemRef: itemRef(item),
        expectedVersion: item.updatedAt,
        operation: 'reapprove',
        now: new Date('2026-10-07T12:00:00Z'),
      },
      { recordFunnelEvent },
    )

    expect(recordFunnelEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ws,
        userId: actor,
        event: 'reapproved',
        channel: 'instagram',
        properties: expect.objectContaining({
          vaultItemId: item.id,
          contentId: item.contentId,
          versionId: item.versionId,
          fingerprint: expect.any(String),
        }),
      }),
    )
  })
})
