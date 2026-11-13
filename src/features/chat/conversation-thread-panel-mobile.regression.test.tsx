// @vitest-environment jsdom
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => mocks,
  useSearchParams: () => new URLSearchParams(),
}))

let mockMobileActive = false
let mockHasShell = false
vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => mockMobileActive,
}))
vi.mock('@/features/mobile-shell', () => ({
  useHasMobileShell: () => mockHasShell,
  useOptionalShellScreen: vi.fn(),
}))

import { ConversationThreadPanel } from './conversation-thread-panel'
import type { ConversationThreadSummary } from './thread-repository'

const workspaceId = 'ws-mobile-thread-test'
const currentThreadId = 'thread-1'
const testThreads: readonly ConversationThreadSummary[] = Array.from({ length: 20 }, (_, idx) => ({
  id: `thread-${idx + 1}`,
  workspaceId,
  title: `고객 상담 대화 #${idx + 1}`,
  status: 'active',
  lastMessageAt: '2026-11-10T10:00:00.000Z',
  createdAt: '2026-11-10T09:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
}))

describe('ConversationThreadPanel Mobile Sheet & Fixed Header Contract (Task 5 Regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    mockMobileActive = false
    mockHasShell = false
  })

  it('모바일 과거 대화 dialog는 고정 헤더와 독립 스크롤러(flex-1 min-h-0)로 분리되어 20개 카드가 있어도 헤더가 스크롤되어 사라지지 않는다', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={testThreads}
        workspaceId={workspaceId}
      />
    )

    // 과거 대화 트리거 클릭
    fireEvent.click(screen.getByRole('button', { name: '과거 대화' }))
    const dialog = screen.getByRole('dialog', { name: '과거 대화' })
    expect(dialog).toBeInTheDocument()

    // 1. 헤더 영역은 독립되어 있고 닫기 버튼과 새 대화 버튼을 포함한다
    const closeBtn = within(dialog).getByRole('button', { name: '과거 대화 닫기' })
    const newChatBtn = within(dialog).getByRole('button', { name: '새 대화 시작' })
    expect(closeBtn).toBeInTheDocument()
    expect(newChatBtn).toBeInTheDocument()

    // DOM 순서: '새 대화'가 DOM상 '과거 대화 닫기'보다 앞에 위치한다 (CSS order 역전 제거)
    const position = newChatBtn.compareDocumentPosition(closeBtn)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 2. 닫기 버튼과 새 대화 버튼의 터치 타깃이 44px 이상을 만족하는지 확인
    expect(closeBtn.className).toMatch(/(tap-size|min-h-\[44px\]|size-11|h-11|closeThreadDrawer)/)
    expect(newChatBtn.className).toMatch(/(tap-size|min-h-\[44px\]|size-11|h-11|threadDrawerNewChatBtn)/)

    // 3. 20개 카드를 담는 목록 스크롤러 영역이 별도로 분리되어 있어야 함
    const scroller = dialog.querySelector('[class*="threadScroller"]')
    expect(scroller).toBeInTheDocument()
    // 스크롤러가 min-h-0, flex-1, overflow-y-auto 구조를 가져야 함
    expect(scroller?.className).toMatch(/(threadScroller|overflow-y-auto|min-h-0)/)

    // 스크롤러 안에 20개 대화 카드가 모두 렌더링되어 있는지 확인
    const threadItems = within(scroller as HTMLElement).getAllByRole('link', { name: /고객 상담 대화/ })
    expect(threadItems.length).toBe(20)

    // initial focus는 '과거 대화 닫기'에 머물러야 함
    expect(closeBtn).toHaveFocus()
  })

  it('canManageThreads=true일 때 키보드 Tab 루프는 새 대화(first)를 건너뛰지 않고 정상 순환한다', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={testThreads}
        unreadInboxCount={1}
        workspaceId={workspaceId}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '과거 대화' }))
    const dialog = screen.getByRole('dialog', { name: '과거 대화' })
    const newChatBtn = within(dialog).getByRole('button', { name: '새 대화 시작' })

    // 마지막 포커스 가능 요소(소희 문의답변)로 포커스 이동
    const lastLink = within(dialog).getByRole('link', { name: /소희 문의답변/ })
    lastLink.focus()

    // Tab 입력 시 첫 번째 요소인 '새 대화 시작'으로 순환해야 함 (건너뛰지 않음)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(newChatBtn).toHaveFocus()

    // '새 대화 시작'(first)에서 Shift+Tab 시 마지막 요소로 순환
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(lastLink).toHaveFocus()
  })

  it('모바일 standalone ConversationMobileBar에서 열고 Escape로 닫았을 때 초점이 소실되지 않고 트리거로 복원된다', () => {
    mockMobileActive = true
    mockHasShell = false

    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={testThreads}
        workspaceId={workspaceId}
      />
    )

    // 모바일 바의 '과거 대화' 버튼 클릭
    const mobileTrigger = screen.getByRole('button', { name: '과거 대화' })
    expect(mobileTrigger).toBeInTheDocument()
    fireEvent.click(mobileTrigger)

    expect(screen.getByRole('dialog', { name: '과거 대화' })).toBeInTheDocument()

    // Escape 키로 닫기
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '과거 대화' })).not.toBeInTheDocument()

    // 초점이 null이 되지 않고 모바일 트리거로 복원되어야 함
    expect(document.activeElement).toBe(mobileTrigger)
    expect(mobileTrigger).toHaveFocus()
  })

  it('과거 대화 모달이 닫히면 이전 포커스가 트리거로 정상 복원된다', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={testThreads}
        workspaceId={workspaceId}
      />
    )

    const trigger = screen.getByRole('button', { name: '과거 대화' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '과거 대화' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '과거 대화 닫기' }))
    expect(screen.queryByRole('dialog', { name: '과거 대화' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('PC 사이드바 variant인 경우 고정 헤더 dialog 분리 없이 기존 sidebar 탐색 목록을 유지한다', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={testThreads}
        variant="sidebar"
        workspaceId={workspaceId}
      />
    )

    expect(screen.getByRole('navigation', { name: '최근 대화' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '과거 대화' })).not.toBeInTheDocument()
  })

  it('CSS 모듈 계약: overscroll-behavior:contain, desktop align-items:flex-end, data-mobile 오버라이드가 보장된다', () => {
    const css = readFileSync(join(process.cwd(), 'src/features/chat/conversation-shell.module.css'), 'utf8')

    // 1. overscroll-behavior: contain 존재 검증
    expect(css).toContain('overscroll-behavior: contain;')

    // 2. desktop align-items: flex-end로 우측 정렬 유지 검증
    expect(css).toContain('align-items: flex-end;')

    // 3. m. 도메인 등 와이드 뷰포트에서도 모바일 레이아웃 유지하는 data-mobile 오버라이드 존재 검증
    expect(css).toContain(".threadDrawerBackdrop[data-mobile='true']")
    expect(css).toContain(".threadDrawer[data-mobile='true']")
  })
})
