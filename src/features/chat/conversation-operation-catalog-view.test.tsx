import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationOperationCatalogView } from './conversation-operation-catalog-view'
import { buildConversationOperationCatalog } from './conversation-operation-catalog'

vi.mock('@/components/navigation/app-link', () => ({ AppLink: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }))
const input = { workspaceId: '20000000-0000-4000-8000-000000000001', role: 'owner' as const,
  workbenchEnabled: true, agentEnabled: true, modelConfigured: true, connectedChannels: [], observedAt: '2026-10-29T12:00:00Z' }

describe('conversation operation discovery UI', () => {
  it('groups existing work and preserves direct routes without sending anything on render', () => {
    const onSelect = vi.fn()
    render(<ConversationOperationCatalogView catalog={buildConversationOperationCatalog(input)} onSelect={onSelect} />)
    expect(screen.getByRole('heading', { name: '홍보·콘텐츠' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '고객·예약' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '운영·성과' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '네이버 블로그 원고 직접 열기' })).toHaveAttribute('href', '/app/content')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hands the chosen request to the draft owner instead of automatically executing it', () => {
    const onSelect = vi.fn()
    render(<ConversationOperationCatalogView catalog={buildConversationOperationCatalog(input)} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: '기획·프로모션 대화에 담기' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'marketing-plan', prompt: expect.stringContaining('가게 지식') }))
    expect(screen.getByText(/대화에 담아도 자동으로 전송되지 않아요/)).toBeInTheDocument()
  })

  it('disables request actions for viewers and explains their read-only scope', () => {
    render(<ConversationOperationCatalogView catalog={buildConversationOperationCatalog({ ...input, role: 'viewer' })} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: '기획·프로모션 대화에 담기' })).toBeDisabled()
    expect(screen.getByText(/읽기 전용 권한/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '고객·예약 장부 직접 열기' })).toBeInTheDocument()
  })
})
