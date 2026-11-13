import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BusinessSettingsPage from './page'

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: vi.fn(),
}))

vi.mock('@/features/settings/repository', () => ({
  getOperationalSettings: vi.fn(),
}))

vi.mock('@/features/settings/settings-form', () => ({
  BusinessSettingsForm: vi.fn(({ canEdit }: { canEdit: boolean }) => (
    <div data-testid="mock-business-form" data-can-edit={canEdit}>
      비즈니스 폼
    </div>
  )),
}))

vi.mock('@/features/channel-learning/components/channel-learning-panel', () => ({
  ChannelLearningPanel: vi.fn(({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) => (
    <div data-testid="mock-channel-learning-panel" data-workspace-id={workspaceId} data-can-manage={canManage}>
      공식 채널 지식 학습 패널 ({workspaceId}, canManage: {String(canManage)})
    </div>
  )),
}))

import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getOperationalSettings } from '@/features/settings/repository'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BusinessSettingsPage - 가게 정보 메뉴의 공식 채널 지식 학습 통합', () => {
  const workspaceId = 'ws-business-learning-789'

  it('매장 관리자(canEditProfiles: true)인 경우 가게 정보 하단에 채널 학습 패널이 canManage=true로 렌더링된다', async () => {
    vi.mocked(getCurrentWorkspaceContext).mockResolvedValue({
      workspaceId,
      role: 'owner',
      workspaceName: '행복한 베이커리',
      userRole: 'owner',
    } as any)

    vi.mocked(getOperationalSettings).mockResolvedValue({
      error: undefined,
      data: {
        permissions: {
          canEditProfiles: true,
          canManageAutomation: true,
          canManageBilling: true,
          canViewAuditLogs: true,
        },
        business: {
          businessName: '행복한 베이커리',
          industry: '베이커리/디저트',
          location: '서울 마포구',
          summary: '따뜻한 빵을 굽는 가게입니다.',
        },
      } as any,
    })

    const pageElement = await BusinessSettingsPage()
    render(pageElement)

    // 기본 가게 정보 헤더 및 폼 검증
    expect(screen.getByText('가게 기본 정보')).toBeInTheDocument()
    expect(screen.getByTestId('mock-business-form')).toHaveAttribute('data-can-edit', 'true')

    // 소희에게 내 채널 가르치기 섹션 헤딩 및 설명 검증
    const sectionHeading = screen.getByRole('heading', { name: '소희에게 내 채널 가르치기' })
    expect(sectionHeading).toBeInTheDocument()
    expect(
      screen.getByText(/운영하시는 공식 채널\(인스타그램 등\) 주소를 등록하시면, 소희가 매장 정보·메뉴와 가격·말투·사진 스타일을 안전하게 학습하여/),
    ).toBeInTheDocument()

    // ChannelLearningPanel 권한 및 workspaceId 검증
    const panel = screen.getByTestId('mock-channel-learning-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-workspace-id', workspaceId)
    expect(panel).toHaveAttribute('data-can-manage', 'true')
  })

  it('읽기 전용 사용자(canEditProfiles: false)인 경우 canManage=false로 권한이 보존된다', async () => {
    vi.mocked(getCurrentWorkspaceContext).mockResolvedValue({
      workspaceId,
      role: 'reviewer',
      workspaceName: '행복한 베이커리',
      userRole: 'reviewer',
    } as any)

    vi.mocked(getOperationalSettings).mockResolvedValue({
      error: undefined,
      data: {
        permissions: {
          canEditProfiles: false,
          canManageAutomation: false,
          canManageBilling: false,
          canViewAuditLogs: false,
        },
        business: {
          businessName: '행복한 베이커리',
          industry: '베이커리/디저트',
          location: '서울 마포구',
          summary: '따뜻한 빵을 굽는 가게입니다.',
        },
      } as any,
    })

    const pageElement = await BusinessSettingsPage()
    render(pageElement)

    const panel = screen.getByTestId('mock-channel-learning-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-workspace-id', workspaceId)
    expect(panel).toHaveAttribute('data-can-manage', 'false')
  })

  it('워크스페이스 정보가 없는 경우 채널 학습 패널이 렌더링되지 않는다', async () => {
    vi.mocked(getCurrentWorkspaceContext).mockResolvedValue(null)

    const pageElement = await BusinessSettingsPage()
    render(pageElement)

    expect(screen.queryByTestId('mock-channel-learning-panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '소희에게 내 채널 가르치기' })).not.toBeInTheDocument()
  })

  it('운영 설정 로딩 실패 시 에러 알림이 표시되고 학습 패널은 렌더링되지 않는다', async () => {
    vi.mocked(getCurrentWorkspaceContext).mockResolvedValue({
      workspaceId,
      role: 'owner',
      workspaceName: '행복한 베이커리',
      userRole: 'owner',
    } as any)

    vi.mocked(getOperationalSettings).mockResolvedValue({
      error: new Error('DB Read Error'),
      data: null as any,
    })

    const pageElement = await BusinessSettingsPage()
    render(pageElement)

    expect(screen.getByRole('alert')).toHaveTextContent('운영 설정을 열지 못했어요')
    expect(screen.queryByTestId('mock-channel-learning-panel')).not.toBeInTheDocument()
  })
})
