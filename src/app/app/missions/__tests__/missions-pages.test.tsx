import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { computePlanDiff, computeContractApprovalHash } from '@/lib/mission-os/mission-plan-diff'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ query: '', workspaceId: 'ws-test-123' }))
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => navigation.workspaceId,
}))

vi.mock('@/components/v089/trial-journey-tracker', () => ({
  TrialJourneyTracker: () => <div data-testid="trial-tracker" />,
}))

vi.mock('@/features/mobile-firstpost/first-post-resume', () => ({
  FirstPostResume: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import MissionsListPage from '../page'
import MissionDetailPage from '../[id]/page'
import {
  buildCanonicalMissionDTO,
  type CanonicalMissionDTO,
} from '@/lib/mission-os/mission-read-model'

describe('MissionsListPage (/app/missions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('renders empty state when API returns empty mission list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, items: [] }),
    } as Response)

    render(<MissionsListPage />)

    expect(screen.getByRole('status')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('현재 진행 중인 마케팅 임무가 없습니다')).toBeInTheDocument()
    })
  })

  it('renders error state with retry button when API returns error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    render(<MissionsListPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('업무 목록을 조회하지 못했습니다.')).toBeInTheDocument()
      expect(screen.getByText('다시 시도')).toBeInTheDocument()
    })
  })

  it('renders missions with dual state lines (execution & outcome) and sanitized honest errors', async () => {
    const mockMissions: CanonicalMissionDTO[] = [
      buildCanonicalMissionDTO({
        id: 'ms-test-1234',
        workspace_id: 'ws-test-123',
        trace_id: 'tr-1',
        status: 'PUBLISHED_VERIFIED',
        goal: '신규 고객 10명 유치',
        target_channel: 'instagram',
        created_at: '2026-10-27T00:00:00.000Z',
        updated_at: '2026-10-27T01:00:00.000Z',
        metadata: {
          snapshot_version: 3,
          plan_version: 1,
          contract: {
            contract_version: 1,
            goal: '신규 고객 10명 유치',
            success_criterion: { metric: 'clicks', target_value: 10 },
            observation_window: {
              start_at: '2026-10-27T00:00:00.000Z',
              end_at: '2026-10-28T00:00:00.000Z',
              evaluation_interval_hours: 1,
            },
          },
          observation_evidence: {
            status: 'READ_FAILED',
            observed_at: '2026-10-27T01:00:00.000Z',
          },
          errors: ['외부 인스타그램 메타 그래프 API 응답 지연 (504 Gateway Timeout)'],
        },
      }),
    ]

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, items: mockMissions }),
    } as Response)

    render(<MissionsListPage />)

    await waitFor(() => {
      expect(screen.getByText('신규 고객 10명 유치')).toBeInTheDocument()
    })

    // Line 1: Execution State
    expect(screen.getByText('진행 상황:')).toBeInTheDocument()
    expect(screen.getByText('소희 자율 진행 중')).toBeInTheDocument()

    // Line 2: Outcome State
    expect(screen.getByText('성과 확인:')).toBeInTheDocument()
    expect(screen.getByText('성과 지표 조회 실패 · 외부 플랫폼 상태 확인이 필요합니다.')).toBeInTheDocument()

    // Observation status & Sanitized honest error callout (errors != empty/0, Korean allowlist)
    expect(screen.getByText(/조회 실패 \(재확인 필요\)/)).toBeInTheDocument()
    expect(screen.getByText(/확인 필요 사항/)).toBeInTheDocument()
    expect(screen.getByText('외부 서비스 통신 지연으로 재확인이 필요합니다.')).toBeInTheDocument()

    // Preserved Deep-Links
    expect(screen.getByRole('link', { name: /콘텐츠/ })).toHaveAttribute('href', '/app/content')
    expect(screen.getByRole('link', { name: /보관함/ })).toHaveAttribute('href', '/app/vault')
    expect(screen.getByRole('link', { name: /광고\/채널/ })).toHaveAttribute('href', '/app/ads')
  })
})

