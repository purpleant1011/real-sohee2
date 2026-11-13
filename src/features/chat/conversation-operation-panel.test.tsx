import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationOperationPanel } from './conversation-operation-panel'
import { buildConversationOperationCatalog } from './conversation-operation-catalog'
vi.mock('@/components/navigation/app-link', () => ({ AppLink: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }))
const ws = '20000000-0000-4000-8000-000000000001'
const catalog = buildConversationOperationCatalog({ workspaceId: ws, role: 'owner', workbenchEnabled: true,
  agentEnabled: true, modelConfigured: true, connectedChannels: [], observedAt: '2026-10-29T12:00:00Z' })
afterEach(() => vi.unstubAllGlobals())

describe('in-place conversation operation panel', () => {
  it('does not fetch or execute anything before discovery is opened', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: catalog }))
    const onChoose = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<ConversationOperationPanel workspaceId={ws} onChoose={onChoose} />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '소희가 할 수 있는 일 열기' }))
    await screen.findByRole('button', { name: '기획·프로모션 대화에 담기' })
    expect(fetch).toHaveBeenCalledWith(`/api/workspaces/${ws}/conversation-capabilities`, expect.objectContaining({ cache: 'no-store' }))
    expect(onChoose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '기획·프로모션 대화에 담기' }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'marketing-plan' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rejects another workspace response rather than exposing an executable catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { ...catalog, workspaceId: '21000000-0000-4000-8000-000000000001' } })))
    render(<ConversationOperationPanel workspaceId={ws} onChoose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '소희가 할 수 있는 일 열기' }))
    expect(await screen.findByText('업무 준비 상태를 조회하지 못했어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '기획·프로모션 대화에 담기' })).not.toBeInTheDocument()
  })

  it('can inspect available work while a selected draft remains read-only', async () => {
    const onChoose = vi.fn()
    render(<ConversationOperationPanel workspaceId={ws} initialCatalog={catalog} onChoose={onChoose} readOnlyReason="선택한 원고는 읽기 전용 검토 중이에요." />)
    fireEvent.click(screen.getByRole('button', { name: '소희가 할 수 있는 일 열기' }))
    expect(await screen.findByRole('button', { name: '기획·프로모션 대화에 담기' })).toBeDisabled()
    expect(screen.getByText('선택한 원고는 읽기 전용 검토 중이에요.')).toBeInTheDocument()
    expect(onChoose).not.toHaveBeenCalled()
  })
})
