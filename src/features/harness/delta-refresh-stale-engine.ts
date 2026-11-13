/**
 * SOHEE Harness Knowledge OS — Delta Refresh & Stale Lifecycle Engine (v1.1)
 * Enforces:
 * 1. Normalized Source Hash comparison for incremental (Delta) refresh
 * 2. 70% cheaper credit cost for Delta Refresh
 * 3. 30-day Inactivity STALE detection & Confidence Downgrade
 */

import { HarnessAsset, HarnessVersion, HarnessStatus } from '@/types/harness'

export interface DeltaCheckResult {
  isStale: boolean
  daysSinceLastAnalysis: number
  hasSourceChanged: boolean
  recommendedAction: 'NONE' | 'DELTA_REFRESH' | 'FULL_REBUILD'
  estimatedCreditCost: number
}

export class DeltaRefreshStaleEngine {
  private STALE_THRESHOLD_DAYS = 30

  /**
   * 1. 하네스 수명주기 및 STALE 여부 판정
   */
  public evaluateStaleStatus(asset: HarnessAsset): {
    status: HarnessStatus
    isStale: boolean
    daysSinceLastAnalysis: number
  } {
    const lastAnalyzed = new Date(asset.lastAnalyzedAt || asset.createdAt).getTime()
    const now = Date.now()
    const daysSince = Math.floor((now - lastAnalyzed) / (1000 * 60 * 60 * 24))

    const isStale = daysSince >= this.STALE_THRESHOLD_DAYS
    const status: HarnessStatus = isStale ? 'STALE' : asset.overallStatus

    return {
      status,
      isStale,
      daysSinceLastAnalysis: daysSince
    }
  }

  /**
   * 2. Source Hash 비교를 통한 Delta Refresh 여부 및 크레딧 견적 계산
   */
  public checkDeltaNeed(
    latestVersion: HarnessVersion,
    currentSourceHash: string,
    previousSourceHash: string,
    daysSinceLastAnalysis: number
  ): DeltaCheckResult {
    const hasSourceChanged = currentSourceHash !== previousSourceHash
    const isStale = daysSinceLastAnalysis >= this.STALE_THRESHOLD_DAYS

    if (!hasSourceChanged && !isStale) {
      return {
        isStale: false,
        daysSinceLastAnalysis,
        hasSourceChanged: false,
        recommendedAction: 'NONE',
        estimatedCreditCost: 0
      }
    }

    if (hasSourceChanged && !isStale) {
      return {
        isStale: false,
        daysSinceLastAnalysis,
        hasSourceChanged: true,
        recommendedAction: 'DELTA_REFRESH',
        estimatedCreditCost: 80 // 70% cheaper than 240 SC
      }
    }

    return {
      isStale: true,
      daysSinceLastAnalysis,
      hasSourceChanged,
      recommendedAction: 'FULL_REBUILD',
      estimatedCreditCost: 240
    }
  }

  /**
   * 3. STALE 상태일 때 자동 게시용 Confidence 다운그레이드
   */
  public getEffectiveConfidence(version: HarnessVersion, isStale: boolean): number {
    if (!isStale) return version.confidence
    // 30% confidence penalty for stale rules
    return Math.max(40, Math.round(version.confidence * 0.7))
  }
}

export const deltaRefreshStaleEngine = new DeltaRefreshStaleEngine()
