import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
const mockBack = vi.fn()
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/conversations',
}))

import { ConversationStartHub } from './conversation-start-hub'
import { ConversationMobileBar } from './conversation-mobile-bar'
import { ConversationComposer } from './conversation-composer'

describe('[M10 재설계 계약] 1. 단일 헤더 및 버튼 44px', () => {
  it('ConversationMobileBar는 뒤로가기, 제목, 오른쪽에 시계·새대화·더보기 3개 아이콘 순서로 배치되고 각 버튼은 44px(size-11) 이상이다', () => {
    const onNew = vi.fn()
    const onOpenHistory = vi.fn()
    render(
      <ConversationMobileBar
        title="소희와의 대화"
        unreadInboxCount={2}
        canCreate={true}
        directWorkHref="/app"
        onNew={onNew}
        onOpenHistory={onOpenHistory}
      />,
    )

    const bar = screen.getByRole('toolbar', { name: '대화 메뉴' })
    const buttons = bar.querySelectorAll('button, summary')

    // 모든 터치 버튼은 최소 44px (size-11 = 2.75rem = 44px)
    buttons.forEach((btn) => {
      expect(btn.className).toMatch(/size-11|min-h-11/)
    })

    // 뒤로가기 버튼
    const backBtn = screen.getByRole('button', { name: '뒤로' })
    expect(backBtn).toBeInTheDocument()

    // 제목
    expect(screen.getByText('소희와의 대화')).toBeInTheDocument()

    // 우측 아이콘 3개: 과거 대화, 새 대화, 더보기
    expect(screen.getByRole('button', { name: '과거 대화' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 대화' })).toBeInTheDocument()
    expect(screen.getByText('더보기', { selector: 'summary span' })).toBeInTheDocument()
  })
})

describe('[M10 재설계 계약] 2. 빠른 선택 칩 가로 잘림 방지 (wrap/grid & 44px)', () => {
  it('모드가 선택된 후에도 칩 컨테이너는 overflow-x-auto 단독 잘림 없이 flex-wrap을 지원하고 칩은 44px 이상이다', () => {
    render(<ConversationStartHub onStart={vi.fn()} />)

    // "포스팅 만들기" 클릭
    fireEvent.click(screen.getByRole('button', { name: /포스팅 만들기/ }))

    // 상단 모드 전환 칩 그룹
    const chipGroup = screen.getByRole('group', { name: '대화 종류' })
    expect(chipGroup.className).toMatch(/flex-wrap/)
    expect(chipGroup.className).not.toMatch(/\boverflow-x-auto\b/)

    // 각 칩 버튼은 whitespace-nowrap과 최소 높이 44px(min-h-11)을 가짐
    const chips = chipGroup.querySelectorAll('button')
    chips.forEach((chip) => {
      expect(chip.className).toMatch(/whitespace-nowrap/)
      expect(chip.className).toMatch(/min-h-11/)
    })
  })
})

describe('[M10 재설계 계약] 3. 입력창 통합 및 선택 요약 Badge', () => {
  it('onSelectionChange가 주어지면 별도의 거대한 "시작하기" 버튼을 렌더링하지 않고 선택 상태를 부모로 알린다', () => {
    const onStart = vi.fn()
    const onSelectionChange = vi.fn()
    render(<ConversationStartHub onStart={onStart} onSelectionChange={onSelectionChange} />)

    // 포스팅 만들기 클릭
    fireEvent.click(screen.getByRole('button', { name: /포스팅 만들기/ }))

    // onSelectionChange가 제공될 때는 내부의 거대한 sticky "시작하기" 버튼이 렌더링되지 않음
    expect(screen.queryByRole('button', { name: '시작하기' })).toBeNull()

    // 부모에게 선택 상태(mode: posting, ready: false 등)를 전달함
    expect(onSelectionChange).toHaveBeenCalled()
  })

  it('ConversationComposer는 selectionBadges를 입력창 위에 표시하고 제거 버튼을 제공한다', () => {
    const onRemove = vi.fn()
    const onSubmit = vi.fn()
    render(
      <ConversationComposer
        onSubmit={onSubmit}
        selectionBadges={[{ id: '1', label: '포스팅 만들기', onRemove }]}
        readyPrompt="포스팅 만들기 시작"
        isReady={true}
      />,
    )

    // 배지가 렌더링됨
    expect(screen.getByText('포스팅 만들기')).toBeInTheDocument()

    // 제거 버튼 클릭 시 콜백 호출
    const removeBtn = screen.getByRole('button', { name: '포스팅 만들기 선택 해제' })
    fireEvent.click(removeBtn)
    expect(onRemove).toHaveBeenCalledOnce()

    // 텍스트를 입력하지 않아도 isReady && readyPrompt로 전송 가능
    const sendBtn = screen.getByRole('button', { name: '메시지 보내기' })
    expect(sendBtn).toBeEnabled()
    fireEvent.click(sendBtn)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ message: '포스팅 만들기 시작' }))
  })

  it('첨부 버튼과 전송 버튼은 44x44px 이상 터치 타깃을 갖는다', () => {
    render(<ConversationComposer onSubmit={vi.fn()} workspaceId="ws-test" />)

    const attachBtn = screen.getByRole('button', { name: '이미지 첨부 열기' })
    const sendBtn = screen.getByRole('button', { name: '메시지 보내기' })

    expect(attachBtn.className).toMatch(/min-h-11|size-11/)
    expect(attachBtn.className).toMatch(/min-w-11|size-11/)
    expect(sendBtn.className).toMatch(/min-h-11|size-11/)
    expect(sendBtn.className).toMatch(/min-w-11|size-11/)
  })
})
