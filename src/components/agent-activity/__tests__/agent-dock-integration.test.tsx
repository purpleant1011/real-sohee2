import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UniversalAgentDock } from '@/components/agent-dock/universal-agent-dock'
import { SoheeAgentDock } from '@/components/agent-dock/sohee-agent-dock'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'
import type { AgentActivityEvent } from '@/features/agent-activity/activity-event'

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    balance: 84000,
    capacity: 100000,
    remainingPercentage: 84,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app/sohee',
  useSearchParams: () => ({
    get: () => null,
  }),
}))

describe('Dock Activity Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders activity timeline and reason summary when server returns activityEvents', async () => {
    const mockEvents: AgentActivityEvent[] = [
      {
        event_id: '11111111-1111-4111-8111-111111111111',
        workspace_id: '22222222-2222-4222-8222-222222222222',
        mission_id: null,
        run_id: '33333333-3333-4333-8333-333333333333',
        step_id: '1',
        sequence: 1,
        observed_at: '2026-10-27T10:00:00.000Z',
        kind: 'externally_verified',
        lifecycle: 'verified',
        user_visible_summary: '네이버 플레이스 정보 조회가 확인되었습니다.',
        sensitivity_level: 'public',
        simulated: false,
      },
    ]

    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          reply: '조회를 완료했습니다.',
          activityEvents: mockEvents,
        }),
      } as any
    })

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <UniversalAgentDock workspaceId="22222222-2222-4222-8222-222222222222" />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    )

    const textarea = screen.getByPlaceholderText(/이번 주말 신메뉴/i)
    fireEvent.change(textarea, { target: { value: '네이버 플레이스 확인해줘' } })

    const form = textarea.closest('form')
    if (form) fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('조회를 완료했습니다.')).toBeInTheDocument()
    })

    // Verify AgentActivityTimeline rendering
    expect(screen.getByText(/소희의 작업 활동 · 1건/)).toBeInTheDocument()
    expect(screen.getByText('외부 서비스의 독립 조회로 실행 결과를 확인했습니다.')).toBeInTheDocument()

    // Verify AgentReasonSummary rendering
    expect(screen.getByText(/판단 요약 · 확인한 범위/)).toBeInTheDocument()
  })

  it('does not render activity timeline when no activities are returned (no fake events)', async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          reply: '일반 답변입니다.',
        }),
      } as any
    })

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <UniversalAgentDock workspaceId="22222222-2222-4222-8222-222222222222" />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    )

    const textarea = screen.getByPlaceholderText(/이번 주말 신메뉴/i)
    fireEvent.change(textarea, { target: { value: '안녕' } })

    const form = textarea.closest('form')
    if (form) fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('일반 답변입니다.')).toBeInTheDocument()
    })

    expect(screen.queryByText(/소희의 작업 활동/)).not.toBeInTheDocument()
    expect(screen.queryByText(/판단 요약/)).not.toBeInTheDocument()
  })

  it('renders AgentArtifactPlanCard when server returns planCard', async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          reply: '계획을 준비했습니다.',
          planCard: {
            planId: 'plan-1',
            title: '인스타그램 피드 발행',
            steps: [
              {
                name: '원고 생성',
                sc: 20,
              },
            ],
            totalSC: 20,
            requiresApproval: true,
          },
        }),
      } as any
    })

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <UniversalAgentDock workspaceId="22222222-2222-4222-8222-222222222222" />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    )

    const textarea = screen.getByPlaceholderText(/이번 주말 신메뉴/i)
    fireEvent.change(textarea, { target: { value: '글 올려줘' } })

    const form = textarea.closest('form')
    if (form) fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('계획을 준비했습니다.')).toBeInTheDocument()
    })

    expect(screen.getByText(/계획 검토 필요/)).toBeInTheDocument()
    expect(screen.getByText(/미발행 · 초안/)).toBeInTheDocument()
    expect(screen.getByText(/승인 전 외부 쓰기 없음/)).toBeInTheDocument()
  })

  it('SoheeAgentDock: renders streaming activities immediately and preserves them on stream EOF', async () => {
    const sseChunk1 = [
      'event: activity',
      'data: {"event_id":"11111111-1111-4111-8111-111111111111","workspace_id":"22222222-2222-4222-8222-222222222222","run_id":"33333333-3333-4333-8333-333333333333","sequence":1,"observed_at":"2026-10-27T10:00:00.000Z","kind":"tool_read_started","simulated":false}',
      '',
      '',
    ].join('\n')

    const sseChunk2 = [
      'event: activity',
      'data: {"event_id":"44444444-4444-4444-8444-444444444444","workspace_id":"22222222-2222-4222-8222-222222222222","run_id":"33333333-3333-4333-8333-333333333333","sequence":2,"observed_at":"2026-10-27T10:00:01.000Z","kind":"tool_read_verified","simulated":false}',
      '',
      '',
    ].join('\n')

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseChunk1))
        controller.enqueue(encoder.encode(sseChunk2))
        // Stream ends without result (EOF)
        controller.close()
      },
    })

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/agent/chat')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: stream,
        } as any
      }
      if (url.includes('/agent/activity')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ run_status: 'completed', events: [] }),
        } as any
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as any
    })

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock workspaceId="22222222-2222-4222-8222-222222222222" />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    )

    const textarea = screen.getByPlaceholderText(/이번 주말 신메뉴/i)
    fireEvent.change(textarea, { target: { value: '정보 확인해줘' } })

    const form = textarea.closest('form')
    if (form) fireEvent.submit(form)

    // Verify stream EOF preserves activities in message history
    await waitFor(() => {
      expect(
        screen.getByText(/연결이 잠시 끊겼어요. 소희는 작업을 계속하고 있을 수 있어요./)
      ).toBeInTheDocument()
    })

    // Both activities preserved
    expect(screen.getByText('연결된 도구에서 정보를 조회하고 있습니다.')).toBeInTheDocument()
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.')).toBeInTheDocument()
  })
})
