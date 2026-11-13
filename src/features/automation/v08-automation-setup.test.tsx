import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ saveV08AutomationAction: vi.fn() }))

vi.mock('./actions/save-v08-automation', () => ({ saveV08AutomationAction: mocks.saveV08AutomationAction }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { V08AutomationSetup } from './v08-automation-setup'

describe('V08AutomationSetup', () => {
  it('exposes daily, twice-daily, and weekly report configuration with safe caps and five channel choices', () => {
    render(<V08AutomationSetup canManage workspaceId="10000000-0000-4000-8000-000000000001" />)

    expect(screen.getByRole('heading', { name: 'V0.8 보고 자동화 설정' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '매일 성과 보고' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '하루 두 번 성과 보고' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '주간 다음 계획 제안' })).toBeInTheDocument()
    expect(screen.getByLabelText('시간대')).toHaveValue('Asia/Seoul')
    expect(screen.getByLabelText('조용한 시간 시작')).toHaveValue('22:00')
    expect(screen.getByLabelText('조용한 시간 종료')).toHaveValue('07:00')
    for (const label of ['인스타그램', '스레드', '네이버 블로그', '네이버 플레이스', '당근 비즈프로필']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText('저장 전 비활성 · 모든 실행은 사람 승인과 report-only 경계를 유지합니다.')).toBeInTheDocument()
  })

  it('saves the setup as an inactive, approval-required V0.8 rule', async () => {
    mocks.saveV08AutomationAction.mockResolvedValue({ data: { status: 'saved' } })
    render(<V08AutomationSetup canManage workspaceId="10000000-0000-4000-8000-000000000001" />)

    fireEvent.click(screen.getByRole('button', { name: 'V0.8 규칙 저장' }))

    await waitFor(() => expect(mocks.saveV08AutomationAction).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'save', configuration: expect.objectContaining({ active: false, approvalRequired: true, timezone: 'Asia/Seoul' }),
    })))
    expect(await screen.findByText('V0.8 규칙을 비활성 상태로 저장했습니다.')).toBeVisible()
  })

  it('does not expose a V0.8 save control or call the insert boundary for a reviewer', () => {
    mocks.saveV08AutomationAction.mockClear()
    render(<V08AutomationSetup canManage={false} workspaceId="10000000-0000-4000-8000-000000000001" />)

    expect(screen.getByText('소유자와 관리자만 V0.8 자동화 설정을 저장할 수 있습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'V0.8 규칙 저장' })).not.toBeInTheDocument()
    expect(mocks.saveV08AutomationAction).not.toHaveBeenCalled()
  })
})