describe('MissionDetailPage (/app/missions/[id])', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    navigation.query = ''
    navigation.workspaceId = 'ws-test-123'
  })

  const contract = {
    contract_version: 1, goal: '예약 10건', success_criterion: { metric: 'reservations', target_value: 10 },
    observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2099-11-03T00:00:00Z' },
    service_scope: ['instagram', 'threads'], allowed_actions: ['PUBLISH_POST'], forbidden_actions: [],
    budget_caps: { max_cost_minor_units: 50000, currency: 'CREDIT' },
    attention_policy: { max_escalations: 2, notify_on_breach: true }, fact_version_refs: {}, policy_version: 'v1',
    approval_fingerprint: null, owner_actor: { actor_type: 'user' as const, actor_id: 'owner' },
    effective_at: '2026-10-27T00:00:00Z', expires_at: '2099-11-05T00:00:00Z',
  }
  const detail = (id = 'mission-scoped') => ({ success: true, snapshot_version: 2,
    canonicalDto: buildCanonicalMissionDTO({ id, workspace_id: navigation.workspaceId, trace_id: 'trace', status: 'AWAITING_APPROVAL', goal: '예약 10건', created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', metadata: { snapshot_version: 2, execution_state: 'NEEDS_DECISION', contract } }),
    contract_approval: { payload_hash: computeContractApprovalHash(contract), review_lines: ['인스타그램 · 스레드', '예산 상한: 50,000 크레딧'] },
  })
  const jsonResponse = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response

  it('automatically calculates the handed-off prompt once for the same mission without premature success', async () => {
    navigation.query = new URLSearchParams({ planPrompt: '인스타만, 예산 그대로' }).toString()
    let finish!: (response: Response) => void
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => String(url).endsWith('/plan-diff')
      ? new Promise((resolve) => { finish = resolve }) : jsonResponse(detail()))
    const view = render(<React.StrictMode><MissionDetailPage params={{ id: 'mission-scoped' }} /></React.StrictMode>)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/plan-diff'))).toHaveLength(1))
    expect(screen.queryByText(/변경 계획이 작성되었습니다/)).not.toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/plan-diff'))!
    expect(call[0]).toBe('/api/missions/mission-scoped/plan-diff')
    expect(JSON.parse(String(call[1]?.body))).toEqual({ intentText: '인스타만, 예산 그대로', expectedSnapshotVersion: 2 })
    const diff = computePlanDiff(contract, { service_scope: ['instagram'] }, { missionId: 'mission-scoped', expectedSnapshotVersion: 2 })
    await act(async () => finish(jsonResponse({ plan_diff: diff })))
    await waitFor(() => expect(screen.getByText(/변경 계획이 작성되었습니다/)).toBeInTheDocument())
    view.rerender(<React.StrictMode><MissionDetailPage params={{ id: 'mission-scoped' }} /></React.StrictMode>)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/plan-diff'))).toHaveLength(1)
    expect(diff.proposed_contract.service_scope).toEqual(['instagram'])
    expect(diff.proposed_contract.budget_caps).toEqual(contract.budget_caps)
  })

  it('does not use a late response from another mission to generate the handed-off plan', async () => {
    navigation.query = new URLSearchParams({ planPrompt: '인스타만, 예산 그대로' }).toString()
    let finishOld!: (response: Response) => void
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url) === '/api/missions/old') return new Promise((resolve) => { finishOld = resolve })
      if (String(url).endsWith('/plan-diff')) return jsonResponse({ is_ambiguous: true, clarification_prompt: '검토 필요' })
      return jsonResponse(detail('new'))
    })
    const view = render(<MissionDetailPage params={{ id: 'old' }} />)
    view.rerender(<MissionDetailPage params={{ id: 'new' }} />)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/new/plan-diff')).toBe(true))
    await act(async () => finishOld(jsonResponse(detail('old'))))
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/old/plan-diff')).toBe(false)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/plan-diff'))).toHaveLength(1)
  })

  it('ignores a late response from the previous workspace for the same mission', async () => {
    navigation.query = new URLSearchParams({ planPrompt: '인스타만, 예산 그대로' }).toString()
    const oldDetail = detail()
    let finishOld!: (response: Response) => void
    let reads = 0
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/plan-diff')) return jsonResponse({ is_ambiguous: true, clarification_prompt: '검토 필요' })
      if (++reads === 1) return new Promise((resolve) => { finishOld = resolve })
      return jsonResponse(detail())
    })
    const view = render(<MissionDetailPage params={{ id: 'mission-scoped' }} />)
    navigation.workspaceId = 'ws-other'
    view.rerender(<MissionDetailPage params={{ id: 'mission-scoped' }} />)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/plan-diff'))).toHaveLength(1))
    await act(async () => finishOld(jsonResponse(oldDetail)))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/plan-diff'))).toHaveLength(1)
  })

  it('a deep link containing pause text only calculates a proposal and never pauses automatically', async () => {
    navigation.query = new URLSearchParams({ planPrompt: '일시정지' }).toString()
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => String(url).endsWith('/plan-diff')
      ? jsonResponse({ is_pause_intent: true, plan_diff: null }) : jsonResponse(detail()))
    render(<MissionDetailPage params={{ id: 'mission-scoped' }} />)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/plan-diff'))).toBe(true))
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/pause'))).toBe(false)
    expect(screen.queryByText(/변경 계획이 작성되었습니다/)).not.toBeInTheDocument()
  })

  it('locks repeated approval clicks synchronously until the request completes', async () => {
    let finish!: (response: Response) => void
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => String(url).endsWith('/approve')
      ? new Promise((resolve) => { finish = resolve }) : jsonResponse(detail()))
    render(<MissionDetailPage params={{ id: 'mission-scoped' }} />)
    const button = await screen.findByRole('button', { name: '계약 최종 승인하고 실행 준비하기' })
    act(() => { button.click(); button.click() })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/approve'))).toHaveLength(1)
    await act(async () => finish(jsonResponse({ error: '계약을 다시 확인해 주세요.' }, false)))
  })

  it('sends reviewed hash, version and a stable key on approval network retransmission', async () => {
    const bodies: any[] = []
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/approve')) {
        bodies.push(JSON.parse(String(init?.body)))
        throw new Error('network interrupted')
      }
      return jsonResponse(detail())
    })
    render(<MissionDetailPage params={{ id: 'mission-scoped' }} />)
    const button = await screen.findByRole('button', { name: '계약 최종 승인하고 실행 준비하기' })
    fireEvent.click(button)
    await screen.findByText('업무 실행 승인 중 네트워크 오류가 발생했습니다.')
    fireEvent.click(button)
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[0]).toEqual(bodies[1])
    expect(bodies[0]).toMatchObject({ expectedSnapshotVersion: 2, contractPayloadHash: computeContractApprovalHash(contract), idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{1,128}$/) })
  })

  it('renders mission detail with dual state lines and conversational adjustment CTA', async () => {
    const mockDto = buildCanonicalMissionDTO({
      id: 'ms-detail-9999',
      workspace_id: 'ws-test-123',
      trace_id: 'tr-detail-1',
      status: 'PUBLISHED_VERIFIED',
      goal: '스레드 주간 조회수 1,000회 달성',
      target_channel: 'threads',
      created_at: '2026-10-27T00:00:00.000Z',
      updated_at: '2026-10-27T01:00:00.000Z',
      metadata: {
        snapshot_version: 5,
        contract: {
          contract_version: 1,
          goal: '스레드 주간 조회수 1,000회 달성',
          success_criterion: { metric: 'views', target_value: 1000 },
          observation_window: {
            start_at: '2026-10-27T00:00:00.000Z',
            end_at: '2026-10-28T12:00:00.000Z',
            evaluation_interval_hours: 1,
          },
        },
        observation_evidence: {
          status: 'OBSERVED',
          observed_value: 14,
        },
      },
    })

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        canonicalDto: mockDto,
        conversation_href: '/app/conversations/50000000-0000-4000-8000-000000000001',
      }),
    } as Response)

    render(<MissionDetailPage params={{ id: 'ms-detail-9999' }} />)

    await waitFor(() => {
      expect(screen.getByText('스레드 주간 조회수 1,000회 달성')).toBeInTheDocument()
    })

    // Execution line
    expect(screen.getByText('실행 진행 상황')).toBeInTheDocument()
    expect(screen.getByText('외부 게시 확인 필요')).toBeInTheDocument()
    expect(screen.queryByText('발행 및 게시 확인 완료')).toBeNull()

    // Outcome line
    expect(screen.getByText('성과 확인 내용')).toBeInTheDocument()
    expect(screen.getByText(/공식 성과 확인 완료 \(14\)/)).toBeInTheDocument()

    // Resume the existing source conversation; do not start an unrelated generic chat.
    const chatBtn = screen.getByRole('button', { name: '대화 이어가기' })
    fireEvent.click(chatBtn)
    expect(mockPush).toHaveBeenCalledWith('/app/conversations/50000000-0000-4000-8000-000000000001')
    expect(mockPush).not.toHaveBeenCalledWith('/app/command')
  })

  it('keeps an unlinked mission in its scoped adjustment form instead of opening unrelated chat', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse(detail()))
    render(<MissionDetailPage params={{ id: 'mission-scoped' }} />)
    fireEvent.click(await screen.findByRole('button', { name: '대화 이어가기' }))
    expect(screen.getByPlaceholderText(/인스타만 진행해줘/)).toHaveFocus()
    expect(mockPush).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(screen.getByText(/연결된 대화를 찾지 못했어요/)).toBeInTheDocument()
  })

  it('renders unverified evidence notice when observationStatus is OBSERVED but observedValue is null or malformed', async () => {
    const malformedDto = buildCanonicalMissionDTO({
      id: 'ms-detail-malformed',
      workspace_id: 'ws-test-123',
      trace_id: 'tr-detail-2',
      status: 'PUBLISHED_VERIFIED',
      goal: '인스타그램 릴스 조회수 1만 달성',
      target_channel: 'instagram',
      created_at: '2026-10-27T00:00:00.000Z',
      updated_at: '2026-10-27T01:00:00.000Z',
      metadata: {
        observation_evidence: {
          status: 'OBSERVED',
          observed_value: null, // Malformed evidence
        },
      },
    })

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        canonicalDto: malformedDto,
      }),
    } as Response)

    render(<MissionDetailPage params={{ id: 'ms-detail-malformed' }} />)

    await waitFor(() => {
      expect(screen.getByText('인스타그램 릴스 조회수 1만 달성')).toBeInTheDocument()
    })

    // Malformed evidence must NOT claim green verified
    expect(screen.queryByText(/공식 성과 확인 완료/)).not.toBeInTheDocument()
    expect(screen.getByText('성과 근거 부족 (관측 수치 미확인)')).toBeInTheDocument()
  })

  it('displays honest progress messages for BLOCKED, FAILED, PAUSED, CANCELLED, COMPLETED, RESULT_UNKNOWN', async () => {
    const testCases = [
      { status: 'BLOCKED', isBlocked: true, expectedText: '진행이 차단된 상태입니다. 조치 사항을 확인해 주세요.' },
      { status: 'FAILED', isBlocked: false, expectedText: '일시적인 오류로 중단되었습니다. 재시도 또는 확인이 필요합니다.' },
      { status: 'PAUSED', isBlocked: false, expectedText: '임무가 일시 정지된 상태입니다. 언제든 다시 재개할 수 있습니다.' },
      { status: 'CANCELLED', isBlocked: false, expectedText: '임무가 취소되었습니다.' },
      { status: 'COMPLETED', isBlocked: false, expectedText: '모든 단계의 업무가 성공적으로 완료되었습니다.' },
      { status: 'RESULT_UNKNOWN', isBlocked: false, expectedText: '외부 플랫폼 발행 결과를 확인하고 있습니다. (중복 방지 락 적용 중)' },
    ]

    for (const tc of testCases) {
      const dto = buildCanonicalMissionDTO({
        id: `ms-status-${tc.status.toLowerCase()}`,
        workspace_id: 'ws-test-123',
        trace_id: 'tr-status-1',
        status: tc.status as any,
        goal: `${tc.status} 테스트 임무`,
        target_channel: 'instagram',
        created_at: '2026-10-27T00:00:00.000Z',
        updated_at: '2026-10-27T01:00:00.000Z',
        metadata: {
          is_blocked: tc.isBlocked,
        },
      })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          canonicalDto: dto,
        }),
      } as Response)

      const { unmount } = render(<MissionDetailPage params={{ id: `ms-status-${tc.status.toLowerCase()}` }} />)

      await waitFor(() => {
        expect(screen.getByText(`${tc.status} 테스트 임무`)).toBeInTheDocument()
      })

      expect(screen.getByText(tc.expectedText)).toBeInTheDocument()
      expect(screen.queryByText('소희가 약정된 순서에 따라 차분히 진행하고 있습니다.')).not.toBeInTheDocument()

      unmount()
    }
  })
})
