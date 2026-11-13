import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { evaluateChannelSpec } from '@/features/vault/channel-spec'
import type { TransformedVariantResult } from '@/features/vault/transform/types'
import { channelPreviewAdapters } from '../channel-preview-adapters'
import { NaverBlogPreview, type NaverBlogVariant } from './naver-blog-preview'

const base: NaverBlogVariant = { title: '실제 제목', text: '실제 본문', media: [] }

// The transform's payload must be usable without a second conversion or fabricated fields.
const acceptsVaultPayload = (payload: TransformedVariantResult['payload']) =>
  channelPreviewAdapters.naver_blog.render(payload)
void acceptsVaultPayload

describe('NaverBlogPreview', () => {
  it('replaces the registry slot with a real ordered article inside the frame', () => {
    const variant: NaverBlogVariant = {
      ...base,
      blocks: [
        { type: 'heading', text: '소제목' },
        { type: 'paragraph', text: '첫 문단' },
        { type: 'image', mediaId: 'first' },
        { type: 'paragraph', text: '마지막 문단' },
      ],
      media: [{ id: 'first', type: 'image', src: '/real-image.jpg', altText: '직접 등록한 이미지' }],
      hashtags: ['#첫태그', '두번째'],
      category: '직접 고른 카테고리',
      visibility: 'private',
    }
    const slot = channelPreviewAdapters.naver_blog.render(variant)
    expect(slot.status).toBe('ready')
    render(slot.content)
    const article = screen.getByRole('article', { name: '네이버 블로그 글 미리보기' })
    expect(within(article).getByRole('heading', { name: '실제 제목' })).toBeInTheDocument()
    const flow = within(article).getByLabelText('본문 블록')
    expect([...flow.children].map((node) => node.textContent)).toEqual(['소제목', '첫 문단', '', '마지막 문단'])
    expect(within(flow).getByRole('img', { name: '직접 등록한 이미지' })).toHaveAttribute('src', '/real-image.jpg')
    expect(within(article).getByText('#첫태그')).toBeInTheDocument()
    expect(within(article).getByText('#두번째')).toBeInTheDocument()
    expect(within(article).getByText('직접 고른 카테고리')).toBeInTheDocument()
    expect(within(article).getByText('비공개')).toBeInTheDocument()
  })

  it('keeps long titles, URLs and 50 blocks untruncated, with wrap classes for narrow screens', () => {
    const long = '긴제목'.repeat(300)
    const url = `https://example.org/${'long'.repeat(300)}`
    const { container } = render(<NaverBlogPreview variant={{
      ...base, title: long,
      blocks: Array.from({ length: 49 }, (_, index) => ({ type: 'paragraph' as const, text: `문단 ${index}` })).concat([{ type: 'paragraph', text: url }]),
    }} />)
    expect(screen.getByRole('heading', { name: long })).toBeInTheDocument()
    expect(screen.getByLabelText('본문 블록').children).toHaveLength(50)
    expect(screen.getByText(url)).toBeInTheDocument()
    expect(container.querySelector('article')).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden')
    expect(screen.getByRole('heading', { name: long })).toHaveClass('wrap-anywhere')
    expect(screen.getByText(url)).toHaveClass('wrap-anywhere')
  })

  it('shows no invented images and never claims an absent setting is public', () => {
    render(<NaverBlogPreview variant={base} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('실제 본문')).toBeInTheDocument()
    expect(screen.getAllByText('확인이 필요해요', { selector: 'span' })).toHaveLength(2)
    expect(screen.queryByText('공개')).not.toBeInTheDocument()
  })

  it('labels CONFIG and UNVERIFIED checks as needing confirmation even when they pass', () => {
    const specResult = evaluateChannelSpec('naver_blog', base)
    render(<NaverBlogPreview variant={base} specResult={specResult} />)
    const spec = screen.getByRole('region', { name: '게시 규격 확인 안내' })
    expect(within(spec).getAllByText('확인이 필요해요')).toHaveLength(specResult.checks.length)
    expect(within(spec).getByText(/대표 이미지가 최소 1장/)).toBeInTheDocument()
    expect(within(spec).queryByText('규격 적합')).not.toBeInTheDocument()
  })
})
