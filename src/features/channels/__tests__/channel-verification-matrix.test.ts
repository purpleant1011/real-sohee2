import { describe, it, expect } from 'vitest'
import {
  CHANNEL_CAPABILITY_REGISTRY,
  createVerificationEvidence,
} from '../channel-verification-matrix'

describe('Channel Verification Matrix & Honesty Registry (ANI-340, ANI-384~396)', () => {
  it('strictly marks unsupported Kakao features as NOT_SUPPORTED', () => {
    const kakaoCaps = CHANNEL_CAPABILITY_REGISTRY.KAKAO
    const personalChat = kakaoCaps.find((c) => c.capabilityKey === 'KAKAO_PERSONAL_CHAT_AUTO_SEND')

    expect(personalChat).toBeDefined()
    expect(personalChat?.isSupported).toBe(false)
    expect(personalChat?.supportTier).toBe('NOT_SUPPORTED')

    const naverCaps = CHANNEL_CAPABILITY_REGISTRY.NAVER_BLOG
    const naverPost = naverCaps.find((c) => c.capabilityKey === 'NAVER_BLOG_POST')
    expect(naverPost?.name).toBe('네이버 블로그 원고 및 사진 준비')
    expect(naverPost?.name).not.toContain('스마트에디터 ONE 발행')
  })

  it('enforces externalObjectId or externalUrl when creating verification evidence', () => {
    expect(() =>
      createVerificationEvidence('ws-1', 'act-1', 'META_INSTAGRAM', '', undefined)
    ).toThrow('실제 external ObjectId 또는 Permalink URL이 없으면 VERIFIED 증빙을 생성할 수 없습니다')

    const validEvidence = createVerificationEvidence(
      'ws-1',
      'act-1',
      'META_INSTAGRAM',
      'media-123456',
      'https://instagram.com/p/abc1234'
    )

    expect(validEvidence.externalObjectId).toBe('media-123456')
    expect(validEvidence.externalUrl).toBe('https://instagram.com/p/abc1234')
    expect(validEvidence.verificationMethod).toBe('API_READ_BACK')
  })

  it('selects BROWSER_DOM_FINGERPRINT verification method for Naver and Danggeun', () => {
    const naverEvidence = createVerificationEvidence(
      'ws-1',
      'act-2',
      'NAVER_BLOG',
      'naver-post-98765',
      'https://blog.naver.com/sohee/98765'
    )
    expect(naverEvidence.verificationMethod).toBe('BROWSER_DOM_FINGERPRINT')
  })
})
