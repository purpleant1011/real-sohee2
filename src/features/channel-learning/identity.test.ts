import { describe, expect, it } from 'vitest'
import { normalizeLearningUrl } from './identity'
import { LearningError } from './contracts'

describe('identity URL normalization', () => {
  describe('protocol and security guardrails', () => {
    it('rejects non-HTTPS protocols', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'http://www.instagram.com/my_salon'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('instagram', 'http://www.instagram.com/my_salon'),
      ).toThrowError(/https/i)
    })

    it('rejects userinfo in URL', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'https://admin:pass@instagram.com/my_salon'),
      ).toThrow(LearningError)
    })

    it('rejects explicit non-default ports', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'https://instagram.com:8080/my_salon'),
      ).toThrow(LearningError)
    })

    it('rejects foreign or spoofed domains', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'https://instagram.com.evil.test/my_salon'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('threads', 'https://threads.net.attacker.org/@my_salon'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('naver_blog', 'https://blog.naver.com.phishing.io/my_blog'),
      ).toThrow(LearningError)
    })

    it('rejects private IPs, localhost, and metadata hosts', () => {
      expect(() =>
        normalizeLearningUrl('website', 'https://127.0.0.1/profile'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('website', 'https://localhost/profile'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('website', 'https://169.254.169.254/latest/meta-data'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('website', 'https://[::1]/profile'),
      ).toThrow(LearningError)
    })

    it('rejects ambiguous encoded paths or path traversal', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/%2e%2e/admin'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/my_salon%2fextra'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('threads', 'https://www.threads.net/@my_salon%252e'),
      ).toThrow(LearningError)
    })
  })

  describe('instagram platform normalization', () => {
    it('normalizes standard instagram profile URL', () => {
      const result = normalizeLearningUrl('instagram', 'https://www.instagram.com/byreum_official/')
      expect(result).toEqual({
        canonicalUrl: 'https://www.instagram.com/byreum_official',
        canonicalIdentity: 'byreum_official',
      })
    })

    it('normalizes apex instagram.com and case-insensitive username', () => {
      const result = normalizeLearningUrl('instagram', 'https://instagram.com/ByReum.Official?igsh=123#feed')
      expect(result).toEqual({
        canonicalUrl: 'https://www.instagram.com/byreum.official',
        canonicalIdentity: 'byreum.official',
      })
    })

    it('rejects post, reel, explore and reserved routes', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/p/C-abcd123/'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/reel/C-abcd123/'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/explore/tags/sohee'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/direct/inbox'),
      ).toThrow(LearningError)
    })

    it('rejects invalid instagram usernames', () => {
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/.invalid/'),
      ).toThrow(LearningError)
      expect(() =>
        normalizeLearningUrl('instagram', 'https://www.instagram.com/invalid_name_too_long_exceeding_thirty_characters/'),
      ).toThrow(LearningError)
    })
  })

  describe('threads platform normalization', () => {
    it('normalizes threads.net profile with @ symbol', () => {
      const result = normalizeLearningUrl('threads', 'https://www.threads.net/@sohee_daily')
      expect(result).toEqual({
        canonicalUrl: 'https://www.threads.net/@sohee_daily',
        canonicalIdentity: 'sohee_daily',
      })
    })

    it('supports threads.com alias and normalizes without @ symbol', () => {
      const result = normalizeLearningUrl('threads', 'https://threads.com/SoHee_Daily?hl=ko')
      expect(result).toEqual({
        canonicalUrl: 'https://www.threads.net/@sohee_daily',
        canonicalIdentity: 'sohee_daily',
      })
    })

    it('rejects threads post routes', () => {
      expect(() =>
        normalizeLearningUrl('threads', 'https://www.threads.net/@sohee_daily/post/C-12345'),
      ).toThrow(LearningError)
    })
  })

  describe('naver_blog platform normalization', () => {
    it('normalizes blog.naver.com standard path', () => {
      const result = normalizeLearningUrl('naver_blog', 'https://blog.naver.com/sohee_salon')
      expect(result).toEqual({
        canonicalUrl: 'https://blog.naver.com/sohee_salon',
        canonicalIdentity: 'sohee_salon',
      })
    })

    it('normalizes mobile m.blog.naver.com and query blogId', () => {
      const result = normalizeLearningUrl('naver_blog', 'https://m.blog.naver.com/PostList.naver?blogId=Sohee_Salon')
      expect(result).toEqual({
        canonicalUrl: 'https://blog.naver.com/sohee_salon',
        canonicalIdentity: 'sohee_salon',
      })
    })
  })

  describe('naver_place platform normalization', () => {
    it('normalizes map.naver.com entry place URL', () => {
      const result = normalizeLearningUrl('naver_place', 'https://map.naver.com/p/entry/place/1897283741?c=15.00,0,0,0,dh')
      expect(result).toEqual({
        canonicalUrl: 'https://map.naver.com/p/entry/place/1897283741',
        canonicalIdentity: '1897283741',
      })
    })

    it('normalizes m.place.naver.com place URL', () => {
      const result = normalizeLearningUrl('naver_place', 'https://m.place.naver.com/place/1897283741/home')
      expect(result).toEqual({
        canonicalUrl: 'https://map.naver.com/p/entry/place/1897283741',
        canonicalIdentity: '1897283741',
      })
    })
  })

  describe('daangn_business platform normalization', () => {
    it('normalizes local-profile URL', () => {
      const result = normalizeLearningUrl('daangn_business', 'https://www.daangn.com/kr/local-profile/byreum-qfm5ujuvd65o/')
      expect(result).toEqual({
        canonicalUrl: 'https://www.daangn.com/kr/local-profile/byreum-qfm5ujuvd65o',
        canonicalIdentity: 'byreum-qfm5ujuvd65o',
      })
    })

    it('normalizes business-profile URL path', () => {
      const result = normalizeLearningUrl('daangn_business', 'https://daangn.com/kr/business-profile/byreum-biz-1234')
      expect(result).toEqual({
        canonicalUrl: 'https://www.daangn.com/kr/local-profile/byreum-biz-1234',
        canonicalIdentity: 'byreum-biz-1234',
      })
    })
  })

  describe('website platform normalization', () => {
    it('normalizes standard public website URL', () => {
      const result = normalizeLearningUrl('website', 'https://byreum.kr/about?ref=nav#top')
      expect(result).toEqual({
        canonicalUrl: 'https://byreum.kr/about',
        canonicalIdentity: 'byreum.kr',
      })
    })

    it('normalizes root domain with trailing slash removed', () => {
      const result = normalizeLearningUrl('website', 'https://byreum.kr/')
      expect(result).toEqual({
        canonicalUrl: 'https://byreum.kr',
        canonicalIdentity: 'byreum.kr',
      })
    })
  })
})
