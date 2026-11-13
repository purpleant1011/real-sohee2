'use client'

import React, { useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { WorkspaceProvider, type WorkspaceContextValue } from '@/components/workspace/workspace-provider'
import { PcTodayHome } from '@/components/home-today/pc/pc-today-home'
import type { MobileHomeDto } from '@/features/mobile-decision/contracts'

export type PreviewState = 'full' | 'empty' | 'error'

const WORKSPACE_ID = 'ws-example'
const BUSINESS_NAME = '예시 가게'

const FULL_MOBILE_HOME: MobileHomeDto = {
  workspaceId: WORKSPACE_ID,
  businessName: BUSINESS_NAME,
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-11-08T09:00:00Z',
  agent: {
    state: 'ready',
    data: { label: '소희 자율근무 중', detailHref: '/app/settings' },
    observedAt: '2026-11-08T09:00:00Z',
    validUntil: null,
  },
  decisions: {
    state: 'ready',
    data: {
      items: [
        {
          id: 'dec-1',
          kind: 'comment_reply',
          title: '인스타그램 댓글 답변 확인 필요',
          targetLabel: '인스타그램 · 가을 시즌 메뉴 문의',
          createdAt: '2026-11-08T08:30:00Z',
          expiresAt: null,
        },
        {
          id: 'dec-2',
          kind: 'dm_reply',
          title: '단체 예약 가능 여부 DM 확인',
          targetLabel: 'DM · 이번 주 토요일 8명',
          createdAt: '2026-11-08T08:00:00Z',
          expiresAt: null,
        },
      ],
      total: 2,
      complete: true,
    },
    observedAt: '2026-11-08T09:00:00Z',
    validUntil: null,
  },
  activity: {
    state: 'ready',
    data: [
      {
        id: 'act-1',
        title: '오늘의 인스타그램 피드 게시 완료',
        statusLabel: '게시 완료',
        observedAt: '2026-11-08T07:30:00Z',
        evidenceRef: 'post-pub-1',
      },
      {
        id: 'act-2',
        title: '네이버 예약 2건 정상 접수 안내',
        statusLabel: '확인됨',
        observedAt: '2026-11-08T06:40:00Z',
        evidenceRef: 'booking-1',
      },
    ],
    observedAt: '2026-11-08T09:00:00Z',
    validUntil: null,
  },
  results: {
    state: 'ready',
    data: [
      { id: 'published', label: '게시 확인', value: 5, unit: '건', state: 'ready', evidenceRef: 'p1', datasetMode: 'ACTUAL', period: null },
      { id: 'bookings', label: '예약 확정', value: 3, unit: '건', state: 'ready', evidenceRef: 'b1', datasetMode: 'ACTUAL', period: null },
      { id: 'revenue', label: '확인된 매출', value: 420000, unit: '원', state: 'ready', evidenceRef: 'r1', datasetMode: 'ACTUAL', period: null },
    ],
    observedAt: '2026-11-08T09:00:00Z',
    validUntil: null,
  },
}

const EMPTY_MOBILE_HOME: MobileHomeDto = {
  workspaceId: WORKSPACE_ID,
  businessName: BUSINESS_NAME,
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-11-08T09:00:00Z',
  agent: {
    state: 'ready',
    data: { label: '소희 자율근무 중', detailHref: '/app/settings' },
    observedAt: null,
    validUntil: null,
  },
  decisions: {
    state: 'ready',
    data: { items: [], total: 0, complete: true },
    observedAt: null,
    validUntil: null,
  },
  activity: {
    state: 'ready',
    data: [],
    observedAt: null,
    validUntil: null,
  },
  results: {
    state: 'ready',
    data: [
      { id: 'published', label: '게시 확인', value: 0, unit: '건', state: 'ready', evidenceRef: 'p0', datasetMode: 'ACTUAL', period: null },
      { id: 'bookings', label: '예약 확정', value: 0, unit: '건', state: 'ready', evidenceRef: 'b0', datasetMode: 'ACTUAL', period: null },
      { id: 'revenue', label: '확인된 매출', value: 0, unit: '원', state: 'ready', evidenceRef: 'r0', datasetMode: 'ACTUAL', period: null },
    ],
    observedAt: null,
    validUntil: null,
  },
}

function createJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Mock fetch handler according to active state
function getMockResponse(url: string, currentState: PreviewState): Response {
  if (currentState === 'error') {
    return createJsonResponse({ error: '서버 에러가 발생했습니다.' }, 500)
  }

  const isEmpty = currentState === 'empty'

  if (url.includes('/mobile-home')) {
    return createJsonResponse(isEmpty ? EMPTY_MOBILE_HOME : FULL_MOBILE_HOME)
  }

  if (url.includes('/agent/control')) {
    return createJsonResponse({
      workspaceId: WORKSPACE_ID,
      desiredMode: 'RUNNING',
      actualMode: 'RUNNING',
      version: 1,
      killSwitchActive: false,
      updatedAt: '2026-11-08T09:00:00Z',
      activeActionRunCount: isEmpty ? 0 : 1,
    })
  }

  if (url.includes('/canonical-read-model')) {
    return createJsonResponse({
      success: true,
      data: {
        businessName: { value: BUSINESS_NAME, state: 'AVAILABLE' },
        channels: isEmpty
          ? []
          : [
              { channel: 'instagram', isAuthorized: true, connectionStatus: 'verified' },
              { channel: 'threads', isAuthorized: true, connectionStatus: 'verified' },
            ],
        recentActionsCount: isEmpty ? 0 : 5,
      },
    })
  }

  if (url.includes('/quick-post')) {
    return createJsonResponse({
      items: isEmpty
        ? []
        : [
            {
              missionId: 'post-101',
              status: 'AWAITING_APPROVAL',
              topic: '신선한 원두와 함께하는 주말 스페셜 브루잉',
              createdAt: '2026-11-08T08:00:00Z',
              imageUrl: '/brand/sohee-character-v1.png',
              receipts: {},
            },
            {
              missionId: 'post-102',
              status: 'PUBLISHED',
              topic: '11월 첫째 주 시즈널 베이커리 라인업',
              createdAt: '2026-11-07T14:00:00Z',
              imageUrl: null,
              receipts: {},
            },
          ],
    })
  }

  if (url.includes('/vault/summary')) {
    return createJsonResponse({
      success: true,
      data: {
        stored_count: isEmpty ? 0 : 8,
        needs_reapproval_count: 0,
        invalidated_count: 0,
        total_count: isEmpty ? 0 : 8,
        external_action_count: 0,
        external_action_warning: null,
        this_week_count: isEmpty ? 0 : 3,
      },
    })
  }

  if (url.includes('/customers/pipeline')) {
    return createJsonResponse({
      kpis: {
        inquiryCount: isEmpty ? 0 : 4,
        bookedCount: isEmpty ? 0 : 3,
      },
    })
  }

  if (url.includes('/sohee-ready')) {
    return createJsonResponse({
      readiness: {
        ready: !isEmpty,
        stage: isEmpty ? 'CONNECT_REQUIRED' : 'PUBLISH_READY',
        facts: isEmpty
          ? {}
          : {
              INSTAGRAM_VERIFIED: { verified: true },
              THREADS_VERIFIED: { verified: true },
              BUSINESS_VERIFIED: { verified: true },
              BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true },
              TEXT_HARNESS_CONFIRMED: { verified: true },
              IMAGE_HARNESS_CONFIRMED: { verified: true },
              OPERATING_POLICY_CONFIRMED: { verified: true },
            },
        blockers: isEmpty ? ['INSTAGRAM_REQUIRED'] : [],
        trialAutoPublishEnabled: !isEmpty,
      },
    })
  }

  if (url.includes('/home/approvals')) {
    return createJsonResponse({
      success: true,
      data: {
        items: isEmpty
          ? []
          : [
              {
                id: 'appr-1',
                category: 'comment_reply',
                targetLabel: '인스타그램 · 댓글 답변',
                goldenTimeLabel: '골든타임 15분',
                urgency: '즉시 확인 권장',
                sourceSnippet: '주말 예약 가능한가요?',
                draftSnippet: '네 사장님! 주말 예약은 네이버 플레이스 및 DM으로 편하게 신청 가능합니다.',
                fullCaption: '네 사장님! 주말 예약은 네이버 플레이스 및 DM으로 편하게 신청 가능합니다. 정성껏 모시겠습니다.',
                hashtags: ['#예시가게', '#주말예약'],
              },
              {
                id: 'appr-2',
                category: 'post_publish',
                targetLabel: '인스타그램 · 피드 게시',
                sourceSnippet: null,
                draftSnippet: '따뜻한 커피 한 잔과 달콤한 디저트로 채우는 여유로운 주말',
                fullCaption: '따뜻한 커피 한 잔과 달콤한 디저트로 채우는 여유로운 주말 어떠세요? 매일 아침 구워내는 고소한 빵이 준비되어 있습니다.',
                hashtags: ['#카페스타그램', '#예시가게', '#디저트맛집'],
              },
            ],
        summary: isEmpty
          ? { total: 0, posts: 0, dms: 0, comments: 0 }
          : { total: 2, posts: 1, dms: 0, comments: 1 },
        autonomyLevel: 'L2',
        autoHandledCount: isEmpty ? 0 : 4,
        autoHandledLabel: isEmpty ? '' : '소희가 일상 댓글 4건을 규칙대로 자동 완료했어요',
        knowledgeStatus: { needsKnowledgePrompt: false },
      },
    })
  }

  if (url.includes('/reports/weekly')) {
    return createJsonResponse({
      workspaceId: WORKSPACE_ID,
      generatedAt: '2026-11-08T09:00:00Z',
      period: '2026-11-01~2026-11-08',
      periodLabel: '11월 1일 ~ 11월 8일',
      datasetMode: 'ACTUAL',
      executiveSummary: isEmpty
        ? '이번 주 집계된 활동이 아직 없습니다.'
        : '이번 주 확인된 예약 3건과 게시 5건이 완료되었습니다.\n고객 문의 응답률이 지난주 대비 향상되었습니다.',
      metrics: {
        bookingConfirmed: { state: 'OBSERVED', count: isEmpty ? 0 : 3, evidenceIds: isEmpty ? [] : ['b1', 'b2', 'b3'] },
        verifiedPublishedPosts: { state: 'OBSERVED', count: isEmpty ? 0 : 5, evidenceIds: isEmpty ? [] : ['p1', 'p2', 'p3', 'p4', 'p5'] },
        revenue: { state: 'OBSERVED', count: isEmpty ? 0 : 420000, evidenceIds: isEmpty ? [] : ['r1'] },
        paymentCapturedVerified: { state: 'OBSERVED', count: isEmpty ? 0 : 60000, evidenceIds: isEmpty ? [] : ['pay1'] },
        bookingCanceled: { state: 'OBSERVED', count: 0, evidenceIds: [] },
        publicationPending: { state: 'OBSERVED', count: isEmpty ? 0 : 1, evidenceIds: isEmpty ? [] : ['pend1'] },
        storedComments: { state: 'OBSERVED', count: isEmpty ? 0 : 12, evidenceIds: [] },
        visitCompletedVerified: { state: 'OBSERVED', count: isEmpty ? 0 : 2, evidenceIds: isEmpty ? [] : ['v1', 'v2'] },
        hoursSaved: { state: 'UNKNOWN', count: 0, evidenceIds: [] },
        costSavedWon: { state: 'UNKNOWN', count: 0, evidenceIds: [] },
      },
    })
  }

  if (url.includes('/credit-balance')) {
    return createJsonResponse({ success: true, balance: 100 })
  }

  if (url.includes('/sync-health')) {
    return createJsonResponse({ success: true, status: 'HEALTHY' })
  }

  if (url.includes('/workspaces')) {
    return createJsonResponse({
      success: true,
      workspaces: [{ id: WORKSPACE_ID, name: BUSINESS_NAME, role: 'owner' }],
    })
  }

  if (url.includes('/engagement/policy')) {
    return createJsonResponse({ success: true })
  }

  // Fallback for any other API calls
  return createJsonResponse({ success: true, data: null })
}

