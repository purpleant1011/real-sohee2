'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { ChatPanelProvider } from './chat-panel-store'

/** 페이지 셸이 교체되어도 미전송 입력은 현재 작업공간의 레이아웃에 남긴다. */
export function ConversationNavigationProvider({ children, workspaceId: suppliedWorkspaceId }: {
  children: ReactNode
  workspaceId?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const workspace = useOptionalWorkspaceContext()
  const workspaceId = suppliedWorkspaceId || workspace?.workspaceId
  const openConversation = useCallback(() => {
    if (pathname === '/app/conversations' || pathname?.startsWith('/app/conversations/')) {
      const composer = document.querySelector<HTMLTextAreaElement>('[data-conversation-workspace] textarea')
      if (composer) {
        composer.focus()
        return
      }
    }
    router.push('/app/conversations')
  }, [pathname, router])
  return <ChatPanelProvider key={`${workspaceId}:${workspace?.conversationWorkbenchEnabled === true}`} onOpenConversation={workspace?.conversationWorkbenchEnabled === true ? openConversation : undefined} workspaceId={workspaceId}>
    {children}
  </ChatPanelProvider>
}
