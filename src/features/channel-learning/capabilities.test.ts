import { describe, expect, it } from 'vitest'
import {
  getLearningCapabilities,
  getLearningCapability,
  isVerificationSupported,
  isCollectionSupported,
  assertPlatformActionAllowed,
} from './capabilities'
import { LearningError } from './contracts'

describe('learning capabilities', () => {
  it('returns all defined platforms in capability list', () => {
    const caps = getLearningCapabilities()
    expect(caps).toHaveLength(6)

    const platforms = caps.map((c) => c.platform)
    expect(platforms).toEqual(
      expect.arrayContaining([
        'instagram',
        'threads',
        'naver_blog',
        'naver_place',
        'daangn_business',
        'website',
      ]),
    )
  })

  it('supports Meta platforms (Instagram, Threads) with official OAuth and API', () => {
    const igCap = getLearningCapability('instagram')
    expect(igCap).toEqual({
      platform: 'instagram',
      verificationMethods: ['oauth'],
      collectionMode: 'official_api',
      blockerCode: null,
    })
    expect(isVerificationSupported('instagram', 'oauth')).toBe(true)
    expect(isVerificationSupported('instagram', 'profile_marker')).toBe(false)
    expect(isCollectionSupported('instagram')).toBe(true)

    const threadsCap = getLearningCapability('threads')
    expect(threadsCap).toEqual({
      platform: 'threads',
      verificationMethods: ['oauth'],
      collectionMode: 'official_api',
      blockerCode: null,
    })
  })

  it('blocks automation for Naver platforms and restricts to manual only', () => {
    const blogCap = getLearningCapability('naver_blog')
    expect(blogCap.collectionMode).toBe('manual_only')
    expect(blogCap.verificationMethods).toEqual([])
    expect(blogCap.blockerCode).toBe('NAVER_AUTOMATION_RESTRICTED')

    const placeCap = getLearningCapability('naver_place')
    expect(placeCap.collectionMode).toBe('manual_only')
    expect(placeCap.verificationMethods).toEqual([])
    expect(placeCap.blockerCode).toBe('NAVER_AUTOMATION_RESTRICTED')

    expect(isVerificationSupported('naver_blog', 'oauth')).toBe(false)
    expect(isCollectionSupported('naver_blog')).toBe(false)

    expect(() => assertPlatformActionAllowed('naver_blog', 'collect')).toThrow(
      LearningError,
    )
    expect(() => assertPlatformActionAllowed('naver_blog', 'verify')).toThrow(
      LearningError,
    )
  })

  it('blocks Daangn business until safe transport and official API exist', () => {
    const daangnCap = getLearningCapability('daangn_business')
    expect(daangnCap.collectionMode).toBe('blocked')
    expect(daangnCap.verificationMethods).toEqual([])
    expect(daangnCap.blockerCode).toBe('CAPABILITY_NOT_ACTIVATED')

    expect(isVerificationSupported('daangn_business', 'profile_marker')).toBe(false)
    expect(isCollectionSupported('daangn_business')).toBe(false)

    expect(() =>
      assertPlatformActionAllowed('daangn_business', 'collect'),
    ).toThrow(LearningError)
  })

  it('blocks Website until safe transport and verification are activated', () => {
    const webCap = getLearningCapability('website')
    expect(webCap.collectionMode).toBe('blocked')
    expect(webCap.verificationMethods).toEqual([])
    expect(webCap.blockerCode).toBe('SAFE_FETCH_NOT_CONFIGURED')

    expect(isVerificationSupported('website', 'dns_txt')).toBe(false)
    expect(isCollectionSupported('website')).toBe(false)

    expect(() => assertPlatformActionAllowed('website', 'verify')).toThrow(
      LearningError,
    )
  })
})
