'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface PendingDockMessage {
  id: string
  text: string
  workspaceId?: string
}

interface ChatPanelContextValue {
  isOpen: boolean
  pendingMessage: PendingDockMessage | null
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  /** 하단 입력바에서 보낸 글: 패널을 열고 즉시 전송 대기열에 넣는다. */
  sendFromBar: (text: string) => void
  /** 도크가 대기 메시지의 전송을 시작하면 호출한다. id가 일치할 때만 비운다. */
  consumePendingMessage: (id: string) => void
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null)

const DRAWER_SELECTOR = '[data-testid="sohee-chat-drawer"]'

function createMessageId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `pm-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ChatPanelProvider({ children, onOpenConversation, workspaceId }: {
  children: React.ReactNode
  onOpenConversation?: () => void
  workspaceId?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<PendingDockMessage | null>(null)
  const isOpenRef = useRef(false)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const rememberFocus = useCallback(() => {
    if (isOpenRef.current) return
    const active = document.activeElement
    restoreFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null
  }, [])

  const openPanel = useCallback(() => {
    if (onOpenConversation) {
      onOpenConversation()
      return
    }
    rememberFocus()
    isOpenRef.current = true
    setIsOpen(true)
  }, [rememberFocus, onOpenConversation])

  const closePanel = useCallback(() => {
    isOpenRef.current = false
    setIsOpen(false)
    setPendingMessage(null)

    const target = restoreFocusRef.current
    restoreFocusRef.current = null
    if (!target || !document.contains(target)) return

    // 본문에서 작업 중이던 포커스를 빼앗지 않는다: 포커스가 드로어 안이거나 아예 없을 때만 복귀.
    const active = document.activeElement
    const focusLost = !active || active === document.body
    const focusInsideDrawer = active instanceof HTMLElement && active.closest(DRAWER_SELECTOR) !== null
    if (focusLost || focusInsideDrawer) target.focus()
  }, [])

  const togglePanel = useCallback(() => {
    if (isOpenRef.current) closePanel()
    else openPanel()
  }, [closePanel, openPanel])

  const sendFromBar = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (onOpenConversation) {
        setPendingMessage({ id: createMessageId(), text: trimmed, workspaceId })
        onOpenConversation()
        return
      }
      rememberFocus()
      isOpenRef.current = true
      setIsOpen(true)
      setPendingMessage({ id: createMessageId(), text: trimmed })
    },
    [rememberFocus, onOpenConversation, workspaceId],
  )

  const consumePendingMessage = useCallback((id: string) => {
    setPendingMessage((current) => (current?.id === id ? null : current))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openPanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPanel])

  const value = useMemo<ChatPanelContextValue>(
    () => ({
      isOpen,
      pendingMessage,
      openPanel,
      closePanel,
      togglePanel,
      sendFromBar,
      consumePendingMessage,
    }),
    [isOpen, pendingMessage, openPanel, closePanel, togglePanel, sendFromBar, consumePendingMessage],
  )

  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>
}

export function useChatPanel(): ChatPanelContextValue {
  const ctx = useContext(ChatPanelContext)
  if (!ctx) throw new Error('useChatPanel must be used within ChatPanelProvider')
  return ctx
}

export function useOptionalChatPanel(): ChatPanelContextValue | null {
  return useContext(ChatPanelContext)
}
