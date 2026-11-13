import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createProviderDeletionPostHandler } from './route'

const confirmationCode = 'meta_deletion_confirmation_123456'
const context = { params: Promise.resolve({ channel: 'instagram' }) }

function request() {
  const body = new FormData()
  body.set('signed_request', 'valid.signed-request')
  return new Request('https://sohee.test/api/channels/instagram/deletion', { method: 'POST', body })
}

function dependencies() {
  return {
    enabled: true,
    appUrl: 'https://example.com',
    secretFor: vi.fn(() => 'instagram-app-secret'),
    verifySignedRequest: vi.fn(async () => ({ externalAccountId: 'meta-user-42' })),
    generateConfirmationCode: vi.fn(() => confirmationCode),
    createRequest: vi.fn(async () => ({ requestId: '10000000-0000-4000-8000-000000000001' })),
  }
}

describe('Meta data deletion callback', () => {
  it('stops before secrets, signature verification, or storage when the callback is disabled', async () => {
    const deps = dependencies()
    deps.enabled = false

    const response = await createProviderDeletionPostHandler(deps)(request(), context)

    expect(response.status).toBe(503)
    expect(deps.secretFor).not.toHaveBeenCalled()
    expect(deps.verifySignedRequest).not.toHaveBeenCalled()
    expect(deps.generateConfirmationCode).not.toHaveBeenCalled()
    expect(deps.createRequest).not.toHaveBeenCalled()
  })

  it('persists the request before returning the public status URL', async () => {
    const deps = dependencies()
    const response = await createProviderDeletionPostHandler(deps)(request(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      url: `https://example.com/data-deletion/status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    })
    expect(deps.createRequest).toHaveBeenCalledWith({
      provider: 'instagram',
      externalAccountId: 'meta-user-42',
      confirmationCode,
    })
    expect(createHash('sha256').update(confirmationCode).digest('hex')).toHaveLength(64)
  })

  it('distinguishes an invalid signed request from unavailable deletion storage', async () => {
    const invalid = dependencies()
    invalid.verifySignedRequest.mockRejectedValueOnce(new Error('invalid'))
    const invalidResponse = await createProviderDeletionPostHandler(invalid)(request(), context)
    expect(invalidResponse.status).toBe(400)
    expect(invalid.createRequest).not.toHaveBeenCalled()

    const unavailable = dependencies()
    unavailable.createRequest.mockRejectedValueOnce(new Error('storage'))
    const unavailableResponse = await createProviderDeletionPostHandler(unavailable)(request(), context)
    expect(unavailableResponse.status).toBe(503)
  })
})
