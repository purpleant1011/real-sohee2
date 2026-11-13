import { describe, expect, it } from 'vitest'
import { payloadToPreview } from './payload-to-preview'

describe('payloadToPreview', () => {
  it('safely converts instagram payload with fallback for missing fields', () => {
    const empty = payloadToPreview('instagram', null)
    expect(empty.channel).toBe('instagram')
    if (empty.channel === 'instagram') {
      expect(empty.variant.caption).toBe('')
      expect(empty.variant.handle).toBe('내 계정')
      expect(empty.variant.hashtags).toEqual([])
    }

    const filled = payloadToPreview('instagram', {
      caption: '인스타 본문',
      hashtags: ['소희', '카페'],
      imageUrl: 'https://example.com/a.jpg',
    })
    if (filled.channel === 'instagram') {
      expect(filled.variant.caption).toBe('인스타 본문')
      expect(filled.variant.hashtags).toEqual(['소희', '카페'])
      expect(filled.variant.imageUrl).toBe('https://example.com/a.jpg')
    }
  })

  it('safely converts threads payload', () => {
    const result = payloadToPreview('threads', { text: '스레드 본문', hashtags: ['스레드'] })
    expect(result.channel).toBe('threads')
    if (result.channel === 'threads') {
      expect(result.variant.caption).toBe('스레드 본문')
      expect(result.variant.hashtags).toEqual(['스레드'])
    }
  })

  it('safely converts naver_blog payload with blocks, title and text', () => {
    const result = payloadToPreview('naver_blog', {
      title: '블로그 제목',
      text: '블로그 본문',
      blocks: [{ type: 'paragraph', text: '블로그 본문' }],
      hashtags: ['네이버'],
    })
    expect(result.channel).toBe('naver_blog')
    if (result.channel === 'naver_blog') {
      expect(result.variant?.title).toBe('블로그 제목')
      expect(result.variant?.text).toBe('블로그 본문')
      expect(result.variant?.blocks).toHaveLength(1)
      expect(result.variant?.hashtags).toEqual(['네이버'])
    }
  })

  it('preserves neighbor and mutual-neighbor visibility in Naver previews', () => {
    for (const visibility of ['neighbor', 'mutual_neighbor']) {
      const preview = payloadToPreview('naver_blog', { title: '제목', visibility })
      expect(preview.channel).toBe('naver_blog')
      if (preview.channel === 'naver_blog') expect(preview.variant?.visibility).toBe(visibility)
    }
  })

  it('safely converts daangn_business payload with firstLineHighlight and coupon', () => {
    const result = payloadToPreview('daangn_business', {
      text: '당근 소식 본문',
      firstLineHighlight: '첫 줄 강조',
      coupon: '첫 방문 혜택',
      businessName: '우리 가게',
    })
    expect(result.channel).toBe('daangn_business')
    if (result.channel === 'daangn_business') {
      expect(result.variant?.text).toBe('당근 소식 본문')
      expect(result.variant?.firstLineHighlight).toBe('첫 줄 강조')
      expect(result.variant?.coupon).toBe('첫 방문 혜택')
      expect(result.variant?.businessName).toBe('우리 가게')
    }
  })

  it('maps one private image URL to previews of all four channels', () => {
    const url = '/api/workspaces/space/media/image'
    const media = [{ type: 'image', mimeType: 'image/png', src: url }]
    const instagram = payloadToPreview('instagram', { caption: '사진', media, imageUrls: [url] })
    const threads = payloadToPreview('threads', { text: '사진', media })
    const naver = payloadToPreview('naver_blog', { title: '사진', text: '사진', media })
    const daangn = payloadToPreview('daangn_business', { text: '사진', media })
    if (instagram.channel === 'instagram') expect(instagram.variant.imageUrls).toEqual([url])
    if (threads.channel === 'threads') expect(threads.variant.imageUrl).toBe(url)
    if (naver.channel === 'naver_blog') expect(naver.variant?.media?.[0].src).toBe(url)
    if (daangn.channel === 'daangn_business') expect(daangn.variant?.media?.[0]).toMatchObject({ url })
  })

  it('does not crash on malformed payloads with unexpected types', () => {
    const malformed = payloadToPreview('daangn_business', {
      text: 12345,
      firstLineHighlight: null,
      coupon: ['not-a-string'],
    })
    if (malformed.channel === 'daangn_business') {
      expect(malformed.variant?.text).toBe('')
      expect(malformed.variant?.firstLineHighlight).toBeUndefined()
      expect(malformed.variant?.coupon).toBeUndefined()
    }
  })
})
