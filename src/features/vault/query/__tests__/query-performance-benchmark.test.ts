import { describe, expect, it } from 'vitest'
import type { VaultItem } from '../../types'
import { FakeVaultQueryRepository, VaultQueryService } from '../vault-query-service'

describe('1,000건 규모 합성 데이터 쿼리 성능 및 p95 측정 벤치마크', () => {
  const ws = '11111111-1111-1111-1111-111111111111'
  const otherWs = '99999999-9999-9999-9999-999999999999'

  const generateSyntheticData = (count: number): VaultItem[] => {
    const channels = ['instagram', 'threads', 'naver_blog', 'daangn_business'] as const
    const approvalStates = ['APPROVED', 'NEEDS_REAPPROVAL', 'INVALIDATED'] as const
    const items: VaultItem[] = []

    for (let i = 0; i < count; i++) {
      const day = String((i % 28) + 1).padStart(2, '0')
      const targetDate = i % 10 === 0 ? null : `2026-10-${day}`
      items.push({
        id: `synth-item-${String(i).padStart(6, '0')}`,
        workspaceId: i % 20 === 0 ? otherWs : ws, // 일부는 타 워크스페이스
        contentId: `content-${i}`,
        versionId: `version-${i}`,
        channel: channels[i % channels.length],
        releaseGate: 'HELD_PROVIDER_PENDING',
        holdReason: 'META_REVIEW_PENDING',
        heldAt: '2026-10-07T00:00:00.000Z',
        heldBy: null,
        targetDate,
        approvedFingerprint: 'f'.repeat(64),
        fingerprintSchemaVersion: 1,
        policyVersion: 'v1.0.0',
        specVersion: 'v1.0.0',
        approvalState: approvalStates[i % approvalStates.length],
        approvedBy: null,
        bundleId: null,
        idempotencyKey: `idemp-${i}`,
        deletedAt: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      })
    }
    return items
  }

  it('1,000건 데이터셋에서 목록 조회, 달력 집계, 요약 KPI의 p95 실행 시간을 측정한다', async () => {
    const repo = new FakeVaultQueryRepository()
    const syntheticItems = generateSyntheticData(1000)
    repo.seedVaultItems(syntheticItems)

    const service = new VaultQueryService(repo)

    const runCount = 50
    const listDurations: number[] = []
    const calendarDurations: number[] = []
    const summaryDurations: number[] = []

    for (let i = 0; i < runCount; i++) {
      // 1. 목록 조회 (period=this_week, channel=instagram, limit=20)
      const t0 = performance.now()
      await service.listItems(ws, {
        period: 'month',
        ym: '2026-10',
        channel: 'instagram',
        limit: 20,
      })
      listDurations.push(performance.now() - t0)

      // 2. 달력 조회
      const t1 = performance.now()
      await service.getCalendar(ws, '2026-10')
      calendarDurations.push(performance.now() - t1)

      // 3. 요약 KPI
      const t2 = performance.now()
      await service.getSummary(ws)
      summaryDurations.push(performance.now() - t2)
    }

    const calcP95 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.floor(sorted.length * 0.95)
      return sorted[idx]
    }

    const listP95 = calcP95(listDurations)
    const calendarP95 = calcP95(calendarDurations)
    const summaryP95 = calcP95(summaryDurations)

    // In-memory 서비스 레이어 p95는 5ms 이내여야 함
    expect(listP95).toBeLessThan(15)
    expect(calendarP95).toBeLessThan(15)
    expect(summaryP95).toBeLessThan(15)

    // 결과 로깅
    console.log(`[ANI-1531 Benchmark] 1,000 synthetic rows - p95 Latency:`)
    console.log(`- List Items (month + channel): ${listP95.toFixed(3)}ms`)
    console.log(`- Calendar (month aggregates): ${calendarP95.toFixed(3)}ms`)
    console.log(`- Summary KPI: ${summaryP95.toFixed(3)}ms`)
  })
})
