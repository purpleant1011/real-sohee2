import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LegacyTodayHome as TodayHome } from './legacy-today-home'
import { emptyObservedReport } from '@/features/reporting/__tests__/fixtures'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isPaused: false,
    toggleAutonomy: vi.fn(),
  }),
}))

vi.mock('./advanced-home', () => ({
  AdvancedHome: () => <div>기존 현황판과 파이프라인</div>,
}))

const canonicalModel = {
  success: true,
  data: {
    businessName: { value: '바이름 청라점', state: 'AVAILABLE' },
    channels: [{ channel: 'instagram', isAuthorized: true, connectionStatus: 'verified' }],
    recentActionsCount: 2,
  },
}

const emptyPosts = {
  items: [],
}

const zeroVault = {
  success: true,
  data: {
    stored_count: 0,
    needs_reapproval_count: 0,
    invalidated_count: 0,
    total_count: 0,
    external_action_count: 0,
    this_week_count: 0,
  },
}

const readinessData = {
  readiness: {
    ready: true,
    stage: 'PUBLISH_READY',
    facts: {
      INSTAGRAM_VERIFIED: { verified: true },
      THREADS_VERIFIED: { verified: true },
      BUSINESS_VERIFIED: { verified: true },
    },
    blockers: [],
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TodayHome 결정 우선형 디자인 & 정직한 지표 검증', () => {
  it('간략/상세 토글 버튼을 제공하며, 전환 시 선택 상태가 변경된다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-test') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => emptyPosts }
        if (url.includes('vault/summary')) return { ok: true, json: async () => zeroVault }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        if (url.includes('customers/pipeline')) return { ok: true, json: async () => ({ kpis: { inquiryCount: 3, bookedCount: 1 } }) }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-test" />)

    // 표시 밀도 라디오그룹
    const densityGroup = await screen.findByRole('radiogroup', { name: '표시 밀도 선택' })
    const simpleBtn = within(densityGroup).getByRole('radio', { name: '간략' })
    const detailedBtn = within(densityGroup).getByRole('radio', { name: '상세' })

    // 기본값은 간략(compact)
    expect(simpleBtn.getAttribute('aria-checked')).toBe('true')
    expect(detailedBtn.getAttribute('aria-checked')).toBe('false')

    // 상세 클릭
    fireEvent.click(detailedBtn)
    expect(simpleBtn.getAttribute('aria-checked')).toBe('false')
    expect(detailedBtn.getAttribute('aria-checked')).toBe('true')
  })

  it('확인된 매출이 없으면 공통 주간 기록에서 미관측으로 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-test') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => emptyPosts }
        if (url.includes('vault/summary')) return { ok: true, json: async () => zeroVault }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        if (url.includes('customers/pipeline')) return { ok: true, json: async () => ({ kpis: { inquiryCount: 3, bookedCount: 1 } }) }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-test" />)

    // 하단 검증된 결과 영역 확인
    const resultsSection = await screen.findByRole('region', { name: '주간 실제 기록' })
    expect(within(resultsSection).getByText('확인된 매출')).toBeTruthy()
    expect(within(resultsSection).getAllByText('아직 확인할 수 없어요').length).toBeGreaterThan(0)

    // 가정에 기반한 허위 확정 실적(인건비 절감액 등)이 화면에 노출되지 않음 확인
    expect(screen.queryByText('인건비 절감')).toBeNull()
  })

  it('홈이 성과·고객 화면과 같은 주간 관측 항목을 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-test') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => emptyPosts }
        if (url.includes('vault/summary')) return { ok: true, json: async () => zeroVault }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        if (url.includes('customers/pipeline')) return { ok: true, json: async () => ({ kpis: { inquiryCount: 0, bookedCount: 0 } }) }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-test" />)

    const summarySection = await screen.findByRole('region', { name: '주간 실제 기록' })
    expect(within(summarySection).getByText('현재 확정 예약')).toBeTruthy()
    expect(within(summarySection).getByText('게시 확인')).toBeTruthy()
    expect(within(summarySection).getByText('확인된 예약금 수납')).toBeTruthy()
  })

  it('간략 모드에서는 보관함 요약/최근 게시물이 숨겨지고, 상세 모드로 전환 시 나타난다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-test') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => emptyPosts }
        if (url.includes('vault/summary')) return { ok: true, json: async () => zeroVault }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        if (url.includes('customers/pipeline')) return { ok: true, json: async () => ({ kpis: { inquiryCount: 0, bookedCount: 0 } }) }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-test" />)

    // 기본(간략 모드): 보관함 현황과 최근 게시물이 숨겨짐
    await screen.findByRole('region', { name: '업무 현황 요약' })
    expect(screen.queryByRole('region', { name: '보관함 현황' })).toBeNull()
    expect(screen.queryByRole('region', { name: '최근 게시물' })).toBeNull()

    // 상세 모드 전환
    const densityGroup = screen.getByRole('radiogroup', { name: '표시 밀도 선택' })
    fireEvent.click(within(densityGroup).getByRole('radio', { name: '상세' }))

    // 상세 모드에서는 보관함 현황 및 최근 게시물이 렌더링됨
    expect(screen.getByRole('region', { name: '보관함 현황' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '최근 게시물' })).toBeTruthy()
  })
})
