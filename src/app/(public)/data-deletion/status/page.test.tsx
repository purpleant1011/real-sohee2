import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataDeletionStatusView } from './page'

const confirmationCode = 'deletion_confirmation_code_123456'

describe('public data deletion status page', () => {
  it('shows the persisted status and a machine-readable lookup without identifiers', () => {
    render(<DataDeletionStatusView confirmationCode={confirmationCode} status={{
      status: 'in_progress',
      origin: 'authenticated',
      scope: 'member',
      provider: null,
      requestedAt: '2026-08-14T01:00:00.000Z',
      updatedAt: '2026-08-14T01:05:00.000Z',
      completedAt: null,
    }} />)

    expect(screen.getByRole('heading', { level: 1, name: '삭제 요청 처리 중' })).toBeInTheDocument()
    expect(screen.getByText('deletion_confirmation_code_123456')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'JSON 상태 보기' })).toHaveAttribute(
      'href',
      `/api/data-deletion/status?code=${confirmationCode}`,
    )
    expect(document.body.textContent).not.toContain('workspace')
  })

  it('does not claim completion for an invalid or unknown code', () => {
    render(<DataDeletionStatusView confirmationCode="unknown_code_which_is_long_enough" status={null} />)

    expect(screen.getByRole('heading', { level: 1, name: '삭제 요청을 찾을 수 없습니다' })).toBeInTheDocument()
    expect(screen.queryByText('삭제 완료')).not.toBeInTheDocument()
  })
})
