import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SyncHealthBadge } from '../sync-health-badge'
import type { DependencyHealthReport } from '@/features/agent-os/dependency-health-service'

describe('SyncHealthBadge Component (ANI-849, ANI-871)', () => {
  const healthyReport: DependencyHealthReport = {
    workspaceId: 'ws-test',
    overallStatus: 'HEALTHY',
    headline: '실시간 클라우드 동기화 정상',
    description: '모든 8대 핵심 시스템이 정상 작동 중입니다.',
    dependencies: [
      { key: 'planner', name: '소희 고지능 기획 브레인', status: 'HEALTHY', latencyMs: 15, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'queue', name: '비동기 작업 큐', status: 'HEALTHY', latencyMs: 12, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'plugin_router', name: '외부 채널 & 도구 게이트웨이', status: 'HEALTHY', latencyMs: 20, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'provider', name: '지능형 생성 모델 제공자', status: 'HEALTHY', latencyMs: 30, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'event_ingestion', name: '실시간 고객 이벤트 수집기', status: 'HEALTHY', latencyMs: 10, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'credit_ledger', name: '소희 크레딧 정산 원장', status: 'HEALTHY', latencyMs: 18, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'evidence_store', name: '실행 증거 및 성과 저장소', status: 'HEALTHY', latencyMs: 22, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
      { key: 'scheduler', name: '24시간 자율 업무 스케줄러', status: 'HEALTHY', latencyMs: 14, lastCheckedAt: '2026-09-06T06:00:00Z', message: '정상 작동 중' },
    ],
    checkedAt: '2026-09-06T06:00:00Z',
    snapshotVersion: 'snap-1',
  }

  const degradedReport: DependencyHealthReport = {
    ...healthyReport,
    overallStatus: 'DEGRADED',
    headline: '일부 의존성 응답 지연',
    description: '일부 외부 채널의 응답이 지연되고 있습니다.',
    dependencies: healthyReport.dependencies.map((d) =>
      d.key === 'plugin_router'
        ? { ...d, status: 'DEGRADED', message: '외부 채널 응답 지연 발생' }
        : d
    ),
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders healthy status badge correctly', () => {
    render(<SyncHealthBadge workspaceId="ws-test" initialReport={healthyReport} />)
    expect(screen.getByRole('button', { name: '서비스 연결 정상' })).toBeInTheDocument()
  })

  it('renders degraded status badge correctly', () => {
    render(<SyncHealthBadge workspaceId="ws-test" initialReport={degradedReport} />)
    expect(screen.getByRole('button', { name: '서비스 연결 지연' })).toBeInTheDocument()
  })

  it('opens drill-down popover on click and shows 8 dependencies', async () => {
    render(<SyncHealthBadge workspaceId="ws-test" initialReport={healthyReport} />)

    const button = screen.getByRole('button', { name: '서비스 연결 정상' })
    fireEvent.click(button)

    expect(screen.getByRole('dialog', { name: '서비스 연결 상태' })).toBeInTheDocument()
    expect(screen.getByText('소희 고지능 기획 브레인')).toBeInTheDocument()
    expect(screen.getByText('비동기 작업 큐')).toBeInTheDocument()
    expect(screen.getByText('외부 채널 & 도구 게이트웨이')).toBeInTheDocument()
    expect(screen.getByText('지능형 생성 모델 제공자')).toBeInTheDocument()
    expect(screen.getByText('실시간 고객 이벤트 수집기')).toBeInTheDocument()
    expect(screen.getByText('소희 크레딧 정산 원장')).toBeInTheDocument()
    expect(screen.getByText('실행 증거 및 성과 저장소')).toBeInTheDocument()
    expect(screen.getByText('24시간 자율 업무 스케줄러')).toBeInTheDocument()
  })
})
