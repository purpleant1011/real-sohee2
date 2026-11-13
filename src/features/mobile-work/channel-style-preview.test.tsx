import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChannelStylePreview, type ChannelPreviewInput, type PreviewEditorBlock } from './channel-style-preview'

describe('ChannelStylePreview - naver_blog', () => {
  const mediaList = [
    { id: 'img-1', src: '/api/media/1', alt: '첫 번째 사진' },
    { id: 'img-2', src: '/api/media/2', alt: '두 번째 사진' },
  ]

  const baseInput: ChannelPreviewInput = {
    channel: 'naver_blog',
    accountName: '소희네 뷰티샵',
    title: '자연스러운 눈썹 관리법',
    caption: '전체 요약 본문입니다.',
    hashtags: ['#눈썹', '#뷰티'],
    media: mediaList,
  }

  it('editorBlocks가 없을 때 기존 동작: 사진들을 상단에 몰아서 보여주고 본문이 나온다', () => {
    const { container } = render(<ChannelStylePreview {...baseInput} />)

    expect(screen.getByLabelText('네이버 블로그 미리보기')).toBeInTheDocument()
    expect(screen.getByText('소희네 뷰티샵 · 블로그')).toBeInTheDocument()
    expect(screen.getByText('자연스러운 눈썹 관리법')).toBeInTheDocument()
    expect(screen.getByText('전체 요약 본문입니다.')).toBeInTheDocument()
    expect(screen.getByText('#눈썹 #뷰티')).toBeInTheDocument()

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', '/api/media/1')
    expect(images[1]).toHaveAttribute('src', '/api/media/2')

    // DOM 순서 확인: 제목 -> 이미지1 -> 이미지2 -> 본문
    const cardContent = container.querySelector('.space-y-3')
    expect(cardContent).not.toBeNull()
    const children = Array.from(cardContent!.children)
    const img1Index = children.findIndex((el) => el.contains(images[0]))
    const img2Index = children.findIndex((el) => el.contains(images[1]))
    const captionEl = screen.getByText('전체 요약 본문입니다.')
    const captionIndex = children.findIndex((el) => el === captionEl)

    expect(img1Index).toBeLessThan(captionIndex)
    expect(img2Index).toBeLessThan(captionIndex)
  })

  it('editorBlocks가 있으면 [p, i, h, p, i] 순서대로 DOM에 렌더링된다', () => {
    const editorBlocks: readonly PreviewEditorBlock[] = [
      { kind: 'paragraph', text: '첫 번째 문단입니다.' },
      { kind: 'image', mediaId: 'img-1', altText: '첫 번째 시술 사진' },
      { kind: 'heading', text: '중간 소제목' },
      { kind: 'paragraph', text: '두 번째 문단입니다.' },
      { kind: 'image', mediaId: 'img-2', altText: '두 번째 시술 사진' },
    ]

    const { container } = render(<ChannelStylePreview {...baseInput} editorBlocks={editorBlocks} />)

    // 블록 요소들을 순서대로 가져와서 순서 검증
    const blocks = container.querySelectorAll('[data-naver-block]')
    expect(blocks).toHaveLength(5)

    expect(blocks[0]).toHaveAttribute('data-naver-block', 'paragraph')
    expect(blocks[0].textContent).toBe('첫 번째 문단입니다.')

    expect(blocks[1]).toHaveAttribute('data-naver-block', 'image')
    const img1 = blocks[1].querySelector('img')
    expect(img1).toHaveAttribute('src', '/api/media/1')
    expect(img1).toHaveAttribute('alt', '첫 번째 시술 사진')

    expect(blocks[2]).toHaveAttribute('data-naver-block', 'heading')
    expect(blocks[2].textContent).toBe('중간 소제목')

    expect(blocks[3]).toHaveAttribute('data-naver-block', 'paragraph')
    expect(blocks[3].textContent).toBe('두 번째 문단입니다.')

    expect(blocks[4]).toHaveAttribute('data-naver-block', 'image')
    const img2 = blocks[4].querySelector('img')
    expect(img2).toHaveAttribute('src', '/api/media/2')
    expect(img2).toHaveAttribute('alt', '두 번째 시술 사진')

    // editorBlocks가 있을 때는 p.caption 전체 요약 문단이 중복 노출되지 않는다
    expect(screen.queryByText('전체 요약 본문입니다.')).toBeNull()
  })

  it('quote, cta, link, map 블록도 올바르게 렌더링된다 (map은 "지도: 장소명")', () => {
    const editorBlocks: readonly PreviewEditorBlock[] = [
      { kind: 'quote', text: '고객님의 실제 후기입니다.' },
      { kind: 'cta', text: '예약 문의는 네이버 톡톡으로 남겨주세요.' },
      { kind: 'link', url: 'https://example.com/booking', title: '예약 바로가기' },
      { kind: 'map', placeName: '청라 뷰티 스튜디오 본점' },
    ]

    const { container } = render(<ChannelStylePreview {...baseInput} editorBlocks={editorBlocks} />)

    const quoteEl = container.querySelector('[data-naver-block="quote"]')
    expect(quoteEl).not.toBeNull()
    expect(quoteEl?.textContent).toBe('고객님의 실제 후기입니다.')

    const ctaEl = container.querySelector('[data-naver-block="cta"]')
    expect(ctaEl).not.toBeNull()
    expect(ctaEl?.textContent).toBe('예약 문의는 네이버 톡톡으로 남겨주세요.')

    const linkEl = container.querySelector('[data-naver-block="link"]')
    expect(linkEl).not.toBeNull()
    expect(linkEl?.textContent).toBe('예약 바로가기')
    expect(linkEl?.getAttribute('href')).toBe('https://example.com/booking')

    const mapEl = container.querySelector('[data-naver-block="map"]')
    expect(mapEl).not.toBeNull()
    expect(mapEl?.textContent).toBe('지도: 청라 뷰티 스튜디오 본점')
  })

  it('UI 규칙 준수: 12px 미만 클래스(text-[10px], text-[11px] 등)가 없어야 한다', () => {
    const editorBlocks: readonly PreviewEditorBlock[] = [
      { kind: 'heading', text: '소제목' },
      { kind: 'paragraph', text: '본문' },
      { kind: 'image', mediaId: 'img-1', altText: '사진' },
      { kind: 'quote', text: '인용' },
      { kind: 'cta', text: '강조 CTA' },
      { kind: 'link', url: 'https://example.com', title: '링크' },
      { kind: 'map', placeName: '장소명' },
    ]

    const { container } = render(<ChannelStylePreview {...baseInput} editorBlocks={editorBlocks} />)
    const html = container.innerHTML

    expect(html).not.toMatch(/text-\[1[01]px\]/)
    expect(html).not.toMatch(/text-\[[0-9]px\]/)
    expect(html).not.toMatch(/크레딧/)
  })
})
