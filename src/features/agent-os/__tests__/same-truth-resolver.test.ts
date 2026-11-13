import { describe, it, expect } from 'vitest'
import { resolveCanonicalWorkspaceSnapshot } from '../same-truth-resolver'

describe('Same Truth Resolver (ANI-803, ANI-848)', () => {
  it('returns AWAITING_INITIAL_INGESTION when no data has been collected yet', async () => {
    const snapshot = await resolveCanonicalWorkspaceSnapshot({
      workspaceId: 'ws-new',
      businessName: '바이름 뷰티샵',
      rawMetrics: {
        hasDataEverBeenCollected: false,
      },
    })

    expect(snapshot.workspaceId).toBe('ws-new')
    expect(snapshot.metrics.collectionStatus).toBe('AWAITING_INITIAL_INGESTION')
    expect(snapshot.metrics.customerCount).toBeNull()
    expect(snapshot.metrics.reservationCount).toBeNull()
    expect(snapshot.metrics.collectionStatusLabel).toBe('첫 데이터 수집 대기 중')
  })

  it('returns READY and numeric values when data has been collected and is fresh', async () => {
    const now = new Date()
    const snapshot = await resolveCanonicalWorkspaceSnapshot({
      workspaceId: 'ws-active',
      businessName: '바이름 뷰티샵',
      rawMetrics: {
        hasDataEverBeenCollected: true,
        customerCount: 42,
        reservationCount: 15,
        conversionRate: 12.5,
        lastMetricsUpdatedAt: now.toISOString(),
      },
    })

    expect(snapshot.metrics.collectionStatus).toBe('READY')
    expect(snapshot.metrics.customerCount).toBe(42)
    expect(snapshot.metrics.reservationCount).toBe(15)
    expect(snapshot.metrics.conversionRate).toBe(12.5)
    expect(snapshot.metrics.collectionStatusLabel).toBe('정상 수집 완료')
  })

  it('marks metrics as STALE when last update exceeds threshold', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const snapshot = await resolveCanonicalWorkspaceSnapshot({
      workspaceId: 'ws-stale',
      rawMetrics: {
        hasDataEverBeenCollected: true,
        customerCount: 10,
        lastMetricsUpdatedAt: twoHoursAgo,
      },
    })

    expect(snapshot.metrics.collectionStatus).toBe('STALE')
    expect(snapshot.metrics.collectionStatusLabel).toContain('이전 수집 데이터 (갱신 대기)')
  })

  it('embeds canonical runtime status and dependency health into the snapshot', async () => {
    const snapshot = await resolveCanonicalWorkspaceSnapshot({
      workspaceId: 'ws-integrated',
      runtimeInput: {
        hasActiveRun: true,
        isPaused: false,
        creditBalance: 100,
        hasReadyPlugin: true,
      },
    })

    expect(snapshot.runtimeStatus.primaryState).toBe('RUNNING')
    expect(snapshot.runtimeStatus.badgeLabel).toBe('자율 근무 중')
    expect(snapshot.dependencyHealth.dependencies).toHaveLength(8)
    expect(snapshot.formattedTimeKst).toBeDefined()
  })
})
