import type { ComponentProps, ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ChatPanelProvider, useChatPanel } from '@/features/agent-dock/chat-panel-store'
import { ConversationOperationCatalogClient } from './conversation-operation-catalog-client'
import { buildConversationOperationCatalog } from './conversation-operation-catalog'
vi.mock('@/components/navigation/app-link', () => ({ AppLink: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }))
const ws = '20000000-0000-4000-8000-000000000001'
const catalog = buildConversationOperationCatalog({ workspaceId: ws, role: 'owner', workbenchEnabled: true,
  agentEnabled: true, modelConfigured: true, connectedChannels: [], observedAt: '2026-10-29T12:00:00Z' })
function Workspace({ id = ws, children }: { id?: string; children: ReactNode }) {
  return <WorkspaceProvider value={{ workspaceId: id, workspaceName: '테스트 가게', workspaceKind: null,
    membershipRole: 'owner', actorId: 'actor', resolutionSource: 'membership' }}>{children}</WorkspaceProvider>
}
function Pending() { return <output aria-label="미전송 요청">{useChatPanel().pendingMessage?.text ?? ''}</output> }

describe('catalog to persistent conversation draft', () => {
  it('uses the existing pending draft owner and only navigates, never submits a job', () => {
    const navigate = vi.fn()
    render(<Workspace><ChatPanelProvider workspaceId={ws} onOpenConversation={navigate}>
      <Pending /><ConversationOperationCatalogClient catalog={catalog} />
    </ChatPanelProvider></Workspace>)
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '기획·프로모션 대화에 담기' }))
    expect(navigate).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('미전송 요청')).toHaveTextContent('우리 가게 지식')
  })
  it('does not hand a previous workspace catalog into the new workspace', () => {
    const navigate = vi.fn()
    render(<Workspace id="21000000-0000-4000-8000-000000000001"><ChatPanelProvider workspaceId={ws} onOpenConversation={navigate}>
      <ConversationOperationCatalogClient catalog={catalog} />
    </ChatPanelProvider></Workspace>)
    expect(screen.getByRole('button', { name: '기획·프로모션 대화에 담기' })).toBeDisabled()
    expect(screen.getByText(/가게가 변경됐어요/)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })
})
