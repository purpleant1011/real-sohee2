'use client'

import { useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { ConversationShell } from '@/features/chat/conversation-shell'
import { ConversationThreadPanel } from '@/features/chat/conversation-thread-panel'
import type { ConversationMessage } from '@/features/chat/types'

const INITIAL_THREADS = [
  {
    id: 'thread-1',
    workspaceId: 'ws-demo',
    title: '소희와의 대화',
    lastMessageAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active' as const,
  },
]

export function MobileChatRedesignPreview() {
  const [messages, setMessages] = useState<ConversationMessage[]>([])

  const handleSubmit = (submission: { message: string }) => {
    const userMsg: ConversationMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: submission.message,
      createdAt: new Date().toISOString(),
      status: 'completed',
      workItemId: null,
      workspaceId: 'ws-demo',
      threadId: 'thread-1',
      completedAt: new Date().toISOString(),
    }
    const soheeMsg: ConversationMessage = {
      id: `msg-${Date.now()}-sohee`,
      role: 'sohee',
      content: `"${submission.message}" 작업을 접수했어요. 바로 초안을 준비해 드릴게요.`,
      createdAt: new Date().toISOString(),
      status: 'completed',
      workItemId: null,
      workspaceId: 'ws-demo',
      threadId: 'thread-1',
      completedAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg, soheeMsg])
    return true
  }

  return (
    <MobileR2Provider enabled forceMobile>
      <MobileAppShell>
        <ShellScreen mode="CHAT" title="소희와의 대화">
          <div className="flex flex-col min-h-full">
            <ConversationThreadPanel
              workspaceId="ws-demo"
              currentThreadId="thread-1"
              initialThreads={INITIAL_THREADS}
              hasMore={false}
              canManageThreads={true}
              unreadInboxCount={2}
              directWorkHref="/app"
            />
            <ConversationShell
              messages={messages}
              onSubmit={handleSubmit}
              connectionState="connected"
              workspaceId="ws-demo"
              directWorkHref="/app"
            />
          </div>
        </ShellScreen>
      </MobileAppShell>
    </MobileR2Provider>
  )
}
