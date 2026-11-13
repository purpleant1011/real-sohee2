import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LegacyTodayHome as TodayHome } from './legacy-today-home'
import { emptyObservedReport } from '@/features/reporting/__tests__/fixtures'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

const mockToggleAutonomy = vi.fn()
let currentIsPaused = true
let currentActualMode: string | null = null

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isPaused: currentIsPaused,
    actualMode: currentActualMode ?? (currentIsPaused ? 'PAUSED' : 'RUNNING'),
    isLoading: false,
    toggleAutonomy: mockToggleAutonomy,
  }),
}))

vi.mock('./advanced-home', () => ({
  AdvancedHome: () => <div>기존 현황판과 파이프라인</div>,
}))

const canonicalModel = {
  success: true,
  data: {
    businessName: { value: '햇살 가게', state: 'AVAILABLE' },
    channels: [{ channel: 'instagram', isAuthorized: true, connectionStatus: 'verified' }],
    recentActionsCount: 1,
  },
}

const awaitingPost = {
  missionId: 'post-1',
  status: 'AWAITING_APPROVAL',
  topic: '새로운 소식',
  createdAt: '2026-10-06T12:00:00Z',
  imageUrl: null,
  receipts: {},
}

const vaultSummaryData = {
  success: true,
  data: {
    stored_count: 3,
    needs_reapproval_count: 0,
    invalidated_count: 0,
    total_count: 3,
    external_action_count: 0,
    external_action_warning: null,
    this_week_count: 2,
  },
}

const readinessData = {
  readiness: {
    ready: true,
    stage: 'PUBLISH_READY',
    facts: {
      INSTAGRAM_VERIFIED: { verified: true },
      THREADS_VERIFIED: { verified: false },
      BUSINESS_VERIFIED: { verified: true },
      BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true },
      TEXT_HARNESS_CONFIRMED: { verified: true },
      IMAGE_HARNESS_CONFIRMED: { verified: true },
      OPERATING_POLICY_CONFIRMED: { verified: true },
    },
    blockers: [],
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  mockToggleAutonomy.mockClear()
  currentIsPaused = true
  currentActualMode = null
})

