import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_PAYLOAD_KEYS,
  sanitizeOrValidateVaultFunnelPayload,
  validateVaultFunnelPayload,
  VaultFunnelPayloadError,
} from '../schema'

describe('Vault Funnel Privacy Safe Payload Schema', () => {
  it('accepts clean metadata payload without raw content', () => {
    const valid = {
      channel: 'instagram' as const,
      contentId: '11111111-1111-4111-8111-111111111111',
      versionId: '22222222-2222-4222-8222-222222222222',
      vaultItemId: '33333333-3333-4333-8333-333333333333',
      targetDate: '2026-10-15',
      fingerprint: 'a'.repeat(64),
      idempotencyKey: 'save:item-1:instagram',
    }

    const validated = validateVaultFunnelPayload(valid)
    expect(validated).toMatchObject(valid)
  })

  it('strictly rejects any raw content fields (title, text, caption, body, hashtags)', () => {
    for (const forbiddenKey of FORBIDDEN_PAYLOAD_KEYS) {
      const payloadWithForbidden = {
        channel: 'instagram',
        contentId: '11111111-1111-4111-8111-111111111111',
        [forbiddenKey]: '매장 오픈 이벤트! 지금 방문하시면 커피 무료!',
      }

      expect(() => validateVaultFunnelPayload(payloadWithForbidden)).toThrowError(
        VaultFunnelPayloadError,
      )
    }
  })

  it('rejects nested or arbitrary fields containing forbidden content keys', () => {
    const nested = {
      channel: 'naver_blog',
      metadata: {
        title: '블로그 포스팅 제목 노출 시도',
      },
    }
    expect(() => validateVaultFunnelPayload(nested)).toThrowError(
      VaultFunnelPayloadError,
    )
  })

  it('sanitizeOrValidateVaultFunnelPayload strips forbidden keys and returns safe object', () => {
    const dirty = {
      channel: 'threads' as const,
      contentId: '11111111-1111-4111-8111-111111111111',
      title: '비밀 이벤트 제목',
      caption: '스레드 본문 내용',
      hashtags: ['#커피', '#카페'],
    }

    const sanitized = sanitizeOrValidateVaultFunnelPayload(dirty)
    expect(sanitized).toHaveProperty('channel', 'threads')
    expect(sanitized).toHaveProperty('contentId')
    expect(sanitized).not.toHaveProperty('title')
    expect(sanitized).not.toHaveProperty('caption')
    expect(sanitized).not.toHaveProperty('hashtags')
  })
})
