import { describe, expect, it, vi } from 'vitest'
import { createProviderDeletionStatusGetHandler } from './route'

const confirmationCode = 'meta_deletion_confirmation_123456'
const context = { params: Promise.resolve({ channel: 'instagram' }) }

describe('provider data deletion status API', () => {
  it('returns only a stored request for the matching provider', async () => {
    const findStatus = vi.fn(async () => ({
      status: 'completed' as const,
      origin: 'meta' as const,
      scope: 'provider' as const,
      provider: 'instagram' as const,
      requestedAt: '2026-08-14T01:00:00.000Z',
      updatedAt: '2026-08-14T01:00:02.000Z',
      completedAt: '2026-08-14T01:00:02.000Z',
    }))
    const response = await createProviderDeletionStatusGetHandler({ findStatus })(
      new Request(`https://sohee.test/api/channels/instagram/deletion/status?code=${confirmationCode}`),
      context,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'completed', confirmation_code: confirmationCode })
    expect(findStatus).toHaveBeenCalledWith({ confirmationCode, provider: 'instagram' })
  })

  it('does not accept a well-formed but unknown confirmation code', async () => {
    const response = await createProviderDeletionStatusGetHandler({ findStatus: vi.fn(async () => null) })(
      new Request(`https://sohee.test/api/channels/instagram/deletion/status?code=${confirmationCode}`),
      context,
    )

    expect(response.status).toBe(404)
  })
})
