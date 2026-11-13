'use client'

import { useState } from 'react'
import { useChatPanel } from '@/features/agent-dock/chat-panel-store'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import type { ConversationOperation, ConversationOperationCatalog } from './conversation-operation-catalog'
import { ConversationOperationCatalogView } from './conversation-operation-catalog-view'

export function ConversationOperationCatalogClient({ catalog }: { catalog: ConversationOperationCatalog }) {
  const panel = useChatPanel()
  const workspace = useOptionalWorkspaceContext()
  const [status, setStatus] = useState('')
  const currentScope = workspace?.workspaceId === catalog.workspaceId
  const choose = (operation: ConversationOperation) => {
    if (!currentScope || catalog.role === 'viewer' || !operation.canAsk) return
    panel.sendFromBar(operation.prompt)
    setStatus('요청을 대화 입력창에 담았어요. 아직 전송하지 않았습니다.')
  }
  return <><ConversationOperationCatalogView catalog={catalog} onSelect={currentScope ? choose : undefined} />
    <p role="status">{currentScope ? status : '가게가 변경됐어요. 현재 가게의 업무 목록을 다시 열어 주세요.'}</p></>
}
