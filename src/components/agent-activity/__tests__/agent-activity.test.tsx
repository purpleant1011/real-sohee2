import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentActivityTimeline } from '../agent-activity-timeline'
import { AgentReasonSummary } from '../agent-reason-summary'
import { AgentArtifactPlanCard } from '../agent-artifact-plan-card'
import {
  projectActivityEvent,
  type AgentActivityEvent,
} from '@/features/agent-activity/activity-event'
import type { PlanCardData } from '@/lib/agent-os/agent-orchestrator'

const baseEvent: AgentActivityEvent = {
  event_id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  mission_id: '33333333-3333-4333-8333-333333333333',
  run_id: '44444444-4444-4444-8444-444444444444',
  step_id: '1',
  sequence: 1,
  observed_at: '2026-10-27T10:00:00.000Z',
  kind: 'tool_read_verified',
  lifecycle: 'verified',
  user_visible_summary: '도구의 정보 조회가 확인되었습니다.',
  sensitivity_level: 'public',
  simulated: false,
}

describe('projectActivityEvent privacy & copy enforcement', () => {
  it('strictly locks user_visible_summary to fixed COPY and discards telephone numbers, raw summaries, and CoT', () => {
    const leakedInput = {
      event_id: '11111111-1111-4111-8111-111111111111',
      workspace_id: '22222222-2222-4222-8222-222222222222',
      run_id: '44444444-4444-4444-8444-444444444444',
      sequence: 1,
      observed_at: '2026-10-27T10:00:00.000Z',
      kind: 'tool_read_verified',
      user_visible_summary: '고객 전화번호 010-9876-5432를 조회했습니다.',
      chain_of_thought: 'Thought: Let us leak internal reasoning here...',
      simulated: false,
    }

    const projected = projectActivityEvent(leakedInput)
    expect(projected).not.toBeNull()
    // Must be fixed Korean COPY, not the leaked raw text
    expect(projected?.user_visible_summary).toBe('도구의 정보 조회가 확인되었습니다.')
    expect(projected).not.toHaveProperty('chain_of_thought')
    expect(JSON.stringify(projected)).not.toContain('010-9876-5432')
    expect(JSON.stringify(projected)).not.toContain('Thought')
  })
})

