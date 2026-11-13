import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PcTodayHome } from '../pc-today-home'
import type { MobileHomeDto } from '@/features/mobile-decision/contracts'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-app-shell">{children}</div>,
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isPaused: false,
    actualMode: 'RUNNING',
    isLoading: false,
    toggleAutonomy: vi.fn(),
  }),
}))

const mockHomeView: MobileHomeDto = {
  workspaceId: 'ws-pc',
  businessName: '바이름 청라점',
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-11-07T12:00:00Z',
  agent: { state: 'ready', data: { label: '소희 자율근무 중', detailHref: '/app/settings' }, observedAt: null, validUntil: null },
  decisions: {
    state: 'ready',
    data: {
      items: [
        {
          id: 'dec-1',
          kind: 'comment_reply',
          title: '댓글 승인 요청',
          targetLabel: 'instagram',
          createdAt: '2026-11-07T10:00:00Z',
          expiresAt: null,
        },
      ],
      total: 1,
      complete: true,
    },
    observedAt: null,
    validUntil: null,
  },
  activity: {
    state: 'ready',
    data: [
      {
        id: 'act-1',
        title: '신규 예약 접수 확인',
        statusLabel: '확인됨',
        observedAt: '2026-11-07T11:00:00Z',
        evidenceRef: null,
      },
    ],
    observedAt: null,
    validUntil: null,
  },
  results: {
    state: 'ready',
    data: [
      { id: 'published', label: '게시 확인', value: 5, unit: '건', state: 'ready', evidenceRef: 'p1', datasetMode: 'ACTUAL', period: null },
      { id: 'bookings', label: '예약 확정', value: 3, unit: '건', state: 'ready', evidenceRef: 'b1', datasetMode: 'ACTUAL', period: null },
      { id: 'revenue', label: '확인된 매출', value: 350000, unit: '원', state: 'ready', evidenceRef: 'r1', datasetMode: 'ACTUAL', period: null },
    ],
    observedAt: null,
    validUntil: null,
  },
}

