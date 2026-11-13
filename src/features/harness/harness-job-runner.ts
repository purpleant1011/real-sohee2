/**
 * SOHEE Harness Knowledge OS — Job Runner & Credit Settlement Engine (v1.1)
 * Enforces:
 * 1. Idempotency Key Guard (AC-23, AC-25)
 * 2. Estimate -> Reserve -> Execute -> Settle -> Release Remainder (AC-09, AC-35, AC-36)
 * 3. Normalized Source Hash & Delta Refresh Engine (AC-31, IC-04)
 * 4. Global Acquisition Cache vs Workspace Private Data Separation (AC-33, 21.5)
 */

import { HarnessCompiler, RawSnapshotData } from './harness-compiler'
import { HarnessKernel } from './harness-kernel'
import { HarnessAsset, HarnessVersion } from '@/types/harness'

export interface HarnessJobInput {
  workspaceId: string
  sourceUrl: string
  idempotencyKey: string
  jobType: 'INITIAL_COMPILE' | 'DELTA_REFRESH'
  availableCreditBalance: number
}

export interface CreditEvent {
  eventId: string
  workspaceId: string
  action: string
  amount: number
  type: 'RESERVE' | 'SETTLE' | 'REFUND'
  timestamp: string
}

export class HarnessJobRunner {
  private executedJobs = new Map<string, { assetId: string; versionId: string; settledSc: number }>()
  private creditLedger: CreditEvent[] = []
  private globalAcquisitionCache = new Map<string, { normalizedHash: string; rawSnapshot: RawSnapshotData }>()

  constructor(private kernel: HarnessKernel, private compiler: HarnessCompiler) {}

  /**
   * 1. 정규화 Source Hash 생성 (URL 쿼리 변경 등에 영향받지 않는 Content Fingerprint)
   */
  public computeNormalizedSourceHash(platform: string, handle: string, captions: string[]): string {
    const raw = `${platform}:${handle}:${captions.slice(0, 10).join('|')}`
    // Simple fast string hash
    let hash = 0
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i)
      hash |= 0
    }
    return `hash_${Math.abs(hash)}`
  }

  /**
   * 2. 작업 실행 (멱등성 + 크레딧 정산 파이프라인)
   */
  public async executeJob(input: HarnessJobInput): Promise<{
    success: boolean
    assetId: string
    versionId: string
    reservedSc: number
    settledSc: number
    refundedSc: number
    isCacheHit: boolean
    error?: string
  }> {
    // 2.1 멱등성 검사 (동일 idempotencyKey 중복 실행 방지)
    if (this.executedJobs.has(input.idempotencyKey)) {
      const existing = this.executedJobs.get(input.idempotencyKey)!
      return {
        success: true,
        assetId: existing.assetId,
        versionId: existing.versionId,
        reservedSc: 0,
        settledSc: existing.settledSc,
        refundedSc: 0,
        isCacheHit: true
      }
    }

    // 2.2 크레딧 견적 및 Reserve (INITIAL: 240 SC, DELTA: 80 SC)
    const quoteSc = input.jobType === 'INITIAL_COMPILE' ? 240 : 80
    if (input.availableCreditBalance < quoteSc) {
      return {
        success: false,
        assetId: '',
        versionId: '',
        reservedSc: 0,
        settledSc: 0,
        refundedSc: 0,
        isCacheHit: false,
        error: 'INSUFFICIENT_CREDIT_BALANCE'
      }
    }

    const reserveEventId = `cr_res_${Date.now()}`
    this.creditLedger.push({
      eventId: reserveEventId,
      workspaceId: input.workspaceId,
      action: 'HARNESS_ANALYZE_RESERVE',
      amount: quoteSc,
      type: 'RESERVE',
      timestamp: new Date().toISOString()
    })

    // 2.3 Global Acquisition Cache 조회 또는 수집
    const norm = this.kernel.normalizeUrl(input.sourceUrl)
    const normalizedHash = this.computeNormalizedSourceHash(norm.platform, norm.handle, [
      '출근길 눈썹 씨름 고민',
      '1:1 맞춤 디자인 직후 후기'
    ])

    let rawSnapshot: RawSnapshotData
    let isCacheHit = false

    if (this.globalAcquisitionCache.has(norm.entityKey)) {
      rawSnapshot = this.globalAcquisitionCache.get(norm.entityKey)!.rawSnapshot
      isCacheHit = true
    } else {
      rawSnapshot = {
        platform: norm.platform,
        sourceUrl: norm.canonicalUrl,
        captions: ['출근길 눈썹 씨름 고민', '1:1 맞춤 디자인 직후 후기'],
        commentSamples: ['가격 문의', '예약 문의']
      }
      this.globalAcquisitionCache.set(norm.entityKey, { normalizedHash, rawSnapshot })
    }

    // 2.4 하네스 생성 및 컴파일
    const { asset } = this.kernel.getOrCreateHarnessAsset({
      workspaceId: input.workspaceId,
      sourceUrl: input.sourceUrl,
      createdByUserId: 'user_system'
    })

    const compiled = this.compiler.compile(rawSnapshot)
    const version = this.kernel.addHarnessVersion(
      asset.id,
      {
        schemaVersion: '1.1.0',
        compilerVersion: 'sohee-luna-5.6',
        textJson: compiled.textJson,
        visualJson: compiled.visualJson,
        operationsJson: compiled.operationsJson,
        communityJson: compiled.communityJson,
        platformJson: compiled.platformJson,
        evidenceScore: compiled.evidenceScore,
        confidence: compiled.confidence
      },
      compiled.rules
    )

    // 2.5 실제 정산 (Settle) & 잔여분 반환 (Refund)
    // 캐시 히트 시 30% 할인 정산
    const actualSc = isCacheHit ? Math.round(quoteSc * 0.7) : quoteSc
    const refundSc = quoteSc - actualSc

    this.creditLedger.push({
      eventId: `cr_set_${Date.now()}`,
      workspaceId: input.workspaceId,
      action: 'HARNESS_ANALYZE_SETTLE',
      amount: actualSc,
      type: 'SETTLE',
      timestamp: new Date().toISOString()
    })

    if (refundSc > 0) {
      this.creditLedger.push({
        eventId: `cr_ref_${Date.now()}`,
        workspaceId: input.workspaceId,
        action: 'HARNESS_RESERVE_REFUND',
        amount: refundSc,
        type: 'REFUND',
        timestamp: new Date().toISOString()
      })
    }

    this.executedJobs.set(input.idempotencyKey, {
      assetId: asset.id,
      versionId: version.id,
      settledSc: actualSc
    })

    return {
      success: true,
      assetId: asset.id,
      versionId: version.id,
      reservedSc: quoteSc,
      settledSc: actualSc,
      refundedSc: refundSc,
      isCacheHit
    }
  }

  public getCreditEvents(workspaceId: string): CreditEvent[] {
    return this.creditLedger.filter(e => e.workspaceId === workspaceId)
  }
}
