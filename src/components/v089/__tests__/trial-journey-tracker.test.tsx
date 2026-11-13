import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { TrialJourneyTracker } from '../trial-journey-tracker'

describe('TrialJourneyTracker Honest Value Truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('summary가 없을 때 80,000원이나 1/13일 거짓 fallback을 노출하지 않는다', () => {
    // initialMilestones/Summary 없는 상태로 렌더 (fetch pending)
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))

    render(<TrialJourneyTracker workspaceId="ws-1" />)

    expect(screen.queryByText(/80,000/)).toBeNull()
    expect(screen.queryByText(/80000/)).toBeNull()
    expect(screen.queryByText(/Day 1 \/ 14 \(남은 기간 13일\)/)).toBeNull()
    expect(screen.getByText(/확인 중/)).toBeDefined()
  })

  it('API 에러 발생 시 80,000원이나 0원으로 숨기지 않고 에러 상태를 표시한다', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'DB_READ_ERROR' }),
    } as Response)

    render(<TrialJourneyTracker workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
      expect(screen.getByText(/가치 요약을 불러오지 못했습니다/)).toBeDefined()
    })
    expect(screen.queryByText(/80,000/)).toBeNull()
  })

  it('실제 절감액이 0원일 때 ₩ 0 및 절감 시작 전 안내를 정직하게 표시한다', () => {
    render(
      <TrialJourneyTracker
        workspaceId="ws-1"
        initialMilestones={[]}
        initialSummary={{
          daysActive: 2,
          daysRemaining: 12,
          completedMilestonesCount: 0,
          totalMilestonesCount: 5,
          estimatedLaborSavingsWon: 0,
          generatedContentCount: 0,
          remainingCredits: 1000,
          recommendedPlanCode: 'growth',
          provenance: {
            factKind: 'ESTIMATED_VALUE',
            entitlementStart: '2026-10-25T00:00:00Z',
            entitlementEnd: '2026-11-08T00:00:00Z',
            laborBasisDescription: '외주 대행 제작 단가 대비 추정',
          },
        }}
      />
    )

    expect(screen.getByText(/₩ 0/)).toBeDefined()
    expect(screen.getByText(/Day 2 \/ 14/)).toBeDefined()
    expect(screen.getByText(/남은 기간 12일/)).toBeDefined()
    expect(screen.queryByText(/80,000/)).toBeNull()
  })

  it('실제 절감액이 존재할 때 추정 금액과 provenance 산정 근거를 함께 표시한다', () => {
    render(
      <TrialJourneyTracker
        workspaceId="ws-1"
        initialMilestones={[]}
        initialSummary={{
          daysActive: 4,
          daysRemaining: 10,
          completedMilestonesCount: 2,
          totalMilestonesCount: 5,
          estimatedLaborSavingsWon: 70000,
          generatedContentCount: 2,
          remainingCredits: 800,
          recommendedPlanCode: 'growth',
          provenance: {
            factKind: 'ESTIMATED_VALUE',
            entitlementStart: '2026-10-23T00:00:00Z',
            entitlementEnd: '2026-11-06T00:00:00Z',
            laborBasisDescription: '외주 대행 제작 단가(건당 3.5만원) 대비 소희 AI 자동 생성 건수 기준 추정',
          },
        }}
      />
    )

    expect(screen.getByText(/₩ 70,000/)).toBeDefined()
    expect(screen.getByText(/외주 대행 제작 단가\(건당 3.5만원\)/)).toBeDefined()
    expect(screen.queryByText(/80,000/)).toBeNull()
  })

  it('workspaceId가 변경될 때 이전 요청의 느린 응답이 최신 워크스페이스를 덮어쓰지 않는다 (race condition 차단)', async () => {
    let resolveWs1!: (res: Response) => void
    const ws1Promise = new Promise<Response>((resolve) => {
      resolveWs1 = resolve
    })

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('ws-1')) return ws1Promise
      if (String(url).includes('ws-2')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            milestones: [],
            summary: {
              daysActive: 5,
              daysRemaining: 9,
              completedMilestonesCount: 1,
              totalMilestonesCount: 5,
              estimatedLaborSavingsWon: 35000,
              generatedContentCount: 1,
              remainingCredits: 500,
              recommendedPlanCode: 'growth',
              provenance: {
                factKind: 'ESTIMATED_VALUE',
                entitlementStart: '2026-10-22T00:00:00Z',
                entitlementEnd: '2026-11-05T00:00:00Z',
                laborBasisDescription: '기준 추정',
              },
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error('Unknown url'))
    })

    const { rerender } = render(<TrialJourneyTracker workspaceId="ws-1" />)

    // workspaceId가 ws-2로 변경됨
    rerender(<TrialJourneyTracker workspaceId="ws-2" />)

    await waitFor(() => {
      expect(screen.getByText(/₩ 35,000/)).toBeDefined()
    })

    // 이전 ws-1 응답이 뒤늦게 도착
    resolveWs1({
      ok: true,
      json: async () => ({
        success: true,
        milestones: [],
        summary: {
          daysActive: 1,
          daysRemaining: 13,
          completedMilestonesCount: 0,
          totalMilestonesCount: 5,
          estimatedLaborSavingsWon: 140000,
          generatedContentCount: 4,
          remainingCredits: 0,
          recommendedPlanCode: 'growth',
          provenance: { factKind: 'ESTIMATED_VALUE', entitlementStart: '', entitlementEnd: '', laborBasisDescription: '' },
        },
      }),
    } as Response)

    // ws-2의 상태(35,000원)가 그대로 유지되어야 하고 140,000원으로 덮어써지면 안 됨
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByText(/₩ 35,000/)).toBeDefined()
    expect(screen.queryByText(/140,000/)).toBeNull()
  })
})
