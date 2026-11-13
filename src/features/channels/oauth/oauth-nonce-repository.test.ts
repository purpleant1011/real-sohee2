import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { consumeOAuthNonce, registerOAuthNonce } from './oauth-nonce-repository'

const input = {
  state: 'state-value-with-enough-entropy-123456',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  actorUserId: '30000000-0000-4000-8000-000000000001',
  channel: 'instagram' as const,
  expiresAt: '2026-08-13T04:10:00.000Z',
}

describe('OAuth nonce repository', () => {
  it('stores only a digest and atomically consumes it once', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
    await expect(registerOAuthNonce(input, { rpc })).resolves.toBeUndefined()
    const registered = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(registered.p_nonce_sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(registered)).not.toContain(input.state)
    await expect(consumeOAuthNonce(input, { rpc })).resolves.toBeUndefined()
    await expect(consumeOAuthNonce(input, { rpc })).rejects.toThrow('이미 사용되었거나 만료')
  })
})
