import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngagementView } from '../engagement-view'
import type { OperatorEngagementOverview } from '../schemas'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}))

const mockOverview: OperatorEngagementOverview = {
  autonomy: {
    l1Manual: 4,
    l2Assisted: 3,
    l3Autonomous: 2,
    totalConfigured: 9,
    pausedCount: 1,
  },
  expiringDms: [
    {
      id: 'd9b1c2d3-1111-4444-8888-000000000001',
      workspaceId: 'w9b1c2d3-1111-4444-8888-000000000001',
      workspaceName: '성수 카페',
      customerHandle: '@sungsu_fan',
      lastMessageText: '영업 몇시까지 하나요?',
      lastMessageAt: '2026-10-14T10:00:00.000Z',
      expiresAt: '2026-10-14T11:00:00.000Z',
      remainingMinutes: 40,
      status: 'NEEDS_REPLY',
      urgency: 'CRITICAL',
    },
  ],
  expiringCriticalCount: 1,
  stats24h: {
    windowHours: 24,
    totalAttempts: 100,
    successfulReplies: 98,
    failedReplies: 2,
    successRatePercent: 98.0,
  },
  recentAudits: [
    {
      id: 'aud-1',
      workspaceId: 'w9b1c2d3-1111-4444-8888-000000000001',
      workspaceName: '성수 카페',
      channel: 'instagram',
      action: 'auto_reply',
      actor: 'system',
      createdAt: '2026-10-14T10:10:00.000Z',
      details: { comment_id: 'c-1' },
    },
  ],
  asOf: '2026-10-14T11:00:00.000Z',
}

describe('EngagementView', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders page header and metric tiles', () => {
    render(<EngagementView initialData={mockOverview} />)

    expect(screen.getByRole('heading', { level: 1, name: '소통함 관제' })).toBeInTheDocument()
    expect(screen.getByText('만료 임박 DM')).toBeInTheDocument()
    expect(screen.getByText('자율성 L3 (완전자동)')).toBeInTheDocument()
    expect(screen.getByText('자율성 L2 (추천)')).toBeInTheDocument()
    expect(screen.getByText('자율성 L1 (수동)')).toBeInTheDocument()
    expect(screen.getByText('24h 자동답글 성공률')).toBeInTheDocument()
    expect(screen.getByText('98%')).toBeInTheDocument()

    expect(screen.queryByText(/승인 없이 자동 발송/)).not.toBeInTheDocument()
    expect(screen.getByText('자동 응대 활성 매장')).toBeInTheDocument()
  })

  it('renders expiring DM threads in table', () => {
    render(<EngagementView initialData={mockOverview} />)

    expect(screen.getByText('인스타그램 DM 24시간 윈도우 관제 (응답 만료 임박 스레드)')).toBeInTheDocument()
    expect(screen.getAllByText('성수 카페').length).toBeGreaterThan(0)
    expect(screen.getByText('@sungsu_fan')).toBeInTheDocument()
    expect(screen.getByText('영업 몇시까지 하나요?')).toBeInTheDocument()
    expect(screen.getByText('1시간 미만')).toBeInTheDocument()
  })

  it('submits killswitch request and displays success feedback', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        scope: 'all',
        action: 'downgrade_to_l1',
        affectedWorkspaces: 2,
        updatedPolicies: 2,
        timestamp: '2026-10-14T12:00:00.000Z',
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<EngagementView initialData={mockOverview} />)

    const reasonInput = screen.getByPlaceholderText(/인스타그램 댓글 환각 오발송/i)
    fireEvent.change(reasonInput, { target: { value: '긴급 환각 차단 테스트' } })

    const submitBtn = screen.getByRole('button', { name: /긴급 킬스위치 발동/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/engagement/killswitch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            scope: 'all',
            action: 'downgrade_to_l1',
            reason: '긴급 환각 차단 테스트',
          }),
        }),
      )
    })

    expect(await screen.findByText(/킬스위치 실행 완료/i)).toBeInTheDocument()
  })

  it('renders empty notice when lists are empty', () => {
    const emptyOverview: OperatorEngagementOverview = {
      ...mockOverview,
      expiringDms: [],
      expiringCriticalCount: 0,
      recentAudits: [],
    }

    render(<EngagementView initialData={emptyOverview} />)

    expect(screen.getByText('만료 임박한 DM 스레드가 없어요')).toBeInTheDocument()
    expect(screen.getByText('최근 소통함 감사 기록이 없어요')).toBeInTheDocument()
  })
})
