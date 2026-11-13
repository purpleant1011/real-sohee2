import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { evaluateChannelSpec } from '@/features/vault/channel-spec'
import { PreviewFrame } from './preview-frame'

const channels = [
  ['instagram', '인스타그램'],
  ['threads', '스레드'],
  ['naver_blog', '네이버 블로그'],
  ['daangn_business', '당근 비즈니스'],
] as const

describe('PreviewFrame', () => {
  it.each(channels)('always displays a visible disclaimer for %s even when content is unavailable', (channel, name) => {
    render(<PreviewFrame channel={channel} status="coming_soon" />)
    const frame = screen.getByRole('region', { name: `${name} 예상 화면` })
    expect(within(frame).getByText('예상 화면')).toBeVisible()
    expect(within(frame).getByText('실제 게시 화면과 다를 수 있어요.')).toBeVisible()
    expect(within(frame).getByText('준비 중')).toBeVisible()
    expect(within(frame).queryByRole('img')).not.toBeInTheDocument()
  })

  it('prefixes the landmark name with a context label only when a page shows the same channel more than once', () => {
    render(<>
      <PreviewFrame channel="instagram" contextLabel="대표 게시물" status="coming_soon" />
      <PreviewFrame channel="instagram" status="coming_soon" />
    </>)
    expect(screen.getByRole('region', { name: '대표 게시물 · 인스타그램 예상 화면' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '인스타그램 예상 화면' })).toBeInTheDocument()
  })

  it('has a framed content slot without replacing real content or requiring a screen-specific action', () => {
    render(<PreviewFrame channel="threads"><button type="button">본문 더 보기</button></PreviewFrame>)
    const frame = screen.getByRole('region', { name: '스레드 예상 화면' })
    expect(within(frame).getByRole('button', { name: '본문 더 보기' })).toBeEnabled()
    expect(within(frame).getByText('실제 게시 화면과 다를 수 있어요.')).toBeInTheDocument()
  })

  it('keeps the disclaimer legible with semantic foreground tokens in light and dark modes', () => {
    render(<PreviewFrame channel="instagram" />)
    const frame = screen.getByRole('region', { name: '인스타그램 예상 화면' })
    expect(frame).toHaveClass('w-full', 'min-w-0', 'overflow-hidden', 'text-card-foreground')
    expect(screen.getByText('예상 화면')).toHaveClass('text-card-foreground')
    expect(screen.getByText('실제 게시 화면과 다를 수 있어요.')).toHaveClass('text-foreground')
  })

  it('shows only user-facing spec messages without exposing status codes, ids, or a fingerprint', () => {
    const specResult = evaluateChannelSpec('threads', { text: '가'.repeat(501) })
    const { container } = render(<PreviewFrame channel="threads" specResult={specResult}><p>실제 본문</p></PreviewFrame>)
    expect(screen.getByText(/스레드.*초과했어요/)).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/FAIL|PASS|UNKNOWN|threads-text-length|[a-f0-9]{64}/)
  })
})
