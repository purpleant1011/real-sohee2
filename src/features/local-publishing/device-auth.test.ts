import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { authenticateConnectorRequest, digestDeviceToken } from './device-auth'

describe('connector device authentication', () => {
  it('hashes an opaque token and returns only a safe active device', async () => {
    const token = 'a'.repeat(43)
    const digest = await digestDeviceToken(token)
    const gateway = {
      authenticate: vi.fn().mockResolvedValue({
        data: {
          deviceId: '10000000-0000-4000-8000-000000000001',
          workspaceId: '10000000-0000-4000-8000-000000000002',
          platform: 'macos',
          clientVersion: '0.1.0',
          status: 'active',
        },
        error: null,
      }),
    }
    const request = new Request('https://example.com/api/connector/jobs/claim', {
      headers: { authorization: `Bearer ${token}` },
    })

    await expect(authenticateConnectorRequest(request, gateway)).resolves.toMatchObject({
      workspaceId: '10000000-0000-4000-8000-000000000002',
      platform: 'macos',
    })
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(gateway.authenticate).toHaveBeenCalledWith(digest)
  })

  it('rejects malformed bearer tokens and revoked devices', async () => {
    const gateway = { authenticate: vi.fn().mockResolvedValue({ data: null, error: null }) }
    await expect(authenticateConnectorRequest(
      new Request('https://example.com/api/connector/jobs/claim', {
        headers: { authorization: 'Bearer short' },
      }),
      gateway,
    )).resolves.toBeNull()
    expect(gateway.authenticate).not.toHaveBeenCalled()

    const token = 'b'.repeat(43)
    gateway.authenticate.mockResolvedValue({
      data: {
        deviceId: '10000000-0000-4000-8000-000000000001',
        workspaceId: '10000000-0000-4000-8000-000000000002',
        platform: 'windows',
        clientVersion: '0.1.0',
        status: 'revoked',
      },
      error: null,
    })
    await expect(authenticateConnectorRequest(new Request('https://example.com', {
      headers: { authorization: `Bearer ${token}` },
    }), gateway)).resolves.toBeNull()
  })
})
