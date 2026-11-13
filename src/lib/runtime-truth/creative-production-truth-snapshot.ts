/**
 * Production Truth Snapshot & Evidence Matrix Automation (ANI-1069)
 * Guarantees unified, immutable evidence across DB, App, Provider, Admin, and Meta surfaces.
 */

export type TruthSnapshotState = 'SUCCESS' | 'EMPTY' | 'STALE' | 'ERROR'

export interface CreativeAssetProductionTruthSnapshot {
  releaseCommitSha: string
  deployId: string
  workspaceId: string
  contentId: string
  versionId: string
  visualBriefDigest: string
  mediaAssetId: string
  mediaSha256: string
  creativeBundleFingerprint: string
  approvalId: string
  externalActionId: string
  externalReceiptId: string
  providerPostId: string
  providerPermalink: string
  observedAt: string
  state: TruthSnapshotState
  staleReason?: string
  verificationEvidence: {
    perceptualEquivalence: boolean
    captionDigestMatched: boolean
    securityAdvisorErrorCount: number
    staticStockCount: number
  }
}

export interface SnapshotEvaluationVerdict {
  isValid: boolean
  state: TruthSnapshotState
  isGreen: boolean
  violations: string[]
  evaluatedAt: string
}

export class ProductionTruthSnapshotEvaluator {
  private static readonly MAX_FRESHNESS_MS = 15 * 60 * 1000 // 15 minutes

  public static evaluateSnapshot(
    snapshot: CreativeAssetProductionTruthSnapshot,
    currentTime = new Date().toISOString()
  ): SnapshotEvaluationVerdict {
    const violations: string[] = []
    const now = new Date(currentTime).getTime()
    const observed = new Date(snapshot.observedAt).getTime()

    // 1. Freshness check
    if (isNaN(observed) || (now - observed) > this.MAX_FRESHNESS_MS) {
      violations.push('STALE_EVIDENCE_DISALLOWED: Snapshot observed timestamp is older than max freshness budget')
    }

    // 2. Structural identity & linkage checks
    if (!snapshot.workspaceId || snapshot.workspaceId.trim() === '') {
      violations.push('MISSING_WORKSPACE_ID: Workspace identity required')
    }

    if (!snapshot.mediaAssetId || !snapshot.mediaSha256 || snapshot.mediaSha256.length !== 64) {
      violations.push('MEDIA_ASSET_INTEGRITY_VIOLATION: Valid canonical media asset and 64-char SHA256 required')
    }

    if (!snapshot.creativeBundleFingerprint || snapshot.creativeBundleFingerprint.length !== 64) {
      violations.push('CREATIVE_BUNDLE_FINGERPRINT_MISSING: Canonical creative bundle fingerprint required')
    }

    if (!snapshot.providerPostId || !snapshot.providerPermalink) {
      violations.push('PROVIDER_POST_REFERENCE_MISSING: Live provider post ID and permalink required')
    }

    // 3. Evidence integrity checks (Anti-False-Green)
    if (!snapshot.verificationEvidence.perceptualEquivalence) {
      violations.push('PERCEPTUAL_EQUIVALENCE_FAILED: External post image differs visually from canonical media')
    }

    if (!snapshot.verificationEvidence.captionDigestMatched) {
      violations.push('CAPTION_DIGEST_MISMATCH: External post caption differs from approved bundle caption')
    }

    if (snapshot.verificationEvidence.staticStockCount > 0) {
      violations.push('STATIC_STOCK_MEDIA_DETECTED: Forbidden static or stock fallback was detected')
    }

    if (snapshot.verificationEvidence.securityAdvisorErrorCount > 0) {
      violations.push('SECURITY_ADVISOR_ERRORS_EXIST: Unresolved database security errors block release')
    }

    const hasViolations = violations.length > 0
    let finalState: TruthSnapshotState = snapshot.state

    if (violations.some(v => v.startsWith('STALE_EVIDENCE_DISALLOWED'))) {
      finalState = 'STALE'
    } else if (hasViolations) {
      finalState = 'ERROR'
    } else if (!snapshot.contentId || !snapshot.mediaAssetId) {
      finalState = 'EMPTY'
    } else {
      finalState = 'SUCCESS'
    }

    return {
      isValid: !hasViolations && finalState === 'SUCCESS',
      state: finalState,
      isGreen: !hasViolations && finalState === 'SUCCESS',
      violations,
      evaluatedAt: currentTime,
    }
  }
}
