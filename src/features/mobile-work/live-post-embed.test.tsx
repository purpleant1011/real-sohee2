import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LivePostEmbed } from './live-post-embed'
import { getEmbedUrl } from '@/features/social-embed/embed-url'

vi.mock('@/features/social-embed/embed-url', () => ({
  getEmbedUrl: vi.fn(),
}))

describe('LivePostEmbed (모바일 전용)', () => {
  const mockGetEmbedUrl = vi.mocked(getEmbedUrl)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('임베드 URL을 가져올 수 없을 때(null) 기존 외부 링크로 렌더링한다', () => {
    mockGetEmbedUrl.mockReturnValue(null)

    render(
      <LivePostEmbed
        url="https://example.com/posts/123"
        verifiedAt="2026-11-04T05:00:00.000Z"
      />
    )

    const link = screen.getByRole('link', { name: /실제 게시물 보기/ })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://example.com/posts/123')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/확인/)).toBeInTheDocument()
    // iframe은 렌더링되지 않아야 함
    expect(screen.queryByTitle(/게시물 미리 보기/)).not.toBeInTheDocument()
  })

  it('임베드가 가능할 때 기본은 접힌 카드 상태이며 탭하면 iframe을 로드한다', () => {
    mockGetEmbedUrl.mockReturnValue({
      provider: 'instagram',
      src: 'https://www.instagram.com/p/ABC123/embed',
    })

    render(
      <LivePostEmbed
        url="https://www.instagram.com/p/ABC123"
        verifiedAt="2026-11-04T05:00:00.000Z"
      />
    )

    // 기본: 접힌 카드 '게시물 미리 보기'
    const toggleButton = screen.getByRole('button', { name: /게시물 미리 보기/ })
    expect(toggleButton).toBeInTheDocument()
    // 초기에는 iframe이 없음
    expect(screen.queryByTitle(/게시물 미리 보기/)).not.toBeInTheDocument()

    // 탭(클릭)하면 펼쳐지며 iframe 로드
    fireEvent.click(toggleButton)

    const iframe = screen.getByTitle('Instagram 게시물 미리 보기')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('src', 'https://www.instagram.com/p/ABC123/embed')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups')
    expect(iframe).toHaveAttribute('loading', 'lazy')
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('threads 채널 임베드도 정상 동작한다', () => {
    mockGetEmbedUrl.mockReturnValue({
      provider: 'threads',
      src: 'https://www.threads.net/@test/post/XYZ/embed',
    })

    render(
      <LivePostEmbed
        url="https://www.threads.net/@test/post/XYZ"
      />
    )

    const toggleButton = screen.getByRole('button', { name: /게시물 미리 보기/ })
    fireEvent.click(toggleButton)

    const iframe = screen.getByTitle('Threads 게시물 미리 보기')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('src', 'https://www.threads.net/@test/post/XYZ/embed')
  })

  it('크레딧이나 비용 숫자를 노출하지 않는다', () => {
    mockGetEmbedUrl.mockReturnValue({
      provider: 'instagram',
      src: 'https://www.instagram.com/p/ABC123/embed',
    })

    const { container } = render(
      <LivePostEmbed
        url="https://www.instagram.com/p/ABC123"
        verifiedAt="2026-11-04T05:00:00.000Z"
      />
    )

    expect(container.textContent).not.toMatch(/크레딧|\d+C|\d+P|잔여/)
  })
})
