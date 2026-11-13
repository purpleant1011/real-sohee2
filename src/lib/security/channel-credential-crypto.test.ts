import { describe, expect, it } from 'vitest'
import { decryptChannelCredential, encryptChannelCredential } from './channel-credential-crypto'

describe('channel credential encryption', () => {
  it('round-trips a token with authenticated AES-GCM and unique nonces', async () => {
    const key = Buffer.alloc(32, 7).toString('base64url')
    const first = await encryptChannelCredential('token-one', key)
    const second = await encryptChannelCredential('token-one', key)

    expect(first.ciphertext).not.toBe('token-one')
    expect(first.iv).not.toBe(second.iv)
    await expect(decryptChannelCredential(first, key)).resolves.toBe('token-one')
  })

  it('rejects malformed keys and tampered ciphertext', async () => {
    await expect(encryptChannelCredential('token', 'short')).rejects.toThrow(
      '채널 자격 증명 암호화 키를 확인해 주세요.',
    )
    const key = Buffer.alloc(32, 8).toString('base64url')
    const encrypted = await encryptChannelCredential('token', key)
    await expect(decryptChannelCredential({ ...encrypted, ciphertext: `${encrypted.ciphertext}a` }, key))
      .rejects.toThrow('채널 자격 증명을 열 수 없습니다.')
  })
})
