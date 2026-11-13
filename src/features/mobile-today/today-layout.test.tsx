import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TodayLayout } from './today-layout'
import type { MobileHomeDto } from '@/features/mobile-decision/contracts'
import type { AutonomyController } from '@/features/mobile-today/use-autonomy'

const mockRestoreDecisionPosition = vi.fn()
vi.mock('@/features/mobile-decision/decision-return', () => ({
  useRestoreDecisionPosition: (workspaceId: string, ready: boolean) => mockRestoreDecisionPosition(workspaceId, ready),
}))

const mockR2Active = vi.fn(() => true)
vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => mockR2Active(),
}))

const mockUseAutonomy = vi.fn((workspaceId: string): AutonomyController => {
  void workspaceId
  return {
    state: null,
    load: 'ready' as const,
    errorMessage: '',
    conflict: false,
    refresh: vi.fn(),
    setPaused: vi.fn(),
  }
})
vi.mock('@/features/mobile-today/use-autonomy', () => ({
  useAutonomy: (workspaceId: string) => mockUseAutonomy(workspaceId),
}))

vi.mock('@/features/mobile-today/home-status-pill', () => ({
  HomeStatusPill: ({ autonomyHref }: { controller: AutonomyController; autonomyHref: string }) => (
    <div data-testid="home-status-pill" data-autonomy-href={autonomyHref}>
      상태알약
    </div>
  ),
}))

vi.mock('@/features/mobile-today/decision-hero', () => ({
  DecisionHero: ({ onRefresh }: { view: Pick<MobileHomeDto, 'decisions'>; onRefresh: () => void }) => (
    <section aria-label="필요한 결정" data-testid="decision-hero">
      <button onClick={onRefresh}>결정 새로고침</button>
      지금 확인할 일
    </section>
  ),
}))

vi.mock('@/features/mobile-today/delegate-bar', () => ({
  DelegateBar: ({ onDelegate }: { onDelegate: () => void }) => (
    <div data-testid="delegate-bar">
      <button onClick={onDelegate}>소희에게 일 맡기기</button>
    </div>
  ),
}))

vi.mock('@/components/home-today/magic-photo-dropzone', () => ({
  MagicPhotoDropzone: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="magic-photo-dropzone" data-workspace-id={workspaceId}>
      사진으로 글 만들기
    </div>
  ),
}))

vi.mock('@/features/mobile-today/quick-actions', () => ({
  QuickActions: () => (
    <nav aria-label="바로가기" data-testid="quick-actions">
      바로가기
    </nav>
  ),
}))

vi.mock('@/features/mobile-today/today-activity-card', () => ({
  TodayActivityCard: ({ onRefresh }: { view: Pick<MobileHomeDto, 'activity' | 'results'>; onRefresh: () => void }) => (
    <section aria-label="소희가 한 일" data-testid="today-activity-card">
      <button onClick={onRefresh}>활동 새로고침</button>
      소희가 한 일
    </section>
  ),
}))

const mockView: MobileHomeDto = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  businessName: '맛있는 카페',
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-10-22T07:40:00Z',
  agent: { state: 'ready', data: { label: '대기 중', detailHref: '/app/sohee' }, observedAt: '2026-10-22T07:40:00Z', validUntil: null },
  decisions: { state: 'ready', data: { items: [], total: 0, complete: true }, observedAt: '2026-10-22T07:40:00Z', validUntil: null },
  activity: { state: 'ready', data: [], observedAt: '2026-10-22T07:40:00Z', validUntil: null },
  results: { state: 'ready', data: [], observedAt: '2026-10-22T07:40:00Z', validUntil: null },
}

