import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyNaverPostWithResult,
  buildNaverHtmlContent,
  buildNaverPlainTextContent,
  type NaverPostForCopy,
} from './copy-naver-post'

describe('copy-naver-post (네이버 블로그 1초 복사 빠른 길)', () => {
  const samplePost: NaverPostForCopy = {
    title: '강남역 자연눈썹 찐후기',
    introduction: '안녕하세요! 오늘은 강남역에서 자연스러운 눈썹 케어를 소개해 드려요.',
    sections: [
      { heading: '1:1 맞춤 디자인', body: '얼굴형과 골격에 맞춘 섬세한 디자인을 진행합니다.' },
      { heading: '편안한 케어 환경', body: '청결하고 아늑한 공간에서 편안하게 시술받으실 수 있습니다.' },
    ],
    cta: '네이버 예약으로 언제든 편하게 문의해 주세요.',
    keywords: ['강남역속눈썹', '역삼동자연눈썹'],
    imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
  }

  it('buildNaverHtmlContent generates rich HTML with title, paragraphs, images, quote, and tags', () => {
    const html = buildNaverHtmlContent(samplePost)

    expect(html).toContain('<h1>강남역 자연눈썹 찐후기</h1>')
    expect(html).toContain('<p>안녕하세요! 오늘은 강남역에서')
    expect(html).toContain('<img src="https://example.com/img1.jpg" alt="대표 이미지"')
    expect(html).toContain('<h3>1:1 맞춤 디자인</h3>')
    expect(html).toContain('<img src="https://example.com/img2.jpg" alt="본문 이미지 2"')
    expect(html).toContain('<blockquote><p>네이버 예약으로')
    expect(html).toContain('#강남역속눈썹 #역삼동자연눈썹')
  })

  it('buildNaverPlainTextContent creates formatted plain text fallback', () => {
    const text = buildNaverPlainTextContent(samplePost)

    expect(text).toContain('강남역 자연눈썹 찐후기')
    expect(text).toContain('[1:1 맞춤 디자인]')
    expect(text).toContain('#강남역속눈썹 #역삼동자연눈썹')
  })

  it('copies body without duplicating title or tags and preserves line breaks', () => {
    const post = { ...samplePost, introduction: '첫 줄\n둘째 <줄>' }
    const html = buildNaverHtmlContent(post, 'body')
    const text = buildNaverPlainTextContent(post, 'body')
    expect(html).not.toContain('<h1>')
    expect(text).not.toContain(samplePost.title)
    expect(text).not.toContain('#강남역속눈썹')
    expect(html).toContain('첫 줄<br>둘째 &lt;줄&gt;')
    expect(text).toContain('첫 줄\n둘째 <줄>')
    expect(text).toContain(samplePost.cta)
  })

  it('copies title and tags independently without adding body', () => {
    expect(buildNaverPlainTextContent(samplePost, 'title')).toBe('강남역 자연눈썹 찐후기')
    expect(buildNaverPlainTextContent(samplePost, 'tags')).toBe('#강남역속눈썹 #역삼동자연눈썹')
  })

  it('uses all ordered editor blocks instead of the legacy summary, including disclosure', () => {
    const post = { ...samplePost, editorBlocks: [
      { kind: 'heading' as const, text: '최종 소제목' },
      { kind: 'paragraph' as const, text: '전체 본문'.repeat(800) },
      { kind: 'link' as const, url: 'https://example.com/info', title: '안내' },
      { kind: 'map' as const, placeName: '서비스 위치' },
      { kind: 'cta' as const, text: '최종 문의 안내' },
    ], disclosure: 'AI 보조 제작' }
    const text = buildNaverPlainTextContent(post, 'body')
    expect(text).toContain('전체 본문'.repeat(800))
    expect(text).not.toContain(samplePost.introduction)
    expect(text).toContain('안내 (https://example.com/info)')
    expect(text).toContain('서비스 위치')
    expect(text).toContain('최종 문의 안내\n\nAI 보조 제작')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reports text-only fallback instead of claiming photo or rich copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('ClipboardItem', undefined)
    expect(await copyNaverPostWithResult(samplePost)).toBe('text')
    expect(writeText).toHaveBeenCalledWith(buildNaverPlainTextContent(samplePost))
  })

  it('falls back to text when rich clipboard permission is rejected', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockRejectedValue(new Error('denied')), writeText } })
    vi.stubGlobal('ClipboardItem', class {})
    expect(await copyNaverPostWithResult(samplePost, 'all', 'html')).toBe('text')
    expect(writeText).toHaveBeenCalledOnce()
  })

  it('reports failure if all clipboard writes fail', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('generic_error')) } })
    vi.stubGlobal('ClipboardItem', undefined)
    expect(await copyNaverPostWithResult(samplePost)).toBe('failed')
  })

  it('reports clipboard_unavailable when navigator.clipboard is not available', async () => {
    vi.stubGlobal('navigator', {})
    expect(await copyNaverPostWithResult(samplePost)).toBe('clipboard_unavailable')
  })

  it('reports permission_denied when clipboard permission is rejected (NotAllowedError)', async () => {
    const error = new Error('Permission denied')
    error.name = 'NotAllowedError'
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(error) } })
    vi.stubGlobal('ClipboardItem', undefined)
    expect(await copyNaverPostWithResult(samplePost)).toBe('permission_denied')
  })

  it('reports html_unsupported when rich copy requested but html mime type is unsupported', async () => {
    const notSupportedError = new Error('text/html not supported')
    notSupportedError.name = 'NotSupportedError'
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      clipboard: {
        write: vi.fn().mockRejectedValue(notSupportedError),
        writeText,
      },
    })
    vi.stubGlobal('ClipboardItem', class {})
    expect(await copyNaverPostWithResult(samplePost, 'all', 'html')).toBe('html_unsupported')
    expect(writeText).toHaveBeenCalledOnce()
  })

  it('defaults to plain text even when rich clipboard writing is available', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })
    vi.stubGlobal('ClipboardItem', class {})
    expect(await copyNaverPostWithResult(samplePost, 'body')).toBe('text')
    expect(writeText).toHaveBeenCalledWith(buildNaverPlainTextContent(samplePost, 'body'))
    expect(write).not.toHaveBeenCalled()
  })

  it('reports html only after an explicitly requested rich clipboard write succeeds', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('ClipboardItem', class {})
    expect(await copyNaverPostWithResult(samplePost, 'all', 'html')).toBe('html')
    expect(write).toHaveBeenCalledOnce()
  })

})
