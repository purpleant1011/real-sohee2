/**
 * Media Lifecycle Retention & Golden Test Hygiene (ANI-1108)
 *
 * Enforces lifecycle transitions:
 * ACTIVE → SUPERSEDED/FAILED → RETENTION_HOLD → CLEANUP_ELIGIBLE → DELETED
 * - Prevents deletion of media referenced in active approvals, publish receipts, or evidence
 * - Reconciles orphan storage objects and missing DB entries
 * - Enforces golden test isolation from customer analytics metrics
 */

export type MediaLifecycleState =
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'FAILED'
  | 'RETENTION_HOLD'
  | 'CLEANUP_ELIGIBLE'
  | 'DELETED'

export interface MediaAssetRetentionContext {
  mediaAssetId: string
  status: 'READY' | 'CORRUPT' | 'FAILED' | 'REVOKED'
  isApproved: boolean
  isPublished: boolean
  isEvidenceReferenced: boolean
  createdAt: string
  supersededAt?: string | null
}

export interface DeletionEligibilityResult {
  eligible: boolean
  nextState: MediaLifecycleState
  reason: string
}

const RETENTION_WINDOW_HOURS = 72

export function evaluateMediaDeletionEligibility(
  context: MediaAssetRetentionContext,
  now = new Date()
): DeletionEligibilityResult {
  // Absolute rule: Never delete media referenced in approvals, publications, or evidence
  if (context.isApproved || context.isPublished || context.isEvidenceReferenced) {
    return {
      eligible: false,
      nextState: 'RETENTION_HOLD',
      reason:
        'Referenced in active approval, publish receipt, or release evidence; deletion strictly forbidden.',
    }
  }

  // Active uncorrupted assets are retained
  if (context.status === 'READY' && !context.supersededAt) {
    return {
      eligible: false,
      nextState: 'ACTIVE',
      reason: 'Asset is active and in ready state.',
    }
  }

  // Calculate age since superseded or creation
  const baseTime = context.supersededAt
    ? new Date(context.supersededAt).getTime()
    : new Date(context.createdAt).getTime()
  const ageHours = (now.getTime() - baseTime) / (1000 * 60 * 60)

  if (ageHours < RETENTION_WINDOW_HOURS) {
    return {
      eligible: false,
      nextState: 'RETENTION_HOLD',
      reason: `Asset is in retention cooling hold (${ageHours.toFixed(1)}h / ${RETENTION_WINDOW_HOURS}h required).`,
    }
  }

  return {
    eligible: true,
    nextState: 'CLEANUP_ELIGIBLE',
    reason: 'Asset is superseded/failed and exceeds retention window.',
  }
}

export interface StorageOrphanReconciliationResult {
  orphanStoragePaths: string[]
  missingStoragePaths: string[]
  healthyCount: number
}

export function reconcileStorageOrphans(
  storageObjectPaths: string[],
  dbAssetObjectPaths: string[]
): StorageOrphanReconciliationResult {
  const dbPathSet = new Set(dbAssetObjectPaths)
  const storagePathSet = new Set(storageObjectPaths)

  const orphanStoragePaths = storageObjectPaths.filter((path) => !dbPathSet.has(path))
  const missingStoragePaths = dbAssetObjectPaths.filter((path) => !storagePathSet.has(path))
  const healthyCount = dbAssetObjectPaths.filter((path) => storagePathSet.has(path)).length

  return {
    orphanStoragePaths,
    missingStoragePaths,
    healthyCount,
  }
}

export interface ProductionPostEntity {
  id: string
  workspaceId: string
  caption: string
  testRunId?: string | null
  isTestPost?: boolean | null
  purpose?: string | null
  impressions?: number
  likes?: number
}

/**
 * Ensures test posts from golden journeys and CI verification do not pollute
 * actual production marketing KPI reports.
 */
export function isProductionCustomerMetricsEligible(post: ProductionPostEntity): boolean {
  if (post.testRunId) return false
  if (post.isTestPost === true) return false
  if (post.purpose === 'E2E_TEST' || post.purpose === 'GOLDEN_JOURNEY') return false

  return true
}

export function filterCustomerMetricPosts(posts: ProductionPostEntity[]): ProductionPostEntity[] {
  return posts.filter(isProductionCustomerMetricsEligible)
}
