import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MissionTraceExplorerView } from './mission-trace-explorer-view'

describe('MissionTraceExplorerView', () => {
  it('renders Korean copy and masks raw enums and identifiers', () => {
    render(
      <MissionTraceExplorerView
        trace={{
          missionId: '12345678-0000-0000-0000-000000000001',
          workspaceId: 'ws-1',
          traceId: '87654321-0000-0000-0000-000000000002',
          overallStatus: 'COMPLETED',
          goal: '가을 신메뉴 출시 알림',
          stages: [
            {
              stageIndex: 1,
              stageName: 'USER_REQUEST',
              title: '원장님 목표 발의',
              actorBadge: 'USER',
              status: 'OBSERVED',
              occurredAt: '2026-10-08T09:00:00.000Z',
              evidenceRef: 'req-evidence-1',
            },
            {
              stageIndex: 2,
              stageName: 'PROVIDER_PUBLISH',
              title: '인스타그램 게시',
              actorBadge: 'PROVIDER',
              status: 'NOT_OBSERVED',
              occurredAt: null,
            },
          ],
          totalObservedStages: 1,
          generatedAt: '2026-10-08T10:00:00.000Z',
        }}
        identity={{
          workspaceId: 'ws-1',
          displayName: '바이름 뷰티 살롱',
          ownerEmail: 'byreum@example.com',
          isProduction: true,
          badgeLabel: 'PRODUCTION_PRIMARY',
          status: 'ACTIVE',
        }}
      />
    )

    // Koreanized identity badge (no PRODUCTION_PRIMARY)
    expect(screen.getByText('실운영 매장')).toBeVisible()
    expect(screen.queryByText('PRODUCTION_PRIMARY')).toBeNull()

    // Trace referenceCode
    expect(screen.getByText(/참조번호: 87654321/)).toBeVisible()

    // Korean status badge
    expect(screen.getByText(/상태: 완료됨/)).toBeVisible()

    // Korean stage and actor labels
    expect(screen.getByText('단계 1')).toBeVisible()
    expect(screen.getByText('원장님(사용자)')).toBeVisible()
    expect(screen.getByText('관측됨')).toBeVisible()

    expect(screen.getByText('단계 2')).toBeVisible()
    expect(screen.getByText('외부 연동(채널)')).toBeVisible()
    expect(screen.getAllByText('미관측').length).toBeGreaterThan(0)
    expect(screen.queryByText(/NOT_OBSERVED/)).toBeNull()
  })
})
