import { describe, expect, it } from 'vitest'
import { openOAuthState, sealOAuthState } from './oauth-state'

const key = Buffer.alloc(32, 19).toString('base64url')
const context = {
  channel: 'instagram' as const,
  workspaceId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
  state: 'state-value-with-enough-entropy-123456',
  expiresAt: '2026-08-13T04:10:00.000Z',
}

describe('OAuth state envelope', () => {
  it('round-trips the exact context before expiry', async () => {
    const sealed = await sealOAuthState(context, key)
    expect(sealed).not.toContain(context.workspaceId)
    await expect(openOAuthState(sealed, key, new Date('2026-08-13T04:05:00.000Z'))).resolves.toEqual(context)
  })

  it('round-trips the exact context with returnPath before expiry', async () => {
    const withReturnPath = { ...context, returnPath: '/start?step=channels' }
    const sealed = await sealOAuthState(withReturnPath, key)
    await expect(openOAuthState(sealed, key, new Date('2026-08-13T04:05:00.000Z'))).resolves.toEqual(withReturnPath)
  })

  it('binds an allowlisted mobile origin in the encrypted envelope', async () => {
    const mobile = { ...context, returnOrigin: 'https://m.example.com' as const }
    const sealed = await sealOAuthState(mobile, key)
    await expect(openOAuthState(sealed, key, new Date('2026-08-13T04:05:00.000Z'))).resolves.toEqual(mobile)
    await expect(sealOAuthState({ ...context, returnOrigin: 'https://evil.example' } as never, key)).rejects.toThrow()
  })

  it('rejects tampering, expiry, and a state value that lacks entropy', async () => {
    const sealed = await sealOAuthState(context, key)
    await expect(openOAuthState(`${sealed}a`, key, new Date('2026-08-13T04:05:00.000Z'))).rejects.toThrow('채널 연결 요청이 만료되었거나 올바르지 않습니다.')
    await expect(openOAuthState(sealed, key, new Date('2026-08-13T04:11:00.000Z'))).rejects.toThrow('채널 연결 요청이 만료되었거나 올바르지 않습니다.')
    await expect(sealOAuthState({ ...context, state: 'short' }, key)).rejects.toThrow('채널 연결 요청을 만들지 못했습니다.')
  })
})
