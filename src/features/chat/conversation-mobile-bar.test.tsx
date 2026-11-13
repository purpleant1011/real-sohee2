import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
const mockBack = vi.fn()
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))
import { ConversationMobileBar } from './conversation-mobile-bar'

const base = { title: '눈썹 포스팅', unreadInboxCount: 3, canCreate: true, directWorkHref: '/app', onNew: vi.fn(), onOpenHistory: vi.fn() }

describe('ConversationMobileBar (한 줄 메뉴)', () => {
  it('한 줄에 뒤로가기·과거 대화·제목·새 대화·더보기를 둔다', () => {
    render(<ConversationMobileBar {...base} />)
    const bar = screen.getByRole('toolbar', { name: '대화 메뉴' })
    expect(bar).toContainElement(screen.getByRole('button', { name: '뒤로' }))
    expect(bar).toContainElement(screen.getByRole('button', { name: '과거 대화' }))
    expect(bar).toContainElement(screen.getByRole('button', { name: '새 대화' }))
    expect(screen.getByText('눈썹 포스팅')).toBeInTheDocument()
    expect(screen.getByText('더보기', { selector: 'summary span' })).toBeInTheDocument()
  })

  it('뒤로가기 클릭 시 router.back 또는 fallback을 호출한다', () => {
    render(<ConversationMobileBar {...base} />)
    const backBtn = screen.getByRole('button', { name: '뒤로' })
    fireEvent.click(backBtn)
    expect(mockBack.mock.calls.length + mockPush.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
  it('문의답변·할 수 있는 일·화면에서 직접·안내는 더보기 메뉴 안으로 들어간다', () => {
    render(<ConversationMobileBar {...base} />)
    expect(screen.getByRole('link', { name: /소희 문의답변/ })).toHaveAttribute('href', '/app/inbox')
    expect(screen.getByRole('link', { name: /할 수 있는 일/ })).toHaveAttribute('href', '/app/conversations/capabilities')
    expect(screen.getByRole('link', { name: /화면에서 직접/ })).toHaveAttribute('href', '/app')
    expect(screen.getByText(/게시·발송은 검토 후 승인/)).toBeInTheDocument()
    expect(document.querySelector('details')?.hasAttribute('open')).toBe(false)
  })
  it('읽지 않은 문의가 있으면 더보기에 점으로 알린다', () => {
    render(<ConversationMobileBar {...base} />)
    expect(screen.getByLabelText('읽지 않은 문의 3건')).toBeInTheDocument()
  })
  it('버튼이 콜백을 부르고, 새 대화 권한이 없으면 새 대화를 숨긴다', () => {
    const onNew = vi.fn(); const onOpenHistory = vi.fn()
    const { rerender } = render(<ConversationMobileBar {...base} onNew={onNew} onOpenHistory={onOpenHistory} />)
    fireEvent.click(screen.getByRole('button', { name: '새 대화' })); fireEvent.click(screen.getByRole('button', { name: '과거 대화' }))
    expect(onNew).toHaveBeenCalledOnce(); expect(onOpenHistory).toHaveBeenCalledOnce()
    rerender(<ConversationMobileBar {...base} canCreate={false} />)
    expect(screen.queryByRole('button', { name: '새 대화' })).toBeNull()
  })
})

describe('ConversationMobileBar 폭', () => {
  it('긴 제목이 있어도 그리드 안에서 화면 폭을 넘지 않도록 최소 폭 제한을 푼다', () => {
    render(<ConversationMobileBar {...base} title={'아주 긴 제목 '.repeat(20)} />)
    const bar = screen.getByRole('toolbar', { name: '대화 메뉴' })
    expect(bar.className).toMatch(/min-w-0/)
    expect(bar.className).toMatch(/max-w-full/)
  })
})
