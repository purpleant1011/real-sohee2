import { describe, expect, it } from 'vitest'
import { buildOperatorRiskOverview, buildOperatorRiskOverviewFromAggregates } from './risk-repository'

const workspaceId = '48000000-0000-4000-8000-000000000001'
const base = { workspaceId, workspaceName: '고객사', lifecycle: { state: 'ready' as const, missing: [], sourceTimestamp: '2026-08-23T00:00:00.000Z' }, channels: [{ channel: 'instagram', status: 'error', updatedAt: '2026-08-23T00:00:00.000Z' }], publishing: [{ channel: 'instagram', displayState: 'failure', freshness: 'fresh' as const, approvalStatus: null, currentVersionId: null, approvedVersionId: null }], billing: { state: 'ready', balanceState: 'empty', available: null, sourceTimestamp: null }, audit: [{ action: 'publish.retry.applied', result: 'failed', createdAt: '2026-08-23T00:00:00.000Z', freshness: 'fresh' as const }], support: [{ status: 'active', startedAt: '2026-08-23T00:00:00.000Z', expiresAt: '2026-08-23T00:30:00.000Z' }] }

describe('operator risk repository', () => {
  it('derives observed high-risk items with safe deep links and source freshness', () => {
    const result = buildOperatorRiskOverview([base], new Date('2026-08-23T00:10:00.000Z'))
    expect(result.items.some((item) => item.title === '게시 실패' && item.fact_kind === 'observed' && item.severity === 'critical')).toBe(true)
    expect(result.items.every((item) => item.href === '/admin' || item.href.startsWith('/admin/'))).toBe(true)
    expect(result.summary.critical).toBeGreaterThan(0)
  })

  it('keeps unavailable sources unknown instead of inventing normal or zero values', () => {
    const result = buildOperatorRiskOverview([{ ...base, channels: null, publishing: null, billing: null, audit: null, support: null, lifecycle: { state: 'unknown', missing: [], sourceTimestamp: null } }], new Date('2026-08-23T00:10:00.000Z'))
    expect(result.items.every((item) => item.fact_kind === 'unknown' && item.severity === 'unknown')).toBe(true)
    expect(result.summary.state).toBe('unknown')
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|provider|0원|0건/iu)
  })

  it('preserves system stale freshness and flags expired support sessions as high observed risk', () => {
    const result = buildOperatorRiskOverviewFromAggregates({
      workspaces: [{ workspaceId, workspaceName: '고객사', workspaceStatus: 'active' }],
      lifecycle: [], channels: [], publishing: [{ workspaceId, channel: 'instagram', displayState: 'failure', freshness: 'fresh', approvalStatus: null, currentVersionId: null, approvedVersionId: null }],
      billing: [{ workspaceId, state: 'ready', balanceState: 'fresh', available: 10, sourceTimestamp: '2026-08-23T00:00:00.000Z' }], audit: [], support: [{ workspaceId, status: 'active', startedAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-23T00:05:00.000Z' }],
      system: [{ source: 'queue', state: 'degraded', freshness: 'stale', observedAt: '2026-08-22T00:00:00.000Z', safeCode: 'QUEUE_STALE' }],
    }, new Date('2026-08-23T00:10:00.000Z'))
    expect(result.items.some((item) => item.title === '지원 세션 접근 차단 확인 필요' && item.severity === 'high' && item.fact_kind === 'observed')).toBe(true)
    expect(result.items.some((item) => item.id === 'system:queue' && item.freshness === 'stale')).toBe(true)
    expect(result.items.some((item) => item.id.startsWith(`${workspaceId}:support:`) && item.source_timestamp === '2026-08-22T00:00:00.000Z' && item.freshness === 'stale')).toBe(true)
    expect(result.summary.cardMetadata.overall.freshness).toBe('stale')
    expect(result.summary.activeCount).toBe(1)
  })

  it('separates publish failure, approval pending, and approval rejection', () => {
    const result = buildOperatorRiskOverview([{
      ...base,
      publishing: [
        { channel: 'instagram', displayState: 'failure', freshness: 'fresh', approvalStatus: null, currentVersionId: null, approvedVersionId: null },
        { channel: 'threads', displayState: 'pending', freshness: 'fresh', approvalStatus: null, currentVersionId: null, approvedVersionId: null },
        { channel: 'naver_blog', displayState: 'success', freshness: 'fresh', approvalStatus: 'rejected', currentVersionId: null, approvedVersionId: null },
      ],
    }], new Date('2026-08-23T00:10:00.000Z'))
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '게시 실패', severity: 'critical' }),
      expect.objectContaining({ title: '승인 필요 · 대기', severity: 'medium' }),
      expect.objectContaining({ title: '승인 거절 검토 필요', severity: 'high' }),
    ]))
  })

  it('separates connected zero counts from unavailable source metadata', () => {
    const zero = buildOperatorRiskOverviewFromAggregates({
      workspaces: [], lifecycle: [], channels: [], publishing: [], billing: [], audit: [], support: [], system: [],
    }, new Date('2026-08-23T00:10:00.000Z'))
    expect(zero.summary.activeCount).toBe(0)
    expect(zero.summary.pendingApprovalCount).toBe(0)
    expect(zero.summary.creditRiskCount).toBe(0)
    expect(zero.summary.cardMetadata.activeCustomers).toMatchObject({ sourceLabel: '고객사 원장', observedAt: null, freshness: 'unknown' })

    const unavailable = buildOperatorRiskOverviewFromAggregates({
      workspaces: [], lifecycle: null, channels: null, publishing: null, billing: null, audit: null, support: null, system: null,
      failedSources: ['고객사', '게시', '결제·크레딧'],
    }, new Date('2026-08-23T00:10:00.000Z'))
    expect(unavailable.summary.activeCount).toBeNull()
    expect(unavailable.summary.pendingApprovalCount).toBeNull()
    expect(unavailable.summary.creditRiskCount).toBeNull()
    expect(unavailable.summary.cardMetadata.activeCustomers).toMatchObject({ sourceLabel: '고객사 원장 · 연결 전', freshness: 'unknown' })
    expect(unavailable.summary.cardMetadata.pendingApprovals).toMatchObject({ sourceLabel: '승인·게시 원장 · 연결 전', freshness: 'unknown' })
    expect(unavailable.summary.cardMetadata.creditRisk).toMatchObject({ sourceLabel: '크레딧 원장 · 연결 전', freshness: 'unknown' })
  })
})
