import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataDeletionGuide, loadDataDeletionPage } from './page'

const workspaceId = '10000000-0000-4000-8000-000000000001'

describe('public data deletion guide', () => {
  it('stays publicly readable when the optional workspace lookup is unavailable', async () => {
    const page = await loadDataDeletionPage(async () => {
      throw new Error('WORKSPACE_CONTEXT_UNAVAILABLE')
    })

    render(page)

    expect(screen.getByRole('heading', { level: 1, name: '사용자 데이터 삭제' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하고 삭제 요청하기' })).toHaveAttribute(
      'href',
      '/login?next=%2Fdata-deletion',
    )
  })

  it('gives unauthenticated visitors a public process and login entry point', () => {
    render(<DataDeletionGuide workspace={null} />)

    expect(screen.getByRole('heading', { level: 1, name: '사용자 데이터 삭제' })).toBeInTheDocument()
    expect(screen.getByText(/자동으로 공식 채널 연결을 해제하거나 저장 자격 증명을 삭제하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/확인 코드는 평문으로 저장하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하고 삭제 요청하기' })).toHaveAttribute(
      'href',
      '/login?next=%2Fdata-deletion',
    )
  })

  it('lets any active member request their own data while reserving workspace deletion for owners', () => {
    const { rerender } = render(<DataDeletionGuide workspace={{ workspaceId, role: 'viewer' }} />)
    const memberForm = screen.getByRole('button', { name: '내 데이터 삭제 요청' }).closest('form')
    expect(memberForm).toHaveAttribute('action', `/api/workspaces/${workspaceId}/data-deletion-requests`)
    expect(memberForm?.querySelector('input[name="scope"]')).toHaveAttribute('value', 'member')
    expect(screen.queryByRole('button', { name: '작업공간 전체 삭제 요청' })).not.toBeInTheDocument()

    rerender(<DataDeletionGuide workspace={{ workspaceId, role: 'owner' }} />)
    const workspaceForm = screen.getByRole('button', { name: '작업공간 전체 삭제 요청' }).closest('form')
    expect(workspaceForm?.querySelector('input[name="scope"]')).toHaveAttribute('value', 'workspace')
  })
})
