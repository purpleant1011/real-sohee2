import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ChatPanelProvider, useChatPanel } from '../chat-panel-store'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatPanelProvider>{children}</ChatPanelProvider>
)

function addDrawerWithInput() {
  const drawer = document.createElement('div')
  drawer.setAttribute('data-testid', 'sohee-chat-drawer')
  const input = document.createElement('input')
  drawer.appendChild(input)
  document.body.appendChild(drawer)
  return input
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('chat-panel-store', () => {
  it('starts closed with no pending message', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.pendingMessage).toBeNull()
  })

  it('opens, closes and toggles', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.openPanel())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.closePanel())
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.togglePanel())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.togglePanel())
    expect(result.current.isOpen).toBe(false)
  })

  it('sendFromBar opens the panel and queues a message with a unique id', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.sendFromBar('이번 주말 신메뉴 글 올려줘'))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.pendingMessage?.text).toBe('이번 주말 신메뉴 글 올려줘')
    const firstId = result.current.pendingMessage?.id
    act(() => result.current.sendFromBar('이번 주말 신메뉴 글 올려줘'))
    expect(result.current.pendingMessage?.id).not.toBe(firstId)
  })

  it('sendFromBar ignores blank text', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.sendFromBar('   '))
    expect(result.current.isOpen).toBe(false)
    expect(result.current.pendingMessage).toBeNull()
  })

  it('consumePendingMessage clears only the matching message', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.sendFromBar('첫 글'))
    const firstId = result.current.pendingMessage!.id
    act(() => result.current.consumePendingMessage('다른-id'))
    expect(result.current.pendingMessage?.id).toBe(firstId)
    act(() => result.current.consumePendingMessage(firstId))
    expect(result.current.pendingMessage).toBeNull()
    expect(result.current.isOpen).toBe(true)
  })

  it('closing clears the pending message', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.sendFromBar('안녕'))
    act(() => result.current.closePanel())
    expect(result.current.pendingMessage).toBeNull()
  })

  it('Cmd+K and Ctrl+K open the panel but never close it', () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    })
    expect(result.current.isOpen).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('restores focus to the opener when closing from inside the drawer', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.openPanel())
    const insideInput = addDrawerWithInput()
    insideInput.focus()
    act(() => result.current.closePanel())
    expect(document.activeElement).toBe(opener)
  })

  it('does not steal focus when the user is working outside the drawer', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { result } = renderHook(() => useChatPanel(), { wrapper })
    act(() => result.current.openPanel())
    const pageInput = document.createElement('input')
    document.body.appendChild(pageInput)
    pageInput.focus()
    act(() => result.current.closePanel())
    expect(document.activeElement).toBe(pageInput)
  })

  it('opens the full conversation without mounting the legacy dock', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useChatPanel(), { wrapper: ({ children }) => (
      <ChatPanelProvider onOpenConversation={navigate} workspaceId="workspace-a">{children}</ChatPanelProvider>
    ) })
    act(() => result.current.openPanel())
    expect(navigate).toHaveBeenCalledOnce()
    expect(result.current.isOpen).toBe(false)
  })

  it('hands bar input to the full conversation as a scoped unsent draft', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useChatPanel(), { wrapper: ({ children }) => (
      <ChatPanelProvider onOpenConversation={navigate} workspaceId="workspace-a">{children}</ChatPanelProvider>
    ) })
    act(() => result.current.sendFromBar('  이번 주 홍보  '))
    expect(result.current.pendingMessage).toEqual(expect.objectContaining({ text: '이번 주 홍보', workspaceId: 'workspace-a' }))
    expect(result.current.isOpen).toBe(false)
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('routes the keyboard shortcut to the canonical conversation', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useChatPanel(), { wrapper: ({ children }) => (
      <ChatPanelProvider onOpenConversation={navigate} workspaceId="workspace-a">{children}</ChatPanelProvider>
    ) })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })))
    expect(navigate).toHaveBeenCalledOnce()
    expect(result.current.isOpen).toBe(false)
  })

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useChatPanel())).toThrow(/ChatPanelProvider/)
  })
})
