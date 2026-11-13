import { describe, expect, it, vi } from 'vitest'
vi.mock('next/font/local', () => ({ default: () => ({ variable: '--font-pretendard' }) }))
import { metadata } from './layout'
import sitemap from './sitemap'
import robots from './robots'

describe('V0.85 marketing metadata', () => {
  it('검색 제목과 공유 이미지를 제공한다', () => {
    expect(metadata.title).toBe('소희 | 여러 마케팅 채널을 한곳에서')
    expect(metadata.description).toContain('고객 문의')
    expect(metadata.openGraph?.images).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: '/images/marketing/v085/sohee-marketing-og-v1.png' }),
    ]))
  })

  it('공개 결정 경로만 사이트맵에 포함한다', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls).toEqual(expect.arrayContaining([
      'https://example.com/',
      'https://example.com/product',
      'https://example.com/channels',
      'https://example.com/diagnosis',
      'https://example.com/signup',
    ]))
    expect(urls.some((url) => url.includes('/app'))).toBe(false)
  })

  it('보호 경로와 내부 API를 검색에서 제외한다', () => {
    const rules = robots().rules
    expect(rules).toEqual(expect.objectContaining({
      userAgent: '*',
      disallow: expect.arrayContaining(['/app/', '/admin/', '/operator/', '/api/', '/auth/']),
    }))
  })
})
