import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChannelPreview } from './channel-preview'

const instagram = (caption: string, imageUrls?: readonly string[]) => (
  <ChannelPreview channel="instagram" variant={{ handle: '@가게', caption, hashtags: ['소식', '#동네'], imageUrls }} />
)
const threads = (caption: string) => (
  <ChannelPreview channel="threads" variant={{ handle: '@가게', caption, hashtags: ['소식'] }} />
)

describe('Instagram/Threads channel previews', () => {
  it('keeps a 4:5 carousel in one media slot, exposes dots and supports keyboard-operable navigation', () => {
    render(instagram('새 소식', ['/images/a.jpg', '/images/b.jpg', '/images/c.jpg']))
    const post = screen.getByRole('article', { name: '인스타그램 게시물 미리보기' })
    const media = within(post).getByTestId('instagram-media')
    expect(media).toHaveClass('aspect-[4/5]', 'w-full')
    expect(within(media).getAllByRole('img')).toHaveLength(1)
    expect(within(media).getByRole('img')).toHaveAttribute('src', '/images/a.jpg')
    expect(within(post).getByRole('button', { name: '1번 이미지 보기' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(post).getByRole('button', { name: '다음 이미지' }))
    expect(within(media).getByRole('img')).toHaveAttribute('src', '/images/b.jpg')
    expect(within(post).getByRole('button', { name: '2번 이미지 보기' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(post).getByRole('button', { name: '3번 이미지 보기' }))
    expect(within(media).getByRole('img')).toHaveAttribute('src', '/images/c.jpg')
    expect(within(post).getByRole('button', { name: '다음 이미지' })).toBeDisabled()
  })

  it('keeps a 4:5 placeholder without controls for missing media', () => {
    render(instagram('이미지 없음'))
    const post = screen.getByRole('article', { name: '인스타그램 게시물 미리보기' })
    expect(within(post).getByTestId('instagram-media')).toHaveClass('aspect-[4/5]')
    expect(within(post).getByText('이미지 준비 중')).toBeVisible()
    expect(within(post).queryByRole('button', { name: '다음 이미지' })).toBeNull()
  })

  it('uses the UNVERIFIED 125-codepoint fold threshold and expands without losing hashtags', () => {
    const { rerender } = render(instagram('가'.repeat(125)))
    const post = screen.getByRole('article', { name: '인스타그램 게시물 미리보기' })
    expect(within(post).queryByRole('button', { name: '더 보기' })).toBeNull()
    rerender(instagram('가'.repeat(126)))
    expect(within(post).getByText('가'.repeat(126))).toHaveClass('line-clamp-3', 'break-all')
    expect(within(post).getByText('접힘 기준 미확인')).toBeVisible()
    fireEvent.click(within(post).getByRole('button', { name: '더 보기' }))
    expect(within(post).getByText('가'.repeat(126))).not.toHaveClass('line-clamp-3')
    expect(within(post).getByText('#소식 #동네')).toBeVisible()
    expect(within(post).getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(post).getByRole('button', { name: '접기' }))
    expect(within(post).getByText('가'.repeat(126))).toHaveClass('line-clamp-3')
  })

  it('shows full 2,200 Korean characters without widening the frame', () => {
    render(instagram('가'.repeat(2200)))
    const post = screen.getByRole('article', { name: '인스타그램 게시물 미리보기' })
    expect(within(post).getByText('가'.repeat(2200))).toHaveClass('break-all')
    expect(post).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden')
  })

  it('counts Threads emoji by UTF-8 bytes and shows the 500 limit plus hashtags', () => {
    const { rerender } = render(threads('😀'.repeat(125)))
    const post = screen.getByRole('article', { name: '스레드 게시물 미리보기' })
    expect(within(post).getByText(/504 \/ 500자/)).toBeVisible()
    expect(within(post).getByText('#소식')).toBeVisible()
    rerender(threads('😀'.repeat(126)))
    expect(within(post).getByText(/508 \/ 500자/)).toBeVisible()
  })

  it('includes displayed hashtags in the Threads posting length so 500 plus a tag is not shown as valid', () => {
    render(<ChannelPreview channel="threads" variant={{ handle: '@가게', caption: '가'.repeat(500), hashtags: ['소식'] }} />)
    const post = screen.getByRole('article', { name: '스레드 게시물 미리보기' })
    expect(within(post).getByText(/504 \/ 500자/)).toBeVisible()
  })

  it('does not truncate long unbroken URLs or overflow on either channel', () => {
    const url = `https://example.test/${'a'.repeat(800)}`
    const { rerender } = render(instagram(url))
    expect(screen.getByText(url)).toHaveClass('break-all')
    rerender(threads(url))
    expect(screen.getByText(url)).toHaveClass('break-all')
    expect(screen.getByRole('article', { name: '스레드 게시물 미리보기' })).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden')
  })
})