describe('AgentActivityTimeline', () => {
  it('no-events: returns null when empty', () => {
    const { container } = render(<AgentActivityTimeline events={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders events and toggles disclosure on click with aria-expanded', () => {
    const events: AgentActivityEvent[] = [
      baseEvent,
      {
        ...baseEvent,
        event_id: '55555555-5555-4555-8555-555555555555',
        sequence: 2,
        kind: 'externally_verified',
        user_visible_summary: '외부 서비스의 독립 조회로 실행 결과를 확인했습니다.',
      },
    ]

    render(<AgentActivityTimeline events={events} />)

    const toggleButton = screen.getByRole('button', { expanded: true })
    expect(toggleButton).toHaveTextContent(/활동 · 2건/)
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.')).toBeInTheDocument()

    // Click to collapse
    fireEvent.click(toggleButton)
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('도구의 정보 조회가 확인되었습니다.')).not.toBeInTheDocument()

    // Click to expand again
    fireEvent.click(toggleButton)
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.')).toBeInTheDocument()
  })

  it('handles failed / unknown / blocked states with warning indication and preserves previous verified events', () => {
    const events: AgentActivityEvent[] = [
      baseEvent,
      {
        ...baseEvent,
        event_id: '66666666-6666-4666-8666-666666666666',
        sequence: 2,
        kind: 'tool_read_failed',
        lifecycle: 'failed',
        user_visible_summary: '도구 실행을 완료하지 못했습니다.',
      },
      {
        ...baseEvent,
        event_id: '77777777-7777-4777-8777-777777777777',
        sequence: 3,
        kind: 'result_unknown',
        lifecycle: 'result_unknown',
        user_visible_summary: '실행 결과를 아직 확인하지 못했습니다.',
      },
    ]

    render(<AgentActivityTimeline events={events} />)
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.')).toBeInTheDocument()
    expect(screen.getByText('도구 실행을 완료하지 못했습니다.')).toBeInTheDocument()
    expect(screen.getByText('실행 결과를 아직 확인하지 못했습니다.')).toBeInTheDocument()
  })

  it('marks simulated events with 시안·연습 label', () => {
    const events: AgentActivityEvent[] = [
      {
        ...baseEvent,
        simulated: true,
        user_visible_summary: '가상 시안 생성 완료',
      },
    ]

    render(<AgentActivityTimeline events={events} />)
    expect(screen.getByText(/시안·연습/)).toBeInTheDocument()
  })

  it('filters events by workspaceId, missionId, or runId for tenant/run isolation', () => {
    const events: AgentActivityEvent[] = [
      baseEvent,
      {
        ...baseEvent,
        event_id: '88888888-8888-4888-8888-888888888888',
        workspace_id: '99999999-9999-4999-8999-999999999999',
        user_visible_summary: '타 테넌트 활동',
      },
    ]

    render(
      <AgentActivityTimeline
        events={events}
        filterWorkspaceId={baseEvent.workspace_id}
      />
    )
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.')).toBeInTheDocument()
    expect(screen.queryByText('타 테넌트 활동')).not.toBeInTheDocument()
  })

  it('privacy: does not leak raw payload or PII, only safe summaries', () => {
    const rawPayload = { customerPhone: '010-1234-5678', secretKey: 'SECRET_API_TOKEN' }
    const eventWithLeak: any = {
      ...baseEvent,
      rawPayload,
      user_visible_summary: '고객 정보 조회가 완료되었습니다.',
    }

    render(<AgentActivityTimeline events={[eventWithLeak]} />)
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.')).toBeInTheDocument()
    expect(screen.queryByText('고객 정보 조회가 완료되었습니다.')).not.toBeInTheDocument()
    expect(screen.queryByText(/010-1234-5678/)).not.toBeInTheDocument()
    expect(screen.queryByText(/SECRET_API_TOKEN/)).not.toBeInTheDocument()
  })
})

describe('AgentReasonSummary', () => {
  it('no-events: returns null when empty', () => {
    const { container } = render(<AgentReasonSummary events={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('separates verified facts from hypotheses/reasons and toggles evidence disclosure', () => {
    const events: AgentActivityEvent[] = [
      {
        ...baseEvent,
        kind: 'externally_verified',
        lifecycle: 'verified',
        user_visible_summary: '인스타그램 게시물이 정상적으로 확인되었습니다.',
      },
      {
        ...baseEvent,
        event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sequence: 2,
        kind: 'plan_proposed',
        lifecycle: 'proposed',
        user_visible_summary: '다음 실행 계획을 제안했습니다.',
      },
    ]

    render(<AgentReasonSummary events={events} />)

    expect(screen.getByText(/판단 요약/)).toBeInTheDocument()
    expect(screen.getByText(/확인된 사실/)).toBeInTheDocument()
    expect(screen.getByText(/판단·가설/)).toBeInTheDocument()
    expect(screen.getByText(/다음 행동/)).toBeInTheDocument()

    // Disclosure toggle button
    const evidenceButton = screen.getByRole('button', { name: /확인한 근거 보기/ })
    expect(evidenceButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(evidenceButton)
    expect(evidenceButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('외부 서비스의 독립 조회로 실행 결과를 확인했습니다.')).toBeInTheDocument()
  })

  it('displays safe next-action guidance on failure/unknown states', () => {
    const events: AgentActivityEvent[] = [
      {
        ...baseEvent,
        kind: 'result_unknown',
        lifecycle: 'result_unknown',
        user_visible_summary: '외부 작업 상태가 불명확합니다.',
      },
    ]

    render(<AgentReasonSummary events={events} />)
    expect(screen.getByText(/자동으로 다시 발송하지 않습니다/)).toBeInTheDocument()
  })
})

describe('AgentArtifactPlanCard', () => {
  const dummyPlan: PlanCardData = {
    planId: 'plan-101',
    title: '주말 프로모션 포스팅',
    steps: [
      {
        name: '초안 작성',
        sc: 5,
        risk: 'LOW',
        riskLabel: '안전',
      },
      {
        name: '인스타그램 게시',
        sc: 10,
        risk: 'MEDIUM',
        riskLabel: '주의',
      },
    ],
    totalSC: 15,
    requiresApproval: true,
  }

  it('renders plan steps, draft label, and safety notice', () => {
    render(<AgentArtifactPlanCard plan={dummyPlan} />)

    expect(screen.getByText(/계획 검토 필요/)).toBeInTheDocument()
    expect(screen.getByText(/미발행 · 초안/)).toBeInTheDocument()
    expect(screen.getByText(/승인 전 외부 쓰기 없음/)).toBeInTheDocument()
    expect(screen.getAllByText(/15 크레딧/).length).toBeGreaterThan(0)
    expect(screen.getByText('주말 프로모션 포스팅')).toBeInTheDocument()
  })

  it('shows unconfirmed cost if totalSC is not finite', () => {
    const planNoCost: PlanCardData = {
      ...dummyPlan,
      totalSC: -1,
    }
    render(<AgentArtifactPlanCard plan={planNoCost} />)
    expect(screen.getByText(/비용 미확정/)).toBeInTheDocument()
  })

  it('does not display 시안 badge on production plans without simulation flag', () => {
    render(<AgentArtifactPlanCard plan={dummyPlan} isSimulation={false} />)
    expect(screen.getByText(/미발행 · 초안/)).toBeInTheDocument()
    expect(screen.queryByText(/^시안$/)).not.toBeInTheDocument()
  })

  it('displays 시안 badge when isSimulation is true', () => {
    render(<AgentArtifactPlanCard plan={dummyPlan} isSimulation={true} />)
    expect(screen.getByText(/^시안$/)).toBeInTheDocument()
  })

  it('handles caption editing and saving with onSaveCaption callback and shows success state', async () => {
    const onSaveCaption = vi.fn().mockResolvedValue(undefined)
    const onApprovalInvalidated = vi.fn()

    render(
      <AgentArtifactPlanCard
        plan={dummyPlan}
        initialCaption="원래 홍보 원고입니다."
        onSaveCaption={onSaveCaption}
        onApprovalInvalidated={onApprovalInvalidated}
      />
    )

    expect(screen.getByText('원래 홍보 원고입니다.')).toBeInTheDocument()

    // Click edit button
    const editBtn = screen.getByRole('button', { name: '문구 수정' })
    fireEvent.click(editBtn)

    const textarea = screen.getByPlaceholderText('홍보 원고 문구를 입력하세요')
    fireEvent.change(textarea, { target: { value: '수정된 새로운 원고입니다.' } })

    const saveBtn = screen.getByRole('button', { name: '초안 저장' })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(onSaveCaption).toHaveBeenCalledWith('수정된 새로운 원고입니다.')
      expect(onApprovalInvalidated).toHaveBeenCalled()
      expect(screen.getByText(/초안이 저장되었습니다/)).toBeInTheDocument()
    })
  })

  it('does not allow editing if onSaveCaption is omitted', () => {
    render(
      <AgentArtifactPlanCard
        plan={dummyPlan}
        initialCaption="읽기 전용 원고입니다."
      />
    )

    expect(screen.getByText('읽기 전용 원고입니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '문구 수정' })).not.toBeInTheDocument()
  })
})