describe('TodayLayout', () => {
  it('모바일 홈 채널 학습은 가게 정보의 학습 섹션으로 이동한다', () => {
    render(<TodayLayout view={mockView} onRefresh={vi.fn()} onDelegate={vi.fn()} workspaceId={mockView.workspaceId} />)
    expect(screen.getByRole('link', { name: /소희에게 내 채널 가르치기/ })).toHaveAttribute('href', '/app/settings/business#channel-learning')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mockR2Active.mockReturnValue(true)
  })

  it('결정 데이터 준비 여부와 현재 workspace를 복원 훅에 전달한다', () => {
    const pendingView = { ...mockView, decisions: { ...mockView.decisions, data: null } }
    const { rerender } = render(<TodayLayout view={pendingView} onRefresh={vi.fn()} onDelegate={vi.fn()} workspaceId={mockView.workspaceId} />)
    expect(mockRestoreDecisionPosition).toHaveBeenLastCalledWith(mockView.workspaceId, false)

    rerender(<TodayLayout view={mockView} onRefresh={vi.fn()} onDelegate={vi.fn()} workspaceId={mockView.workspaceId} />)
    expect(mockRestoreDecisionPosition).toHaveBeenLastCalledWith(mockView.workspaceId, true)

    const nextView = { ...pendingView, workspaceId: 'next-workspace' }
    rerender(<TodayLayout view={nextView} onRefresh={vi.fn()} onDelegate={vi.fn()} workspaceId={nextView.workspaceId} />)
    expect(mockRestoreDecisionPosition).toHaveBeenLastCalledWith('next-workspace', false)
  })

  it('헤더에 날짜·매장(h1 1개)과 우측 소희 상태 알약을 한 줄로 표시한다', () => {
    render(
      <TodayLayout
        view={mockView}
        onRefresh={vi.fn()}
        onDelegate={vi.fn()}
        workspaceId="00000000-0000-4000-8000-000000000001"
      />
    )

    // 날짜 및 매장명(h1 1개)
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(/10월 22일.*맛있는 카페/)

    // 상태 알약
    expect(screen.getByTestId('home-status-pill')).toBeInTheDocument()
  })

  it('위에서 아래로 올바른 순서로 컴포넌트를 조립한다 (Header -> DecisionHero -> DelegateBar -> MagicPhotoDropzone -> QuickActions -> TodayActivityCard)', () => {
    render(
      <TodayLayout
        view={mockView}
        onRefresh={vi.fn()}
        onDelegate={vi.fn()}
        workspaceId="00000000-0000-4000-8000-000000000001"
      />
    )

    const header = screen.getByRole('banner')
    const decisionHero = screen.getByTestId('decision-hero')
    const delegateBar = screen.getByTestId('delegate-bar')
    const dropzone = screen.getByTestId('magic-photo-dropzone')
    const quickActions = screen.getByTestId('quick-actions')
    const activityCard = screen.getByTestId('today-activity-card')

    expect(header.compareDocumentPosition(decisionHero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(decisionHero.compareDocumentPosition(delegateBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(delegateBar.compareDocumentPosition(dropzone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dropzone.compareDocumentPosition(quickActions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(quickActions.compareDocumentPosition(activityCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('삭제된 요소인 "다음 소식도 소희에게"와 별도 상태 카드가 없어야 한다', () => {
    render(
      <TodayLayout
        view={mockView}
        onRefresh={vi.fn()}
        onDelegate={vi.fn()}
        workspaceId="00000000-0000-4000-8000-000000000001"
      />
    )

    expect(screen.queryByText('다음 소식도 소희에게')).not.toBeInTheDocument()
    expect(screen.queryByText('소희에게 소식 맡기기')).not.toBeInTheDocument()
    expect(screen.queryByText('소희 일하기')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('자율근무 제어')).not.toBeInTheDocument()
  })

  it('R2 활성화 상태에 따라 HomeStatusPill에 올바른 autonomyHref를 전달한다', () => {
    // R2 활성화: /app/account/automation
    mockR2Active.mockReturnValue(true)
    const { rerender } = render(
      <TodayLayout
        view={mockView}
        onRefresh={vi.fn()}
        onDelegate={vi.fn()}
        workspaceId="00000000-0000-4000-8000-000000000001"
      />
    )
    expect(screen.getByTestId('home-status-pill')).toHaveAttribute('data-autonomy-href', '/app/account/automation')

    // R2 비활성화: /app/sohee?tab=work&section=autonomy
    mockR2Active.mockReturnValue(false)
    rerender(
      <TodayLayout
        view={mockView}
        onRefresh={vi.fn()}
        onDelegate={vi.fn()}
        workspaceId="00000000-0000-4000-8000-000000000001"
      />
    )
    expect(screen.getByTestId('home-status-pill')).toHaveAttribute('data-autonomy-href', '/app/sohee?tab=work&section=autonomy')
  })

  it('DelegateBar 클릭 및 새로고침 콜백이 정상적으로 동작한다', () => {
    const onRefresh = vi.fn()
    const onDelegate = vi.fn()

    render(
      <TodayLayout
        view={mockView}
        onRefresh={onRefresh}
        onDelegate={onDelegate}
        workspaceId="test-ws-id"
      />
    )

    fireEvent.click(screen.getByText('소희에게 일 맡기기'))
    expect(onDelegate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('결정 새로고침'))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('활동 새로고침'))
    expect(onRefresh).toHaveBeenCalledTimes(2)

    expect(screen.getByTestId('magic-photo-dropzone')).toHaveAttribute('data-workspace-id', 'test-ws-id')
  })
})
