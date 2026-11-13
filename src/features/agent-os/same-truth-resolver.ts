/**
 * Same Truth Resolver (ANI-803, ANI-848)
 * 
 * Invariants:
 * 1. Home, Results, My Sohee, Admin all share the exact same canonical workspace snapshot.
 * 2. If data is not yet collected/synced, NEVER show fake numbers or a misleading '0'
 *    without explicitly stating 'AWAITING_INITIAL_INGESTION'.
 * 3. Incorporates canonical runtime status and dependency health into a single coherent truth.
 */

import {
  resolveCanonicalRuntimeStatus,
  type RuntimeStatusInput,
  type RuntimeStatusResolution,
} from './canonical-runtime-status'
import {
  getWorkspaceDependencyHealth,
  type DependencyHealthReport,
} from './dependency-health-service'
import {
  evaluateFreshness,
  formatCanonicalDateTime,
  type FreshnessAssessment,
} from '@/lib/time/canonical-time'

export type CollectionStatus = 'READY' | 'AWAITING_INITIAL_INGESTION' | 'STALE'

export interface CanonicalWorkspaceMetrics {
  customerCount: number | null
  reservationCount: number | null
  conversionRate: number | null
  roas: number | null
  collectionStatus: CollectionStatus
  collectionStatusLabel: string
}

export interface AppliedRuleItem {
  id: string
  label: string
  sourceType: 'CHARTER' | 'POLICY' | 'HARNESS'
  sourceVersion: string
}

export interface EvidenceItem {
  id: string
  label: string
  channel: string
  verificationState: 'VERIFIED' | 'PENDING' | 'REJECTED'
  verifiedAt: string
  proofUrl?: string
}

export interface CanonicalWorkspaceSnapshot {
  snapshotId: string
  workspaceId: string
  businessName: string
  runtimeStatus: RuntimeStatusResolution
  dependencyHealth: DependencyHealthReport
  metrics: CanonicalWorkspaceMetrics
  appliedRules: AppliedRuleItem[]
  recentEvidence: EvidenceItem[]
  generatedAt: string
  formattedTimeKst: string
  freshness: FreshnessAssessment
}

export interface SnapshotResolutionInput {
  workspaceId: string
  businessName?: string
  runtimeInput?: RuntimeStatusInput
  rawMetrics?: {
    customerCount?: number
    reservationCount?: number
    conversionRate?: number
    roas?: number
    hasDataEverBeenCollected?: boolean
    lastMetricsUpdatedAt?: string
  }
  rules?: AppliedRuleItem[]
  evidence?: EvidenceItem[]
}

/**
 * Resolves a unified CanonicalWorkspaceSnapshot for any consumer (Home, Results, My Sohee, Admin).
 */
export async function resolveCanonicalWorkspaceSnapshot(
  input: SnapshotResolutionInput
): Promise<CanonicalWorkspaceSnapshot> {
  const now = new Date()
  const nowIso = now.toISOString()
  const workspaceId = input.workspaceId
  const businessName = input.businessName ?? '나의 소희 마케팅'

  // 1. Resolve Runtime Status SSOT
  const runtimeInput: RuntimeStatusInput = input.runtimeInput ?? {
    hasActiveRun: false,
    isPaused: false,
    creditBalance: 100,
    hasReadyPlugin: true,
  }
  const runtimeStatus = resolveCanonicalRuntimeStatus(runtimeInput)

  // 2. Resolve Dependency Health SSOT
  const dependencyHealth = await getWorkspaceDependencyHealth(workspaceId)

  // 3. Resolve Metrics SSOT & Collection Status
  const raw = input.rawMetrics
  const hasCollected = raw?.hasDataEverBeenCollected ?? false

  let metrics: CanonicalWorkspaceMetrics

  if (!hasCollected) {
    metrics = {
      customerCount: null,
      reservationCount: null,
      conversionRate: null,
      roas: null,
      collectionStatus: 'AWAITING_INITIAL_INGESTION',
      collectionStatusLabel: '첫 데이터 수집 대기 중',
    }
  } else {
    const updatedAt = raw?.lastMetricsUpdatedAt ?? nowIso
    const freshness = evaluateFreshness(updatedAt, 60, now)

    metrics = {
      customerCount: raw?.customerCount ?? 0,
      reservationCount: raw?.reservationCount ?? 0,
      conversionRate: raw?.conversionRate ?? 0,
      roas: raw?.roas ?? 0,
      collectionStatus: freshness.isStale ? 'STALE' : 'READY',
      collectionStatusLabel: freshness.isStale
        ? '이전 수집 데이터 (갱신 대기)'
        : '정상 수집 완료',
    }
  }

  // 4. Default rules & evidence if empty
  const appliedRules: AppliedRuleItem[] = input.rules ?? [
    { id: 'rule-harness', label: '비즈니스 헌장 v1.0', sourceType: 'HARNESS', sourceVersion: 'v1.0' },
    { id: 'rule-policy', label: '당일 노쇼 방지 알림 정책', sourceType: 'POLICY', sourceVersion: 'v1.2' },
  ]

  const recentEvidence: EvidenceItem[] = input.evidence ?? []

  // 5. Build snapshot
  const freshness = evaluateFreshness(nowIso, 15, now)
  const formattedTimeKst = formatCanonicalDateTime(now)

  return {
    snapshotId: `snap-${workspaceId}-${now.getTime()}`,
    workspaceId,
    businessName,
    runtimeStatus,
    dependencyHealth,
    metrics,
    appliedRules,
    recentEvidence,
    generatedAt: nowIso,
    formattedTimeKst,
    freshness,
  }
}