function getCurrentStateFromBrowser(): PreviewState {
  if (typeof window === 'undefined') return 'full'
  const params = new URLSearchParams(window.location.search)
  const state = params.get('state')
  if (state === 'empty' || state === 'error' || state === 'full') return state
  return 'full'
}

function installMockFetch() {
  if (typeof window === 'undefined') return
  if ((window as any).__pcHomeMockFetchInstalled) return
  (window as any).__pcHomeMockFetchInstalled = true

  const originalFetch = window.fetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (rawUrl.includes('/api/')) {
      const activeState = getCurrentStateFromBrowser()
      return getMockResponse(rawUrl, activeState)
    }
    return originalFetch(input, init)
  }
}

// 렌더 전 즉각 실행
if (typeof window !== 'undefined') {
  installMockFetch()
}

export function PcHomePreview({ state = 'full' }: { state?: PreviewState }) {
  installMockFetch()

  const searchParams = useSearchParams()
  const router = useRouter()

  const queryState = (searchParams?.get('state') as PreviewState) || state || 'full'
  const currentState: PreviewState = ['full', 'empty', 'error'].includes(queryState) ? queryState : 'full'

  const workspaceValue: WorkspaceContextValue = useMemo(
    () => ({
      workspaceId: WORKSPACE_ID,
      workspaceName: BUSINESS_NAME,
      workspaceKind: 'retail',
      membershipRole: 'owner',
      actorId: 'usr-example-owner',
      resolutionSource: 'explicit-selection',
      workspaceCanSwitch: false,
      conversationWorkbenchEnabled: false,
    }),
    [],
  )

  const handleStateChange = (nextState: PreviewState) => {
    router.push(`/dev/pc-home?state=${nextState}`)
  }

  return (
    <WorkspaceProvider value={workspaceValue}>
      {/* Dev preview control banner */}
      <div className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background/95 px-6 py-2.5 backdrop-blur-md shadow-xs">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            DEV PREVIEW
          </span>
          <span className="text-xs font-semibold text-foreground">
            PC 3열 홈 시각 검수용 하네스 (가게: {BUSINESS_NAME})
          </span>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 p-1 text-xs">
          <span className="px-2 text-muted-foreground font-medium">상태 전환:</span>
          {(['full', 'empty', 'error'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleStateChange(s)}
              className={`rounded-md px-2.5 py-1 font-semibold transition-all cursor-pointer ${
                currentState === s
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Actual PC Today Home component */}
      <div key={currentState}>
        <PcTodayHome workspaceId={WORKSPACE_ID} initialDensity="compact" />
      </div>
    </WorkspaceProvider>
  )
}
