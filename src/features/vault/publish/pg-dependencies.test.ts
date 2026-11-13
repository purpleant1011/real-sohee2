import { describe, expect, it, vi } from 'vitest'
import { createBatchPublishDependencies } from './pg-dependencies'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'
import type { VaultItem } from '../types'

vi.mock('@/lib/agent-os/executors/publishing-executor', () => ({
  PublishingExecutor: {
    executePublish: vi.fn(),
  },
}))

describe('createBatchPublishDependencies - publish adapter', () => {
  const baseItem = (channel: VaultItem['channel']): VaultItem => ({
    id: 'item-1',
    workspaceId: 'ws-1',
    contentId: 'content-1',
    versionId: 'ver-1',
    channel,
    releaseGate: 'RELEASE_REQUESTED',
    holdReason: 'RELEASE_REQUESTED',
    heldAt: new Date().toISOString(),
    heldBy: null,
    targetDate: null,
    approvedFingerprint: 'f'.repeat(64),
    fingerprintSchemaVersion: 3,
    policyVersion: 'vault-save-v1',
    specVersion: '2026.10.1',
    approvalState: 'APPROVED',
    approvedBy: 'user-1',
    bundleId: null,
    idempotencyKey: 'idemp-1',
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
  })

  it('fails closed when Instagram has missing image renditions', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'vault_variant_payloads') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { payload: { text: '인스타 본문' } }, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'vault_image_renditions') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }),
          }
        }
        return {}
      }),
      storage: {
        from: () => ({ createSignedUrl: vi.fn() }),
      },
    }

    const deps = createBatchPublishDependencies(mockAdmin as never)
    await expect(deps.publish(baseItem('instagram'), 'actor-1')).rejects.toThrow('게시 이미지를 확인할 수 없어요')
    expect(PublishingExecutor.executePublish).not.toHaveBeenCalled()
  })

  it('allows Threads text-only publish when renditions are missing', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'vault_variant_payloads') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { payload: { text: '스레드 본문' } }, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'vault_image_renditions') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }),
          }
        }
        return {}
      }),
      storage: {
        from: () => ({ createSignedUrl: vi.fn() }),
      },
    }

    vi.mocked(PublishingExecutor.executePublish).mockResolvedValueOnce({
      success: true,
      verified: true,
      stage: 'EXTERNAL_VERIFIED',
      channel: 'THREADS',
      publishedUrl: 'https://threads.net/@store/post/1',
      statusMessage: '게시 완료',
    })

    const deps = createBatchPublishDependencies(mockAdmin as never)
    const result = await deps.publish(baseItem('threads'), 'actor-1')

    expect(result.success).toBe(true)
    expect(PublishingExecutor.executePublish).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      channel: 'THREADS',
      caption: '스레드 본문',
      imageUrl: undefined,
      actorUserId: 'actor-1',
      contentVersionId: 'ver-1',
      expectedFingerprint: 'f'.repeat(64),
    })
  })

  describe('enabled(workspaceId) rollout allowlist gating', () => {
    const wsAllowed = '00000000-0000-4000-8000-0000000000a1'
    const wsBlocked = '11111111-2222-3333-4444-555555555555'

    it('returns false when VAULT_PUBLISH_ENABLED is not 1', () => {
      const origPublish = process.env.VAULT_PUBLISH_ENABLED
      const origList = process.env.META_LIVE_WORKSPACE_ALLOWLIST
      try {
        process.env.VAULT_PUBLISH_ENABLED = '0'
        process.env.META_LIVE_WORKSPACE_ALLOWLIST = wsAllowed
        const deps = createBatchPublishDependencies({} as never)
        expect(deps.enabled(wsAllowed)).toBe(false)
      } finally {
        process.env.VAULT_PUBLISH_ENABLED = origPublish
        process.env.META_LIVE_WORKSPACE_ALLOWLIST = origList
      }
    })

    it('returns true only when VAULT_PUBLISH_ENABLED is 1 and workspace is allowlisted', () => {
      const origPublish = process.env.VAULT_PUBLISH_ENABLED
      const origList = process.env.META_LIVE_WORKSPACE_ALLOWLIST
      try {
        process.env.VAULT_PUBLISH_ENABLED = '1'
        process.env.META_LIVE_WORKSPACE_ALLOWLIST = wsAllowed
        const deps = createBatchPublishDependencies({} as never)
        expect(deps.enabled(wsAllowed)).toBe(true)
        expect(deps.enabled(wsBlocked)).toBe(false)
        expect(deps.enabled(undefined)).toBe(false)
      } finally {
        process.env.VAULT_PUBLISH_ENABLED = origPublish
        process.env.META_LIVE_WORKSPACE_ALLOWLIST = origList
      }
    })
  })
})
