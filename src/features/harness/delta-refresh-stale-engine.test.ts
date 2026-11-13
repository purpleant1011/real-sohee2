import { describe, it, expect } from 'vitest'
import { deltaRefreshStaleEngine } from './delta-refresh-stale-engine'
import { HarnessAsset, HarnessVersion } from '@/types/harness'

describe('DeltaRefreshStaleEngine (ANI-258)', () => {
  it('detects STALE status after 30 days of inactivity and applies confidence penalty', () => {
    const staleAsset: HarnessAsset = {
      id: 'asset_stale_1',
      workspaceId: 'ws_1',
      assetType: 'ATOMIC_SOURCE',
      title: '오래된 하네스',
      visibility: 'PRIVATE',
      overallStatus: 'READY',
      activeVersionId: 'ver_1',
      activeVersionNo: 1,
      platform: 'instagram',
      sourceUrl: 'https://instagram.com/test',
      coreDna: [],
      moduleReadiness: { text: 'READY', visual: 'PARTIAL', operations: 'READY', community: 'PARTIAL', platform: 'READY' },
      dailyEstimatedSc: 100,
      totalSpentSc: 200,
      lastAnalyzedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const res = deltaRefreshStaleEngine.evaluateStaleStatus(staleAsset)
    expect(res.isStale).toBe(true)
    expect(res.status).toBe('STALE')
    expect(res.daysSinceLastAnalysis).toBeGreaterThanOrEqual(35)

    const version: HarnessVersion = {
      id: 'ver_1',
      harnessAssetId: 'asset_stale_1',
      versionNo: 1,
      schemaVersion: '1.1.0',
      compilerVersion: 'sohee-luna-5.6',
      textJson: {} as any,
      visualJson: {} as any,
      operationsJson: {} as any,
      communityJson: {} as any,
      platformJson: {} as any,
      evidenceScore: 90,
      confidence: 90,
      immutable: true,
      createdAt: new Date().toISOString()
    }

    const effectiveConfidence = deltaRefreshStaleEngine.getEffectiveConfidence(version, true)
    expect(effectiveConfidence).toBe(63) // 90 * 0.7
  })

  it('recommends DELTA_REFRESH with 80 SC when source changed within 30 days', () => {
    const res = deltaRefreshStaleEngine.checkDeltaNeed(
      {} as any,
      'hash_new_content',
      'hash_old_content',
      10 // 10 days ago
    )

    expect(res.isStale).toBe(false)
    expect(res.hasSourceChanged).toBe(true)
    expect(res.recommendedAction).toBe('DELTA_REFRESH')
    expect(res.estimatedCreditCost).toBe(80)
  })
})