describe('TodayHome (ANI-1549: 오늘 할 일 1개 카드 및 안전 기능)', () => {
  it('서버 상태 미확인은 가동 중이나 일시 멈춤으로 확정하지 않는다', () => {
    currentActualMode = 'UNKNOWN'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    render(<TodayHome workspaceId="ws-1" />)
    expect(screen.getByText('소희 업무 상태 확인 안 됨')).toBeInTheDocument()
    expect(screen.queryByText('소희 업무 일시 멈춤')).toBeNull()
    expect(screen.queryByText('소희 자율근무 중')).toBeNull()
  })
  it('최상단 오늘 할 일 1개 카드(단 1개 CTA), 보관함 요약 한 줄, 성과 위젯, 최근 게시물을 렌더링하고 자세히 보기는 접혀 있다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-1') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [awaitingPost] }) }
        if (url.includes('vault/summary')) return { ok: true, json: async () => vaultSummaryData }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-1" initialDensity="detailed" />)

    expect(screen.getByText('오늘 할 일을 불러오고 있어요.')).toBeTruthy()

    expect(screen.getByRole('radio', { name: '상세' })).toHaveAttribute('aria-checked', 'true')

    // 1. 헤더 인사말
    expect(
      await screen.findByRole('heading', { level: 1, name: '햇살 가게 사장님, 오늘도 소희가 함께해요' }),
    ).toBeTruthy()

    // 2. 최상단 "오늘 할 일 1개" 카드 (명확한 단 1개의 CTA)
    const todaySection = screen.getByRole('region', { name: '오늘 할 일' })
    expect(within(todaySection).getByText('오늘 올릴 글 소희가 준비했어요')).toBeTruthy()
    expect(within(todaySection).getByText('"새로운 소식" 소희가 준비한 글을 확인하고 발행해 보세요.')).toBeTruthy()
    const ctaLinks = within(todaySection).getAllByRole('link')
    expect(ctaLinks).toHaveLength(1) // CTA가 동등 3개가 아니라 단 1개
    expect(ctaLinks[0].textContent).toContain('미리보기 열기')

    // 3. 보관함 요약 한 줄 실집계 ("보관 3건 · 게시 확인은 주간 기록에서 확인해 주세요")
    const vaultSection = screen.getByRole('region', { name: '보관함 현황' })
    expect(within(vaultSection).getByText('보관 3건 · 게시 확인은 주간 기록에서 확인해 주세요')).toBeTruthy()

    // 4. Shared weekly source distinguishes observed zero from unobserved income.
    const metricsSection = await screen.findByRole('region', { name: '주간 실제 기록' })
    expect(within(metricsSection).getByText('게시 확인')).toBeTruthy()
    expect(within(metricsSection).getByText('현재 확정 예약')).toBeTruthy()
    expect(within(metricsSection).getByText('확인된 매출')).toBeTruthy()
    expect(within(metricsSection).getAllByText('아직 확인할 수 없어요').length).toBeGreaterThan(0)

    // 5. 최근 게시물
    expect(screen.getByText('새로운 소식')).toBeTruthy()
    expect(screen.getByText('확인 필요')).toBeTruthy()

    // 6. 자세히 보기(고급)는 접혀 있음 — 펼치기 전에는 지연 로딩 모듈을 요청하지 않는다
    expect(screen.queryByText('기존 현황판과 파이프라인')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '자세히 보기(고급)' }))
    expect(await screen.findByText('기존 현황판과 파이프라인')).toBeTruthy()
  })

  it('고급 현황판은 정적 import가 아니라 지연 로딩 대상이다 (ANI-1741)', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/home-today/legacy-today-home.tsx'), 'utf8')
    // 접힌 상태가 기본이므로 무거운 하위 트리는 초기 청크에 포함되면 안 된다.
    expect(source).not.toMatch(/from '\.\/advanced-home'/)
    expect(source).toMatch(/import\('\.\/advanced-home'\)/)
  })

  it('긴급 정지는 메뉴 안에서 2클릭 이내 접근 가능하며 안전 기능이 보존된다', async () => {
    currentIsPaused = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-1') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [] }) }
        if (url.includes('vault/summary')) return { ok: true, json: async () => vaultSummaryData }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-1" initialDensity="detailed" />)

    // 정상 가동 중일 때는 멈춤 안내 알림 배너가 노출되지 않음
    await waitFor(() => {
      expect(screen.queryByText('소희의 업무가 잠시 멈춰 있어요.')).toBeNull()
    })

    // 클릭 1: 소희 업무 제어 메뉴 열기
    const menuButton = screen.getByRole('button', { name: '소희 업무 제어 메뉴' })
    fireEvent.click(menuButton)

    // 클릭 2: 긴급 일시 정지 메뉴 아이템 클릭
    const pauseMenuItem = screen.getByRole('menuitem', { name: /소희 업무 잠시 멈추기/ })
    fireEvent.click(pauseMenuItem)

    // 2클릭으로 긴급 정지 호출 확인
    expect(mockToggleAutonomy).toHaveBeenCalledTimes(1)
  })

  it('정말 멈춰 있을 때(isPaused)는 사장님 친화적 말로 안내 배너가 표시된다', async () => {
    currentIsPaused = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-1') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [] }) }
        if (url.includes('vault/summary')) return { ok: true, json: async () => vaultSummaryData }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-1" initialDensity="detailed" />)

    // 멈춰 있을 때 사장님 말로 안내
    expect(await screen.findByText('소희의 업무가 잠시 멈춰 있어요.')).toBeTruthy()
    expect(screen.getByText('사장님이 원하실 때 언제든 다시 시작할 수 있어요.')).toBeTruthy()

    // 안내 배너 내 재개 버튼 클릭
    const resumeButton = screen.getByRole('button', { name: /소희 업무 다시 시작하기/ })
    fireEvent.click(resumeButton)
    expect(mockToggleAutonomy).toHaveBeenCalledTimes(1)
  })

  it('보관함 요약 조회 실패 시 빈 값이 아니라 오류 문구로 표시된다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-1') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [] }) }
        if (url.includes('vault/summary')) return { ok: false, json: async () => ({}) } // 실패
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-1" initialDensity="detailed" />)

    const vaultSection = await screen.findByRole('region', { name: '보관함 현황' })
    expect(within(vaultSection).getByText('보관함을 불러오지 못했어요 · 잠시 후 다시 시도해 주세요')).toBeTruthy()
  })

  it('요청 실패 시 적절한 안내와 다시 불러오기 버튼을 제공한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    render(<TodayHome workspaceId="ws-1" initialDensity="detailed" />)
    expect(await screen.findByText('오늘의 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(screen.getByText('최근 게시물을 확인할 수 없어요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('게시 상태 코드만으로 공통 주간 기록의 실제 게시 수를 늘리지 않는다', async () => {
    const publishedPost = {
      ...awaitingPost,
      status: 'PUBLISHED_VERIFIED',
    }
    const zeroVault = {
      stored_count: 0,
      needs_reapproval_count: 0,
      invalidated_count: 0,
      total_count: 0,
      external_action_count: 0,
      this_week_count: 0,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/reports/weekly')) return { ok: true, json: async () => emptyObservedReport('ws-1') }
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [publishedPost] }) }
        if (url.includes('vault/summary')) return { ok: true, json: async () => ({ success: true, data: zeroVault }) }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<TodayHome workspaceId="ws-1" initialDensity="detailed" />)

    const metricsSection = await screen.findByRole('region', { name: '주간 실제 기록' })
    const published = within(metricsSection).getByText('게시 확인').closest('div')!
    expect(within(published).getByText('0건')).toBeTruthy()
    const vaultSection = screen.getByRole('region', { name: '보관함 현황' })
    expect(within(vaultSection).getByText('보관 0건 · 게시 확인은 주간 기록에서 확인해 주세요')).toBeTruthy()
    expect(screen.getByText('게시 결과 상세 확인')).toBeTruthy()

  })
})
