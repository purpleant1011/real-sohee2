import { describe, expect, it } from 'vitest'
import { calculateVaultFunnelMetrics } from '../read-model'
import type { RawFunnelEventRow, VaultFunnelChannel } from '../types'

describe('Vault Funnel Read Model & Metrics Calculation', () => {
  const baseWorkspace = '11111111-1111-4111-8111-111111111111'
  const period = { from: '2026-10-01T00:00:00Z', to: '2026-10-07T23:59:59Z' }

  function row(
    event: string,
    channel: VaultFunnelChannel,
    occurred_at = '2026-10-05T12:00:00Z',
    dedupe_key = `${event}:${channel}:1`,
  ): RawFunnelEventRow {
    return {
      id: 'evt-' + Math.random().toString(36).slice(2),
      workspace_id: baseWorkspace,
      user_id: 'user-1',
      event,
      occurred_at,
      properties: { channel },
      dedupe_key,
    }
  }

  it('returns EMPTY status when there are 0 events in the period', () => {
    const result = calculateVaultFunnelMetrics({
      workspaceId: baseWorkspace,
      period,
      channel: 'instagram',
      rows: [],
    })

    expect(result.status).toBe('EMPTY')
    expect(result.totalEvents).toBe(0)
    expect(result.overallConversionRate).toBeNull()
    for (const stage of result.stages) {
      expect(stage.count).toBe(0)
      expect(stage.conversionRate).toBeNull()
      expect(stage.status).toBe('EMPTY')
    }
  })

  it('calculates exact conversion rates matching raw records without fake values', () => {
    const rows: RawFunnelEventRow[] = [
      // 10 preview_opened
      ...Array.from({ length: 10 }, (_, i) => row('preview_opened', 'instagram', undefined, `prev:${i}`)),
      // 8 vault_saved (80% from preview)
      ...Array.from({ length: 8 }, (_, i) => row('vault_saved', 'instagram', undefined, `saved:${i}`)),
      // 4 vault_edited (50% from saved)
      ...Array.from({ length: 4 }, (_, i) => row('vault_edited', 'instagram', undefined, `edit:${i}`)),
      // 3 reapproved (75% from edited)
      ...Array.from({ length: 3 }, (_, i) => row('reapproved', 'instagram', undefined, `reapp:${i}`)),
      // 2 release_requested (25% from saved)
      ...Array.from({ length: 2 }, (_, i) => row('release_requested', 'instagram', undefined, `rel:${i}`)),
      // 1 publish_verified (50% from release_requested)
      ...Array.from({ length: 1 }, (_, i) => row('publish_verified', 'instagram', undefined, `pub:${i}`)),
    ]

    const result = calculateVaultFunnelMetrics({
      workspaceId: baseWorkspace,
      period,
      channel: 'instagram',
      rows,
    })

    expect(result.status).toBe('OK')
    expect(result.totalEvents).toBe(28)

    const [preview, saved, edited, reapproved, requested, verified] = result.stages

    expect(preview).toMatchObject({
      event: 'preview_opened',
      count: 10,
      conversionRate: 100.0,
      status: 'VERIFIED',
    })
    expect(saved).toMatchObject({
      event: 'vault_saved',
      count: 8,
      previousStageCount: 10,
      conversionRate: 80.0,
      status: 'VERIFIED',
    })
    expect(edited).toMatchObject({
      event: 'vault_edited',
      count: 4,
      previousStageCount: 8,
      conversionRate: 50.0,
      status: 'VERIFIED',
    })
    expect(reapproved).toMatchObject({
      event: 'reapproved',
      count: 3,
      previousStageCount: 4,
      conversionRate: 75.0,
      status: 'VERIFIED',
    })
    expect(requested).toMatchObject({
      event: 'release_requested',
      count: 2,
      previousStageCount: 8,
      conversionRate: 25.0,
      status: 'VERIFIED',
    })
    expect(verified).toMatchObject({
      event: 'publish_verified',
      count: 1,
      previousStageCount: 2,
      conversionRate: 50.0,
      status: 'VERIFIED',
    })

    // Overall: 1 / 10 = 10.0%
    expect(result.overallConversionRate).toBe(10.0)
  })

  it('marks missing previous stages as NOT_VERIFIED and null conversion rate rather than fake 0%', () => {
    // Only vault_saved occurred, but NO preview_opened recorded (e.g. legacy or skipped)
    const rows: RawFunnelEventRow[] = [
      row('vault_saved', 'threads'),
      row('release_requested', 'threads'),
    ]

    const result = calculateVaultFunnelMetrics({
      workspaceId: baseWorkspace,
      period,
      channel: 'threads',
      rows,
    })

    expect(result.status).toBe('OK')
    const [preview, saved] = result.stages

    expect(preview.count).toBe(0)
    expect(preview.conversionRate).toBeNull()
    expect(preview.status).toBe('EMPTY')

    // Since preview count was 0, vault_saved has denominator 0 -> NOT_VERIFIED, NOT fake 0.0%
    expect(saved.count).toBe(1)
    expect(saved.previousStageCount).toBe(0)
    expect(saved.conversionRate).toBeNull()
    expect(saved.status).toBe('NOT_VERIFIED')
  })

  it('filters rows accurately when channel is specified vs ALL', () => {
    const rows: RawFunnelEventRow[] = [
      row('vault_saved', 'instagram'),
      row('vault_saved', 'threads'),
      row('vault_saved', 'naver_blog'),
    ]

    const instaResult = calculateVaultFunnelMetrics({
      workspaceId: baseWorkspace,
      period,
      channel: 'instagram',
      rows,
    })
    expect(instaResult.stages.find(s => s.event === 'vault_saved')?.count).toBe(1)

    const allResult = calculateVaultFunnelMetrics({
      workspaceId: baseWorkspace,
      period,
      channel: 'ALL',
      rows,
    })
    expect(allResult.stages.find(s => s.event === 'vault_saved')?.count).toBe(3)
  })
})
