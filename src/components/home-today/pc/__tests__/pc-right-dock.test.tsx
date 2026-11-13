import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PcRightDock } from '../pc-right-dock'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('PcRightDock (PC 3열 관제 화면 — 오른쪽 열 액션 독)', () => {
  it('가게 학습 바로가기는 채널 연결이 아닌 가게 정보로 이동한다', () => {
    render(<PcRightDock workspaceId="ws-1" />)
    expect(screen.getByRole('link', { name: /가게 정보.*공식 SNS 채널 학습/ })).toHaveAttribute('href', '/app/settings/business#channel-learning')
    expect(screen.queryByRole('link', { name: /채널 & 지식 학습/ })).not.toBeInTheDocument()
  })
  it('소희에게 일 맡기기 CTA, 사진으로 글 만들기 CTA, 4대 바로가기를 렌더링한다', () => {
    const handleOpenChat = vi.fn()
    render(<PcRightDock workspaceId="ws-1" onOpenChat={handleOpenChat} />)

    // 1. 소희에게 일 맡기기
    expect(screen.getByText('소희에게 일 맡기기')).toBeInTheDocument()
    const chatCta = screen.getByRole('button', { name: /소희에게 일 맡기기/i })
    fireEvent.click(chatCta)
    expect(handleOpenChat).toHaveBeenCalled()

    // 2. 사진으로 글 만들기 CTA
    expect(screen.getByText('사진으로 글 만들기')).toBeInTheDocument()

    // 3. 바로가기 4종
    expect(screen.getByText('소통함')).toBeInTheDocument()
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
    expect(screen.getByText('예약 일정')).toBeInTheDocument()
    expect(screen.getByText('보관함')).toBeInTheDocument()

    // 링크 확인
    expect(screen.getByRole('link', { name: /소통함/i })).toHaveAttribute('href', '/app/engagement')
    expect(screen.getByRole('link', { name: /승인 대기/i })).toHaveAttribute('href', '/app/approvals')
    expect(screen.getByRole('link', { name: /예약 일정/i })).toHaveAttribute('href', '/app/schedule')
    expect(screen.getByRole('link', { name: /보관함/i })).toHaveAttribute('href', '/app/vault')
  })

  it('좁은 PC(1024px)에서도 바로가기 이름이 한 글자씩 줄바꿈되지 않는다', () => {
    const { container } = render(<PcRightDock workspaceId="ws-1" />)
    const grid = container.querySelector('a[href="/app/engagement"]')?.parentElement as HTMLElement
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('xl:grid-cols-2')
    for (const link of Array.from(grid.querySelectorAll('a'))) {
      const title = link.querySelector('span') as HTMLElement
      expect(title.className).toContain('whitespace-nowrap')
    }
  })
})
