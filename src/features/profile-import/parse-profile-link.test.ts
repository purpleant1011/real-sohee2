import { describe, expect, it } from 'vitest'
import { parseProfileLink } from './parse-profile-link'

describe('parseProfileLink', () => {
  describe('supported valid profile links', () => {
    it('parses standard Instagram profile URL with trailing slash', () => {
      expect(parseProfileLink('https://www.instagram.com/studio_by.reum/')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
    })

    it('parses Instagram URL without scheme and with query parameters', () => {
      expect(parseProfileLink('instagram.com/studio_by.reum?igsh=OGQ5ZDc2ODk2ZA==')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
    })

    it('parses bare @handle as Instagram', () => {
      expect(parseProfileLink('@studio_by.reum')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
    })

    it('parses Threads profile URL with @ in pathname', () => {
      expect(parseProfileLink('https://www.threads.net/@handle')).toEqual({
        platform: 'threads',
        handle: 'handle',
      })
    })

    it('extracts only handle from threads.com post link', () => {
      expect(parseProfileLink('https://www.threads.com/@handle/post/DF949182xyz')).toEqual({
        platform: 'threads',
        handle: 'handle',
      })
    })

    it('handles leading and trailing whitespace and trims correctly', () => {
      expect(parseProfileLink('   https://www.instagram.com/studio_by.reum/   ')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
      expect(parseProfileLink('   @studio_by.reum   ')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
    })

    it('normalizes uppercase handle to lowercase', () => {
      expect(parseProfileLink('https://www.instagram.com/Studio_By.Reum/')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
      expect(parseProfileLink('@STUDIO_BY.REUM')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
      expect(parseProfileLink('https://www.threads.net/@MyHandle')).toEqual({
        platform: 'threads',
        handle: 'myhandle',
      })
    })

    it('supports http scheme as well as https', () => {
      expect(parseProfileLink('http://instagram.com/studio_by.reum')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
    })

    it('supports mobile domains (m.instagram.com, mobile.instagram.com, m.threads.net, m.threads.com)', () => {
      expect(parseProfileLink('https://m.instagram.com/studio_by.reum/')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
      expect(parseProfileLink('http://mobile.instagram.com/studio_by.reum')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
      expect(parseProfileLink('m.instagram.com/studio_by.reum?igsh=123')).toEqual({
        platform: 'instagram',
        handle: 'studio_by.reum',
      })
      expect(parseProfileLink('https://m.threads.net/@handle')).toEqual({
        platform: 'threads',
        handle: 'handle',
      })
      expect(parseProfileLink('https://m.threads.com/@handle')).toEqual({
        platform: 'threads',
        handle: 'handle',
      })
    })

    it('supports handles containing letters, digits, dots, and underscores up to 30 characters', () => {
      const validHandle = 'user.name_123'
      expect(parseProfileLink(`https://www.threads.net/@${validHandle}`)).toEqual({
        platform: 'threads',
        handle: validHandle,
      })
      const max30Handle = 'a'.repeat(30)
      expect(parseProfileLink(`@${max30Handle}`)).toEqual({
        platform: 'instagram',
        handle: max30Handle,
      })
    })
  })

  describe('Instagram non-profile paths returning null', () => {
    it('returns null for post paths (/p/...)', () => {
      expect(parseProfileLink('https://www.instagram.com/p/DF12345/')).toBeNull()
    })

    it('returns null for reel paths (/reel/... and /reels/...)', () => {
      expect(parseProfileLink('https://www.instagram.com/reel/DF12345/')).toBeNull()
      expect(parseProfileLink('https://www.instagram.com/reels/DF12345/')).toBeNull()
    })

    it('returns null for explore paths (/explore/...)', () => {
      expect(parseProfileLink('https://www.instagram.com/explore/tags/eyebrow/')).toBeNull()
    })

    it('returns null for accounts paths (/accounts/...)', () => {
      expect(parseProfileLink('https://www.instagram.com/accounts/login/')).toBeNull()
    })

    it('returns null for stories paths (/stories/...)', () => {
      expect(parseProfileLink('https://www.instagram.com/stories/studio_by.reum/123456/')).toBeNull()
    })

    it('returns null for share paths (/share/...)', () => {
      expect(parseProfileLink('https://www.instagram.com/share/DF12345/')).toBeNull()
    })
  })

  describe('invalid inputs, schemes, domains, and handle characters returning null', () => {
    it('returns null for non-http/https schemes (ftp, javascript, mailto)', () => {
      expect(parseProfileLink('ftp://instagram.com/studio_by.reum')).toBeNull()
      expect(parseProfileLink('javascript:alert("hack")')).toBeNull()
      expect(parseProfileLink('mailto:studio@instagram.com')).toBeNull()
    })

    it('returns null for other domains (twitter, tiktok, facebook)', () => {
      expect(parseProfileLink('https://twitter.com/studio_by.reum')).toBeNull()
      expect(parseProfileLink('https://tiktok.com/@studio_by.reum')).toBeNull()
      expect(parseProfileLink('https://facebook.com/studio_by.reum')).toBeNull()
    })

    it('returns null for lookalike/phishing domains and subdomains', () => {
      expect(parseProfileLink('https://instagram.com.evil.com/studio_by.reum')).toBeNull()
      expect(parseProfileLink('https://evil.instagram.com/studio_by.reum')).toBeNull()
      expect(parseProfileLink('https://evil-instagram.com/studio_by.reum')).toBeNull()
      expect(parseProfileLink('https://threads.net.evil.com/@handle')).toBeNull()
      expect(parseProfileLink('https://evilthreads.net/@handle')).toBeNull()
    })

    it('returns null for non-standard ports', () => {
      expect(parseProfileLink('https://instagram.com:8080/studio_by.reum')).toBeNull()
      expect(parseProfileLink('https://threads.net:4433/@handle')).toBeNull()
    })

    it('returns null for handles exceeding 30 characters', () => {
      const handle31 = 'a'.repeat(31)
      expect(parseProfileLink(`@${handle31}`)).toBeNull()
      expect(parseProfileLink(`https://instagram.com/${handle31}`)).toBeNull()
    })

    it('returns null for handles with disallowed characters', () => {
      expect(parseProfileLink('@user!name')).toBeNull()
      expect(parseProfileLink('@user-name')).toBeNull()
      expect(parseProfileLink('https://www.instagram.com/user+name/')).toBeNull()
      expect(parseProfileLink('https://www.threads.net/@user#name')).toBeNull()
    })

    it('returns null for empty string or whitespace only', () => {
      expect(parseProfileLink('')).toBeNull()
      expect(parseProfileLink('   ')).toBeNull()
      expect(parseProfileLink('@')).toBeNull()
    })

    it('returns null for base domain without handle', () => {
      expect(parseProfileLink('https://www.instagram.com/')).toBeNull()
      expect(parseProfileLink('https://www.threads.net/')).toBeNull()
    })
  })
})
