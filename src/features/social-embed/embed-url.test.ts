import { describe, expect, it } from 'vitest'
import { getEmbedUrl } from './embed-url'

describe('getEmbedUrl', () => {
  describe('Instagram permalinks', () => {
    it('transforms standard post URL to embed URL', () => {
      expect(getEmbedUrl('https://www.instagram.com/p/Cxyz123/')).toEqual({
        provider: 'instagram',
        src: 'https://www.instagram.com/p/Cxyz123/embed',
      })
    })

    it('transforms post URL without trailing slash or www', () => {
      expect(getEmbedUrl('https://instagram.com/p/Cxyz123')).toEqual({
        provider: 'instagram',
        src: 'https://www.instagram.com/p/Cxyz123/embed',
      })
    })

    it('transforms reel URL to reel embed URL', () => {
      expect(getEmbedUrl('https://www.instagram.com/reel/Cxyz123/')).toEqual({
        provider: 'instagram',
        src: 'https://www.instagram.com/reel/Cxyz123/embed',
      })
    })

    it('transforms reels path URL to reel embed URL', () => {
      expect(getEmbedUrl('https://instagram.com/reels/Cxyz123/')).toEqual({
        provider: 'instagram',
        src: 'https://www.instagram.com/reel/Cxyz123/embed',
      })
    })

    it('handles already embedded URL idempotently without duplicating /embed', () => {
      expect(getEmbedUrl('https://www.instagram.com/p/Cxyz123/embed')).toEqual({
        provider: 'instagram',
        src: 'https://www.instagram.com/p/Cxyz123/embed',
      })
    })

    it('strips query strings and hash fragments', () => {
      expect(
        getEmbedUrl('https://www.instagram.com/p/Cxyz123/?utm_source=ig_web_copy_link&igsh=MzRl#heading'),
      ).toEqual({
        provider: 'instagram',
        src: 'https://www.instagram.com/p/Cxyz123/embed',
      })
    })
  })

  describe('Threads permalinks', () => {
    it('transforms threads.com post URL to embed URL', () => {
      expect(getEmbedUrl('https://www.threads.com/@sohee/post/THREAD123')).toEqual({
        provider: 'threads',
        src: 'https://www.threads.com/@sohee/post/THREAD123/embed',
      })
    })

    it('transforms threads.net post URL with output domain as threads.com', () => {
      expect(getEmbedUrl('https://threads.net/@sohee.ai/post/THREAD123/')).toEqual({
        provider: 'threads',
        src: 'https://www.threads.com/@sohee.ai/post/THREAD123/embed',
      })
    })

    it('transforms www.threads.net post URL', () => {
      expect(getEmbedUrl('https://www.threads.net/@user_123/post/THREAD123')).toEqual({
        provider: 'threads',
        src: 'https://www.threads.com/@user_123/post/THREAD123/embed',
      })
    })

    it('adds leading @ if missing in username', () => {
      expect(getEmbedUrl('https://threads.net/sohee/post/THREAD123')).toEqual({
        provider: 'threads',
        src: 'https://www.threads.com/@sohee/post/THREAD123/embed',
      })
    })

    it('handles already embedded threads URL idempotently', () => {
      expect(getEmbedUrl('https://www.threads.com/@sohee/post/THREAD123/embed')).toEqual({
        provider: 'threads',
        src: 'https://www.threads.com/@sohee/post/THREAD123/embed',
      })
    })

    it('strips query strings and hash fragments from threads permalinks', () => {
      expect(
        getEmbedUrl('https://threads.net/@sohee/post/THREAD123?x=1&utm_medium=share#anchor'),
      ).toEqual({
        provider: 'threads',
        src: 'https://www.threads.com/@sohee/post/THREAD123/embed',
      })
    })
  })

  describe('Invalid and malicious inputs return null', () => {
    it('returns null for null, undefined, empty, or whitespace-only inputs', () => {
      expect(getEmbedUrl(null)).toBeNull()
      expect(getEmbedUrl(undefined)).toBeNull()
      expect(getEmbedUrl('')).toBeNull()
      expect(getEmbedUrl('   ')).toBeNull()
    })

    it('rejects non-https protocols (http, ftp, javascript, data)', () => {
      expect(getEmbedUrl('http://www.instagram.com/p/Cxyz123/')).toBeNull()
      expect(getEmbedUrl('http://threads.net/@user/post/Cxyz123')).toBeNull()
      expect(getEmbedUrl('javascript:alert(1)')).toBeNull()
      expect(getEmbedUrl('data:text/html,hello')).toBeNull()
    })

    it('rejects unapproved hosts and subdomain spoofing', () => {
      expect(getEmbedUrl('https://malicious-instagram.com/p/Cxyz123/')).toBeNull()
      expect(getEmbedUrl('https://instagram.com.evil.com/p/Cxyz123/')).toBeNull()
      expect(getEmbedUrl('https://fake-threads.net/@user/post/123')).toBeNull()
      expect(getEmbedUrl('https://naver.com/p/Cxyz123')).toBeNull()
      expect(getEmbedUrl('https://blog.naver.com/test')).toBeNull()
    })

    it('rejects path traversal attempts', () => {
      expect(getEmbedUrl('https://instagram.com/p/../admin')).toBeNull()
      expect(getEmbedUrl('https://instagram.com/p/%2e%2e/admin')).toBeNull()
      expect(getEmbedUrl('https://threads.net/@user/post/../../evil')).toBeNull()
      expect(getEmbedUrl('https://threads.net/@../post/123')).toBeNull()
    })

    it('rejects unsupported or incomplete paths', () => {
      expect(getEmbedUrl('https://instagram.com/explore/')).toBeNull()
      expect(getEmbedUrl('https://instagram.com/p/')).toBeNull()
      expect(getEmbedUrl('https://threads.net/@user')).toBeNull()
      expect(getEmbedUrl('https://threads.net/')).toBeNull()
      expect(getEmbedUrl('https://instagram.com/p/bad;inject/')).toBeNull()
    })
  })
})
