import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentWorkStepTimeline, type WorkStepItem } from './agent-work-step-timeline'

const mockSteps: WorkStepItem[] = [
  { stepIndex: 1, kind: 'step_done', title: '스레드 및 인스타 반응 스캔', detail: '0.5초 소요' },
  { stepIndex: 2, kind: 'step_started', title: '고객 의도 및 감정 분석 중', detail: '매장 지식 대조' },
]

describe('AgentWorkStepTimeline Component', () => {
  it('renders progress steps correctly', () => {
    render(<AgentWorkStepTimeline steps={mockSteps} isRunning />)

    expect(screen.getByText(/스레드 및 인스타 반응 스캔/i)).toBeDefined()
    expect(screen.getByText(/고객 의도 및 감정 분석 중/i)).toBeDefined()
    expect(screen.getByText(/소희가 업무를 수행하고 있어요/i)).toBeDefined()
  })

  it('can be collapsed and expanded with toggle button', () => {
    render(<AgentWorkStepTimeline steps={mockSteps} isRunning={false} />)

    const toggleBtn = screen.getByRole('button', { name: /접기|펼치기/i })
    fireEvent.click(toggleBtn)

    // when collapsed, list is hidden or toggle shows 펼치기
    expect(screen.getByText(/펼치기/i)).toBeDefined()
  })
})
