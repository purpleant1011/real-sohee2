import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import type { TaskTimelineMessageArtifact } from './stream-events'
import type { ConversationMessage } from './types'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/conversations',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/features/content/actions/save-artifact-to-work', () => ({ saveArtifactToWork: vi.fn() }))
vi.mock('./actions/load-conversation-publishing', () => ({ loadConversationPublishingAction: vi.fn() }))
vi.mock('./actions/partial-content-revision', () => ({ partialContentRevisionAction: vi.fn() }))
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))

import { ConversationShell } from './conversation-shell'

describe('ConversationShell 모바일 환경의 실시간 작업 진행 목록 (task-progress-live)', () => {
  const sampleTimeline: TaskTimelineMessageArtifact = {
    id: 'timeline-live-1',
    kind: 'task_timeline',
    title: '소희의 작업 계획',
    totalSteps: 4,
    completedSteps: 3,
    isLive: true,
    steps: [
      { id: 's1', title: '가게 정보 확인', status: 'completed' },
      { id: 's2', title: '문안 초안 쓰기', status: 'completed' },
      { id: 's3', title: '이미지 만들기', status: 'completed' },
      { id: 's4', title: '저장', status: 'in_progress' },
    ],
  }

  const assistantMessage: ConversationMessage = {
    id: 'msg-assistant-1',
    workspaceId: 'ws-test-1',
    threadId: 'th-test-1',
    role: 'sohee',
    content: '사장님을 위한 원고와 이미지를 작업하고 있어요.',
    status: 'streaming',
    workItemId: null,
    createdAt: '2026-11-03T00:00:00Z',
    completedAt: null,
  }

  it('renders synthetic live timeline inside mobile ConversationShell with "3/4 완료" and aria-live announcement', () => {
    render(
      <MobileR2Provider enabled forceMobile>
        <ConversationShell
          workspaceId="ws-test-1"
          directWorkHref="/app"
          messages={[assistantMessage]}
          messageDetails={{
            [assistantMessage.id]: {
              evidence: [],
              artifacts: [sampleTimeline],
            },
          }}
        />
      </MobileR2Provider>,
    )

    // 1) List header & items are rendered
    expect(screen.getByText('소희가 일하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('가게 정보 확인')).toBeInTheDocument()
    expect(screen.getByText('문안 초안 쓰기')).toBeInTheDocument()
    expect(screen.getByText('이미지 만들기')).toBeInTheDocument()
    expect(screen.getByText('저장')).toBeInTheDocument()

    // 2) '3/4 완료'-style count
    expect(screen.getByText('3/4 완료')).toBeInTheDocument()

    // 3) aria-live announcement region
    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    expect(liveRegion).toHaveTextContent('소희가 현재 작업 중이에요: 저장')
  })
})
