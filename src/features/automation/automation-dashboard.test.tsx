import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AutomationDashboard } from './automation-dashboard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./actions/manage-automation', () => ({
  saveAutomationRuleAction: vi.fn(),
  runMockAutomationAction: vi.fn(),
}))

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('AutomationDashboard', () => {
  it('shows an actual empty state and makes the mock boundary explicit', () => {
    render(<AutomationDashboard data={{ rules: [] }} role="owner" workspaceId={workspaceId} />)

    expect(screen.getByRole('heading', { name: '자동화' })).toBeInTheDocument()
    expect(screen.getByText('아직 저장된 자동화 규칙이 없습니다.')).toBeInTheDocument()
    expect(screen.getByText(/외부 채널로 아무것도 전송하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '규칙 저장' })).toBeEnabled()
  })

  it('shows the latest mock failure and disables editing for viewers', () => {
    render(
      <AutomationDashboard
        role="viewer"
        workspaceId={workspaceId}
        data={{ rules: [{
          id: '70000000-0000-4000-8000-000000000001',
          kind: 'faq_safe_reply',
          active: true,
          approvalRequired: false,
          updatedAt: '2026-08-09T04:00:00.000Z',
          lastRun: {
            id: '80000000-0000-4000-8000-000000000001',
            status: 'failed',
            mode: 'mock',
            summary: '모의 제공자 연결에 실패했습니다.',
            errorCode: 'mock_provider_unavailable',
            createdAt: '2026-08-09T05:00:00.000Z',
            finishedAt: '2026-08-09T05:00:01.000Z',
          },
        }] }}
      />,
    )

    expect(screen.getByText('모의 실행 실패')).toBeInTheDocument()
    expect(screen.getByText('mock_provider_unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '모의 성공 실행' })).not.toBeInTheDocument()
    expect(screen.getByText(/소유자와 관리자만 규칙을 변경/)).toBeInTheDocument()
  })

  it('labels the old mock dashboard as a legacy V0.7 section when embedded below V0.8 setup', () => {
    render(<AutomationDashboard data={{ rules: [] }} legacy role="owner" workspaceId={workspaceId} />)

    expect(screen.getByRole('heading', { level: 3, name: 'V0.7 이전 모의 자동화' })).toBeInTheDocument()
    expect(screen.getByText('V0.7 mock 전용')).toBeInTheDocument()
  })
})
