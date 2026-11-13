import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { CanonicalCustomer360SummaryCard } from '@/components/v089/canonical-customer-360-summary-card'
import { MissionTraceExplorerView } from '@/features/operator-missions/mission-trace-explorer-view'
import { CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID } from '../customer-360-canonical-service'
import type { Customer360Profile } from '../customer-360-canonical-service'
import type { MissionTraceView } from '../mission-trace-projection'

describe('Admin Commercial Operations UX 2.0 (ANI-1198)', () => {
  const mockCustomer360Profile: Customer360Profile = {
    identity: {
      workspaceId: CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID,
      displayName: '바이름',
      ownerEmail: 'admin@example.com',
      isProduction: true,
      badgeLabel: 'PRODUCTION_PRIMARY',
      status: 'ACTIVE',
    },
    metrics: {
      missionsCount: 1,
      contentsCount: 1,
      approvalsCount: 1,
      publishReceiptsCount: 1,
      reservationsCount: 1,
      totalVerifiedRevenueKrw: 200000,
    },
    recentMissions: [
      {
        id: 'msn-byreum-golden-001',
        goal: '이번 주 평일 오후 예약 공백을 줄이고 자연눈썹 신규 문의와 예약을 늘려줘.',
        status: 'NEXT_ACTION_READY',
        traceId: 'trc-golden-001',
        createdAt: '2026-09-10T00:00:00.000Z',
      },
    ],
  }

  const mockMissionTrace: MissionTraceView = {
    missionId: 'msn-byreum-golden-001',
    workspaceId: CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID,
    traceId: 'trc-golden-001',
    overallStatus: 'NEXT_ACTION_READY',
    goal: '이번 주 평일 오후 예약 공백을 줄이고 자연눈썹 신규 문의와 예약을 늘려줘.',
    totalObservedStages: 8,
    generatedAt: '2026-09-10T00:00:00.000Z',
    stages: [
      {
        stageIndex: 1,
        stageName: 'USER_REQUEST',
        title: '원장님 마케팅 요청',
        actorBadge: 'USER',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:01:00.000Z',
        evidenceRef: 'proof://db/user_messages/msg-001',
      },
      {
        stageIndex: 2,
        stageName: 'AGENT_PLANNING',
        title: '소희 AI 마케팅 미션 및 전략 수립',
        actorBadge: 'AGENT',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:02:00.000Z',
        evidenceRef: 'mission:msn-byreum-golden-001',
      },
      {
        stageIndex: 3,
        stageName: 'CONTENT_PRODUCED',
        title: '맞춤 마케팅 콘텐츠 및 에셋 생성 완료',
        actorBadge: 'AGENT',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:03:00.000Z',
        evidenceRef: 'proof://db/content_versions/ver-001',
      },
      {
        stageIndex: 4,
        stageName: 'EXACT_APPROVAL',
        title: '원장님 정밀 버전 승인 완료',
        actorBadge: 'USER',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:04:00.000Z',
        evidenceRef: 'proof://db/approvals/appr-001',
      },
      {
        stageIndex: 5,
        stageName: 'PROVIDER_PUBLISH',
        title: '외부 채널 실제 발행 완료',
        actorBadge: 'PROVIDER',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:05:00.000Z',
        evidenceRef: 'https://www.instagram.com/p/DBYREUM12345/',
      },
      {
        stageIndex: 6,
        stageName: 'INBOUND_CUSTOMER',
        title: '고객 인바운드 반응/댓글/DM 감지',
        actorBadge: 'CUSTOMER',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:06:00.000Z',
        evidenceRef: 'proof://webhook/meta/12345',
      },
      {
        stageIndex: 7,
        stageName: 'BOOKING_CONFIRMED',
        title: '예약 슬롯 원자적 락 확정',
        actorBadge: 'DB',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:07:00.000Z',
        evidenceRef: 'proof://db/reservations/res-001',
      },
      {
        stageIndex: 8,
        stageName: 'NEXT_ACTION_READY',
        title: '차기 추천 행동 수립',
        actorBadge: 'AGENT',
        status: 'OBSERVED',
        occurredAt: '2026-09-10T00:08:00.000Z',
        evidenceRef: 'proof://db/learning_candidates/plc-001',
      },
    ],
  }

  it('1. MUST render CanonicalCustomer360SummaryCard with authoritative production tenant identity and verified metrics', () => {
    render(React.createElement(CanonicalCustomer360SummaryCard, { profile: mockCustomer360Profile }))

    // Identity bar assertions
    expect(screen.getByText('바이름')).toBeDefined()
    expect(screen.getByText('PRODUCTION_PRIMARY')).toBeDefined()
    expect(screen.getByText('(00000000-0000-4000-8000-0000000000a2)')).toBeDefined()
    expect(screen.getByText('admin@example.com')).toBeDefined()

    // Verified metrics assertions
    expect(screen.getByText('200,000')).toBeDefined()
    expect(screen.getByText('검증 매출')).toBeDefined()
    expect(screen.getByText('확정 예약')).toBeDefined()

    // Direct trace link assertion
    const traceLinks = screen.getAllByRole('link', { name: /Trace 타임라인|최신 미션 트레이스 보기/i })
    expect(traceLinks.length).toBeGreaterThanOrEqual(1)
    expect(traceLinks[0].getAttribute('href')).toContain('/admin/missions/msn-byreum-golden-001')
  })

  it('2. MUST render MissionTraceExplorerView with 8-stage timeline and all 5 observed actor badges', () => {
    render(React.createElement(MissionTraceExplorerView, {
      trace: mockMissionTrace,
      identity: mockCustomer360Profile.identity,
    }))

    // Korean operator copy only: no internal codes or raw trace ids
    expect(screen.getByText(/8대 관측 단계 타임라인/)).toBeDefined()
    expect(screen.queryByText('PRODUCTION_PRIMARY')).toBeNull()
    expect(screen.queryByText(/trc-golden-001/)).toBeNull()
    for (let stage = 1; stage <= 8; stage++) expect(screen.getAllByText(new RegExp(`단계 ${stage}$`)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/원장님\(사용자\)/).length).toBeGreaterThan(0)
    expect(screen.getByText(/인바운드 고객/)).toBeDefined()
    // External evidence stays a real link
    expect(document.querySelector('a[href="https://www.instagram.com/p/DBYREUM12345/"]')).not.toBeNull()
  })
})
