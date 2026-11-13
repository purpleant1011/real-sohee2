import { describe, expect, it, vi } from 'vitest'
import { createDataDeletionStatusGetHandler } from './route'

const confirmationCode = 'deletion_confirmation_code_123456'
const status = {
  status: 'pending' as const,
  origin: 'authenticated' as const,
  scope: 'member' as const,
  provider: null,
  requestedAt: '2026-08-14T01:00:00.000Z',
  updatedAt: '2026-08-14T01:00:00.000Z',
  completedAt: null,
}

describe('public data deletion status API', () => {
  it('returns the persisted request state without workspace or user identifiers', async () => {
    const findStatus = vi.fn(async () => status)
    const response = await createDataDeletionStatusGetHandler({ findStatus })(
      new Request(`https://sohee.test/api/data-deletion/status?code=${confirmationCode}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0')
    expect(await response.json()).toEqual({
      status: 'pending',
      confirmation_code: confirmationCode,
      requested_at: status.requestedAt,
      updated_at: status.updatedAt,
      completed_at: null,
    })
    expect(findStatus).toHaveBeenCalledWith({ confirmationCode })
  })

  it('returns not found instead of treating an arbitrary code as complete', async () => {
    const response = await createDataDeletionStatusGetHandler({ findStatus: vi.fn(async () => null) })(
      new Request(`https://sohee.test/api/data-deletion/status?code=${confirmationCode}`),
    )

    expect(response.status).toBe(404)
  })
})
