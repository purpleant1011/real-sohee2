import { describe, expect, it, vi } from 'vitest'
import {
  generateVaultFunnelDedupeKey,
  recordVaultFunnelEvent,
} from '../service'
import type { VaultFunnelEventInput } from '../types'

describe('recordVaultFunnelEvent & Idempotency', () => {
  function createMockAdmin() {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    return {
      admin: {
        from: vi.fn().mockReturnValue({
          upsert: upsertMock,
        }),
      },
      upsertMock,
    }
  }

  const sampleInput: VaultFunnelEventInput = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-001',
    event: 'vault_saved',
    channel: 'instagram',
    properties: {
      contentId: '22222222-2222-4222-8222-222222222222',
      versionId: '33333333-3333-4333-8333-333333333333',
      vaultItemId: '44444444-4444-4444-8444-444444444444',
      fingerprint: 'a'.repeat(64),
      idempotencyKey: 'save-key-abc',
    },
  }

  it('generates a stable deterministic dedupe key for identical user action', () => {
    const key1 = generateVaultFunnelDedupeKey(sampleInput)
    const key2 = generateVaultFunnelDedupeKey(sampleInput)
    expect(key1).toBe(key2)
    expect(key1).toContain('instagram')
    expect(key1).toContain('vault_saved')
    expect(key1).toContain('save-key-abc')
  })

  it('records an event with onConflict ignoreDuplicates upsert', async () => {
    const { admin, upsertMock } = createMockAdmin()

    const result = await recordVaultFunnelEvent(sampleInput, { admin })
    expect(result.success).toBe(true)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: sampleInput.workspaceId,
        user_id: sampleInput.userId,
        event: 'vault_saved',
        properties: expect.objectContaining({
          channel: 'instagram',
          vaultItemId: '44444444-4444-4444-8444-444444444444',
        }),
        dedupe_key: expect.any(String),
      }),
      { onConflict: 'workspace_id,event,dedupe_key', ignoreDuplicates: true },
    )
  })

  it('rejects recording if forbidden content payload (title/text) is passed', async () => {
    const { admin, upsertMock } = createMockAdmin()
    const dirtyInput: any = {
      ...sampleInput,
      properties: {
        ...sampleInput.properties,
        title: '포스팅 제목 유출 시도',
      },
    }

    await expect(recordVaultFunnelEvent(dirtyInput, { admin })).rejects.toThrow()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('telemetry error does not crash caller when soft telemetry is requested, but logs warning', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: { message: 'db lock' } })
    const admin = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await recordVaultFunnelEvent(sampleInput, { admin })
    expect(result.success).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
