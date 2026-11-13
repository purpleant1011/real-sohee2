import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskProgressList, type ProgressTaskItem } from './task-progress-list'

describe('TaskProgressList', () => {
  const sampleTasks: ProgressTaskItem[] = [
    {
      id: 'task-1',
      title: '매장 정보 및 블로그 키워드 분석',
      detail: '청라 눈썹문신 핵심 키워드 5개 도출',
      status: 'completed',
    },
    {
      id: 'task-2',
      title: '블로그 마케팅 원고 초안 작성',
      detail: '방문 고객 상담 기준과 자연스러운 시술 안내',
      status: 'in_progress',
    },
    {
      id: 'task-3',
      title: '카드뉴스 템플릿 및 이미지 생성',
      status: 'pending',
    },
    {
      id: 'task-4',
      title: '사장님 최종 발행 승인 요청',
      status: 'awaiting_approval',
    },
    {
      id: 'task-5',
      title: '인스타그램 피드 자동 연동 검수',
      detail: 'API 토큰 만료 확인 필요',
      status: 'failed',
    },
  ]

  it('renders header with "소희가 일하고 있어요" and progress count "1/5 완료"', () => {
    render(<TaskProgressList tasks={sampleTasks} />)

    expect(screen.getByText('소희가 일하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('1/5 완료')).toBeInTheDocument()
    // Progress bar exists
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders all tasks in ordered rows with title and optional details', () => {
    render(<TaskProgressList tasks={sampleTasks} />)

    expect(screen.getByText('매장 정보 및 블로그 키워드 분석')).toBeInTheDocument()
    expect(screen.getByText('청라 눈썹문신 핵심 키워드 5개 도출')).toBeInTheDocument()

    expect(screen.getByText('블로그 마케팅 원고 초안 작성')).toBeInTheDocument()
    expect(screen.getByText('방문 고객 상담 기준과 자연스러운 시술 안내')).toBeInTheDocument()

    expect(screen.getByText('카드뉴스 템플릿 및 이미지 생성')).toBeInTheDocument()
    expect(screen.getByText('사장님 최종 발행 승인 요청')).toBeInTheDocument()
    expect(screen.getByText('인스타그램 피드 자동 연동 검수')).toBeInTheDocument()
  })

  it('highlights and expands the in_progress task item', () => {
    const { container } = render(<TaskProgressList tasks={sampleTasks} />)

    const inProgressRow = container.querySelector('[data-task-status="in_progress"]')
    expect(inProgressRow).toBeInTheDocument()
    expect(inProgressRow?.getAttribute('data-active')).toBe('true')
  })

  it('announces current in_progress task via aria-live="polite"', () => {
    render(<TaskProgressList tasks={sampleTasks} />)

    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    expect(liveRegion).toHaveTextContent(/블로그 마케팅 원고 초안 작성/)
  })

  it('announces completion when all tasks are completed', () => {
    const allCompletedTasks: ProgressTaskItem[] = [
      { id: '1', title: 'Task 1', status: 'completed' },
      { id: '2', title: 'Task 2', status: 'completed' },
    ]

    render(<TaskProgressList tasks={allCompletedTasks} />)

    expect(screen.getByText('2/2 완료')).toBeInTheDocument()
    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent(/완료/)
  })

  it('announces failed task when a task failed and none is in progress', () => {
    const failedTasks: ProgressTaskItem[] = [
      { id: '1', title: '가게 정보 확인', status: 'completed' },
      { id: '2', title: '문안 초안 쓰기', status: 'failed' },
      { id: '3', title: '이미지 만들기', status: 'pending' },
    ]
    render(<TaskProgressList tasks={failedTasks} />)

    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent(/확인이 필요한 단계가 있어요: 문안 초안 쓰기/)
  })

  it('renders long task title without clipping using break-words', () => {
    const longTasks: ProgressTaskItem[] = [
      { id: '1', title: '매우긴제목'.repeat(20), status: 'in_progress' },
    ]
    const { container } = render(<TaskProgressList tasks={longTasks} />)
    const titleSpan = container.querySelector('li span.break-words')
    expect(titleSpan).toBeInTheDocument()
  })

  it('handles empty task list gracefully', () => {
    render(<TaskProgressList tasks={[]} />)

    expect(screen.getByText('소희가 일하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('0/0 완료')).toBeInTheDocument()
  })
})
