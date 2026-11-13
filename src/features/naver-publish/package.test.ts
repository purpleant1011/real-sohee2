import { describe, expect, it } from 'vitest'
import { buildNaverPublishPackage, NaverPackageError, recomputeDigest, renderBlocksToHtml, type NaverPublishSource } from './package'

const MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const MEDIA_URLS = { [MEDIA_ID]: 'https://cdn.example.com/m/1.jpg' }

function source(overrides: Partial<NaverPublishSource> = {}): NaverPublishSource {
  return {
    blogId: 'findk3',
    title: ' 가을철 피부관리 ',
    blocks: [
      { kind: 'heading', text: '핵심 3가지' },
      { kind: 'paragraph', text: '첫 문단\n둘째 줄' },
      { kind: 'image', mediaId: MEDIA_ID, altText: '시술 사진' },
      { kind: 'cta', text: '예약 문의' },
    ],
    tags: ['#피부관리', '피부관리', ' 가을 '],
    category: { id: '17', name: '고스트셀러 소개', parentId: '16' },
    visibility: 'public',
    ...overrides,
  }
}

describe('buildNaverPublishPackage', () => {
  it('trims the title, resolves image urls in order and normalizes tags', () => {
    const pkg = buildNaverPublishPackage(source(), MEDIA_URLS)
    expect(pkg.title).toBe('가을철 피부관리')
    expect(pkg.blocks[2]).toEqual({ kind: 'image', mediaId: MEDIA_ID, url: 'https://cdn.example.com/m/1.jpg', altText: '시술 사진' })
    expect(pkg.tags).toEqual(['피부관리', '가을'])
    expect(pkg.category).toEqual({ id: '17', name: '고스트셀러 소개', parentId: '16' })
    expect(pkg.visibility).toBe('public')
  })

  it('produces a stable digest that changes when any approved value changes', () => {
    const base = buildNaverPublishPackage(source(), MEDIA_URLS)
    expect(buildNaverPublishPackage(source(), MEDIA_URLS).digest).toBe(base.digest)
    expect(recomputeDigest(base)).toBe(base.digest)
    expect(buildNaverPublishPackage(source({ visibility: 'private' }), MEDIA_URLS).digest).not.toBe(base.digest)
    expect(buildNaverPublishPackage(source({ category: { id: '18', name: '다른', parentId: '16' } }), MEDIA_URLS).digest).not.toBe(base.digest)
    expect(buildNaverPublishPackage(source({ title: '다른 제목' }), MEDIA_URLS).digest).not.toBe(base.digest)
  })

  it('detects a package altered after the digest was computed', () => {
    const pkg = buildNaverPublishPackage(source(), MEDIA_URLS)
    expect(recomputeDigest({ ...pkg, visibility: 'private' })).not.toBe(pkg.digest)
  })

  it('rejects missing media, non-https urls, empty bodies and bad ids', () => {
    expect(() => buildNaverPublishPackage(source(), {})).toThrowError(NaverPackageError)
    expect(() => buildNaverPublishPackage(source(), { [MEDIA_ID]: 'http://cdn.example/1.jpg' })).toThrowError(/https/)
    expect(() => buildNaverPublishPackage(source({ blocks: [] }), MEDIA_URLS)).toThrowError(/본문/)
    expect(() => buildNaverPublishPackage(source({ blogId: 'a b' }), MEDIA_URLS)).toThrowError(/블로그/)
    expect(() => buildNaverPublishPackage(source({ title: '   ' }), MEDIA_URLS)).toThrowError(/제목/)
    expect(() => buildNaverPublishPackage(source({ category: { id: ' ', name: '', parentId: null } }), MEDIA_URLS)).toThrowError(/카테고리/)
  })

  it('rejects more than 30 distinct tags', () => {
    const tags = Array.from({ length: 31 }, (_, index) => `태그${index}`)
    expect(() => buildNaverPublishPackage(source({ tags }), MEDIA_URLS)).toThrowError(/30개/)
  })
})

describe('renderBlocksToHtml', () => {
  it('renders each block kind in order', () => {
    const pkg = buildNaverPublishPackage(source(), MEDIA_URLS)
    expect(renderBlocksToHtml(pkg.blocks)).toBe(
      '<h2>핵심 3가지</h2><p>첫 문단<br>둘째 줄</p><img src="https://cdn.example.com/m/1.jpg" alt="시술 사진"><p><b>예약 문의</b></p>',
    )
  })

  it('escapes markup in text and attributes', () => {
    const html = renderBlocksToHtml([
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
      { kind: 'image', mediaId: MEDIA_ID, url: 'https://cdn.example.com/m/1.jpg', altText: '"><img onerror=x>' },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('alt="&quot;&gt;&lt;img onerror=x&gt;"')
  })
})
