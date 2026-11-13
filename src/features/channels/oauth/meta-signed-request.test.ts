import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { verifyMetaSignedRequest } from './meta-signed-request'

function encode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function signed(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = encode(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${signature}.${encodedPayload}`
}

describe('Meta signed request verification', () => {
  it('returns only the validated account identity for a current HMAC-SHA256 request', async () => {
    const now = Math.floor(Date.now() / 1000)
    await expect(verifyMetaSignedRequest(signed({ algorithm: 'HMAC-SHA256', user_id: '1789001', issued_at: now }, 'app-secret'), 'app-secret'))
      .resolves.toEqual({ externalAccountId: '1789001' })
  })

  it.each([
    ['wrong secret', signed({ algorithm: 'HMAC-SHA256', user_id: '1789001', issued_at: Math.floor(Date.now() / 1000) }, 'right-secret'), 'wrong-secret'],
    ['wrong algorithm', signed({ algorithm: 'none', user_id: '1789001', issued_at: Math.floor(Date.now() / 1000) }, 'app-secret'), 'app-secret'],
    ['expired payload', signed({ algorithm: 'HMAC-SHA256', user_id: '1789001', issued_at: Math.floor(Date.now() / 1000) - 86_401 }, 'app-secret'), 'app-secret'],
  ])('rejects %s without exposing the signed payload', async (_label, value, secret) => {
    await expect(verifyMetaSignedRequest(value, secret)).rejects.toThrow('META_SIGNED_REQUEST_INVALID')
  })
})