vi.mock('@/features/mobile-decision/use-mobile-home', () => ({
  useMobileHome: () => ({
    view: mockHomeView,
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
}))

describe('PcTodayHome (PC 3열 관제 화면 대시보드 통합 테스트)', () => {
  it('1440px 3열 관제 화면의 핵심 요소(왼쪽 확인/활동, 가운데 성과, 오른쪽 지휘 독)를 모두 렌더링한다', () => {
    render(<PcTodayHome workspaceId="ws-pc" />)

    // 헤더 영역
    expect(screen.getByRole('heading', { level: 1, name: /바이름 청라점/ })).toBeInTheDocument()

    // 1열 (왼쪽 큰 열): 지금 확인할 일 + 소희가 한 일
    expect(screen.getByText('지금 확인할 일')).toBeInTheDocument()
    expect(screen.getByText('댓글 승인 요청')).toBeInTheDocument()
    expect(screen.getByText('소희가 한 일')).toBeInTheDocument()
    expect(screen.getByText('신규 예약 접수 확인')).toBeInTheDocument()

    // 2열 (가운데 열): 이번 주 성과 요약
    expect(screen.getByText('이번 주 성과')).toBeInTheDocument()
    expect(screen.getByText('게시 확인')).toBeInTheDocument()
    expect(screen.getByText('5건')).toBeInTheDocument()
    expect(screen.getByText('예약 확정')).toBeInTheDocument()
    expect(screen.getByText('3건')).toBeInTheDocument()
    expect(screen.getByText('확인된 매출')).toBeInTheDocument()
    expect(screen.getByText('350,000원')).toBeInTheDocument()

    // 3열 (오른쪽 열): 일 맡기기 + 사진 CTA + 바로가기
    expect(screen.getByText('소희에게 일 맡기기')).toBeInTheDocument()
    expect(screen.getByText('사진으로 글 만들기')).toBeInTheDocument()
    expect(screen.getByText('소통함')).toBeInTheDocument()
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
    expect(screen.getByText('예약 일정')).toBeInTheDocument()
    expect(screen.getByText('보관함')).toBeInTheDocument()
  })

  it('기존 PC 홈의 8대 핵심 기능(표시밀도, 오늘할일 1개, 승인센터, 보관함요약, 최근게시물, 로드맵, 고급접이식, 로딩/오류)을 누락 없이 렌더링한다', async () => {
    const canonicalModel = {
      success: true,
      data: {
        businessName: { value: '바이름 청라점', state: 'AVAILABLE' },
        channels: [{ channel: 'instagram', isAuthorized: true, connectionStatus: 'verified' }],
        recentActionsCount: 1,
      },
    }
    const awaitingPost = {
      missionId: 'post-1',
      status: 'AWAITING_APPROVAL',
      topic: '가을 신규 이벤트',
      createdAt: '2026-10-06T12:00:00Z',
      imageUrl: null,
      receipts: {},
    }
    const vaultSummaryData = {
      success: true,
      data: {
        stored_count: 5,
        needs_reapproval_count: 0,
        invalidated_count: 0,
        total_count: 5,
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

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [awaitingPost] }) }
        if (url.includes('vault/summary')) return { ok: true, json: async () => vaultSummaryData }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        if (url.includes('home/approvals')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                items: [],
                summary: { total: 0, commentPending: 0, dmPending: 0, contentPending: 0 },
                autonomyLevel: 'L2',
                autoHandledCount: 0,
                autoHandledLabel: '소희가 처리 중',
              },
            }),
          }
        }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<PcTodayHome workspaceId="ws-pc" initialDensity="detailed" />)

    // 1. 헤더 표시 밀도 토글
    expect(screen.getByRole('radio', { name: '상세' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '간략' })).toBeInTheDocument()

    // 2. 3열 위 전체 폭 "오늘 할 일 1개" 영웅 카드
    const todaySection = await screen.findByRole('region', { name: '오늘 할 일' })
    expect(todaySection).toBeInTheDocument()
    expect(screen.getByText('오늘 올릴 글 소희가 준비했어요')).toBeInTheDocument()

    // 3. 소희 빠른 승인 센터 (3열 아래)
    expect(await screen.findByRole('region', { name: '소희 빠른 승인 센터' })).toBeInTheDocument()

    // 4. 보관함 현황 (detailed 모드)
    const vaultSection = await screen.findByRole('region', { name: '보관함 현황' })
    expect(vaultSection).toBeInTheDocument()
    expect(screen.getByText('보관 5건 · 게시 확인은 주간 기록에서 확인해 주세요')).toBeInTheDocument()

    // 5. 최근 게시물 (detailed 모드)
    const postsSection = await screen.findByRole('region', { name: '최근 게시물' })
    expect(postsSection).toBeInTheDocument()
    expect(screen.getByText('가을 신규 이벤트')).toBeInTheDocument()

    // 6. 로드맵 (ComingSoonRoadmap)
    expect(screen.getByText('소희 주요 기능 및 로드맵')).toBeInTheDocument()

    // 7. 자세히 보기(고급) 접이식 버튼 및 펼침 동작
    const advancedButton = screen.getByRole('button', { name: '자세히 보기(고급)' })
    expect(advancedButton).toBeInTheDocument()
    expect(screen.queryByText('자세한 업무 현황')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('게시물이 없을 때 FirstWeekPlan을 표시하고, 고급 접이식을 열면 세부 업무 현황을 보여준다', async () => {
    const canonicalModel = {
      success: true,
      data: {
        businessName: { value: '바이름 청라점', state: 'AVAILABLE' },
        channels: [{ channel: 'instagram', isAuthorized: true, connectionStatus: 'verified' }],
        recentActionsCount: 1,
      },
    }
    const readinessData = {
      readiness: {
        ready: true,
        stage: 'PUBLISH_READY',
        facts: {},
        blockers: [],
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('canonical-read-model')) return { ok: true, json: async () => canonicalModel }
        if (url.includes('quick-post')) return { ok: true, json: async () => ({ items: [] }) } // 빈 게시물
        if (url.includes('vault/summary')) return { ok: true, json: async () => ({ success: true, data: { stored_count: 0 } }) }
        if (url.includes('sohee-ready')) return { ok: true, json: async () => readinessData }
        if (url.includes('home/approvals')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                items: [],
                summary: { total: 0, commentPending: 0, dmPending: 0, contentPending: 0 },
                autonomyLevel: 'L2',
                autoHandledCount: 0,
                autoHandledLabel: '소희가 처리 중',
              },
            }),
          }
        }
        return { ok: false, json: async () => ({}) }
      }),
    )

    render(<PcTodayHome workspaceId="ws-pc" initialDensity="compact" />)

    // FirstWeekPlan (소희의 첫 주 계획) 노출 확인
    expect(await screen.findByRole('region', { name: '소희의 첫 주 계획' })).toBeInTheDocument()

    // compact 밀도에서는 보관함 요약과 최근 게시물이 숨겨짐
    expect(screen.queryByRole('region', { name: '보관함 현황' })).toBeNull()
    expect(screen.queryByRole('region', { name: '최근 게시물' })).toBeNull()

    // 고급 접이식 클릭 시 펼쳐짐
    const advancedButton = screen.getByRole('button', { name: '자세히 보기(고급)' })
    advancedButton.click()
    expect(await screen.findByText('자세한 업무 현황')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '자세히 보기(고급) 접기' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('데이터 로드 실패 시 에러 안내와 다시 불러오기 버튼을 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))

    render(<PcTodayHome workspaceId="ws-pc" initialDensity="detailed" />)

    expect(await screen.findByText('오늘의 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
