import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConversationTaskTimeline } from './conversation-task-timeline'
import type { TaskTimelineMessageArtifact } from './stream-events'

const mockArtifact: TaskTimelineMessageArtifact = {
  id: 'timeline-test-1',
  kind: 'task_timeline',
  title: '네이버 블로그 마케팅 작업 계획',
  totalSteps: 3,
  completedSteps: 1,
  steps: [
    { id: 'step-1', title: '매장 승인 사실 및 정책 확인', status: 'completed', durationMs: 420 },
    { id: 'step-2', title: '독자 질문 중심 원고 초안 작성', status: 'in_progress' },
    { id: 'step-3', title: '이미지 슬롯 생성 및 검수', status: 'pending' },
  ],
  isLive: true,
}

describe('ConversationTaskTimeline Component', () => {
  it('distinguishes finished domain steps from an answer still being persisted', () => {
    const complete = { ...mockArtifact, completedSteps: 3, isLive: false,
      steps: mockArtifact.steps.map(step => ({ ...step, status: 'completed' as const })) }
    const { rerender } = render(<ConversationTaskTimeline timeline={complete} messageStatus="streaming" />)
    expect(screen.getByText('응답 마무리 중')).toBeInTheDocument()
    expect(screen.queryByText('3 / 3 완료')).not.toBeInTheDocument()
    rerender(<ConversationTaskTimeline timeline={complete} messageStatus="completed" />)
    expect(screen.getByText('3 / 3 완료')).toBeInTheDocument()
    rerender(<ConversationTaskTimeline timeline={complete} messageStatus="failed" />)
    expect(screen.getByText('결과 확인 필요')).toBeInTheDocument()
  })
  it('renders task list with Claude Code/Dots style icons and step count', () => {
    render(<ConversationTaskTimeline timeline={mockArtifact} />)

    expect(screen.getByText('네이버 블로그 마케팅 작업 계획')).toBeDefined()
    expect(screen.getByText('1 / 3 완료')).toBeDefined()
    expect(screen.getByText('매장 승인 사실 및 정책 확인')).toBeDefined()
    expect(screen.getByText('독자 질문 중심 원고 초안 작성')).toBeDefined()
    expect(screen.getByText('이미지 슬롯 생성 및 검수')).toBeDefined()
  })

  it('can be collapsed and expanded', () => {
    render(<ConversationTaskTimeline timeline={mockArtifact} defaultCollapsed={false} />)

    const toggleButton = screen.getByRole('button', { name: /작업 내역 접기|작업 내역 펼치기/i })
    expect(screen.getByText('독자 질문 중심 원고 초안 작성')).toBeDefined()

    fireEvent.click(toggleButton)
    // When collapsed, detailed step text is hidden
    expect(screen.queryByText('독자 질문 중심 원고 초안 작성')).toBeNull()

    fireEvent.click(toggleButton)
    expect(screen.getByText('독자 질문 중심 원고 초안 작성')).toBeDefined()
  })

  it('renders completed summary pill when all tasks are completed and not live', () => {
    const completedArtifact: TaskTimelineMessageArtifact = {
      ...mockArtifact,
      completedSteps: 3,
      isLive: false,
      steps: mockArtifact.steps.map(s => ({ ...s, status: 'completed' })),
    }

    render(<ConversationTaskTimeline timeline={completedArtifact} defaultCollapsed={true} />)
    expect(screen.getByText('3 / 3 완료')).toBeDefined()
  })
})
