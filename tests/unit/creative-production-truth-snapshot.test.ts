import { describe, it, expect } from 'vitest'
import {
  ProductionTruthSnapshotEvaluator,
  type CreativeAssetProductionTruthSnapshot,
} from '@/lib/runtime-truth/creative-production-truth-snapshot'

describe('Production Truth Snapshot & Evidence Matrix Automation (ANI-1069)', () => {
  const baseValidSnapshot: CreativeAssetProductionTruthSnapshot = {
    releaseCommitSha: 'dfb6022b',
    deployId: 'dep-v10-001',
    workspaceId: 'ws-bakery-01',
    contentId: 'cnt-100',
    versionId: 'ver-200',
    visualBriefDigest: 'b'.repeat(64),
    mediaAssetId: 'asset-tart-01',
    mediaSha256: 'a'.repeat(64),
    creativeBundleFingerprint: 'f'.repeat(64),
    approvalId: 'app-300',
    externalActionId: 'act-400',
    externalReceiptId: 'rcpt-500',
    providerPostId: 'ig_12345678',
    providerPermalink: 'https://www.instagram.com/p/C-xyz123/',
    observedAt: new Date().toISOString(),
    state: 'SUCCESS',
    verificationEvidence: {
      perceptualEquivalence: true,
      captionDigestMatched: true,
      securityAdvisorErrorCount: 0,
      staticStockCount: 0,
    },
  }

  it('evaluates valid fresh production snapshot as SUCCESS and isGreen = true', () => {
    const verdict = ProductionTruthSnapshotEvaluator.evaluateSnapshot(baseValidSnapshot)

    expect(verdict.isValid).toBe(true)
    expect(verdict.isGreen).toBe(true)
    expect(verdict.state).toBe('SUCCESS')
    expect(verdict.violations).toHaveLength(0)
  })

  it('rejects stale snapshot (>15 minutes old) from being evaluated as green', () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const staleSnapshot: CreativeAssetProductionTruthSnapshot = {
      ...baseValidSnapshot,
      observedAt: staleTime,
    }

    const verdict = ProductionTruthSnapshotEvaluator.evaluateSnapshot(staleSnapshot)
    expect(verdict.isValid).toBe(false)
    expect(verdict.isGreen).toBe(false)
    expect(verdict.state).toBe('STALE')
    expect(verdict.violations.some((v) => v.includes('STALE_EVIDENCE_DISALLOWED'))).toBe(true)
  })

  it('rejects snapshot when perceptual equivalence failed (9th False-Green protection)', () => {
    const falseGreenSnapshot: CreativeAssetProductionTruthSnapshot = {
      ...baseValidSnapshot,
      verificationEvidence: {
        ...baseValidSnapshot.verificationEvidence,
        perceptualEquivalence: false, // Visual discrepancy!
      },
    }

    const verdict = ProductionTruthSnapshotEvaluator.evaluateSnapshot(falseGreenSnapshot)
    expect(verdict.isValid).toBe(false)
    expect(verdict.isGreen).toBe(false)
    expect(verdict.violations.some((v) => v.includes('PERCEPTUAL_EQUIVALENCE_FAILED'))).toBe(true)
  })

  it('rejects snapshot when security advisor errors exist in DB', () => {
    const insecureSnapshot: CreativeAssetProductionTruthSnapshot = {
      ...baseValidSnapshot,
      verificationEvidence: {
        ...baseValidSnapshot.verificationEvidence,
        securityAdvisorErrorCount: 2, // 2 Security Definer views unclosed!
      },
    }

    const verdict = ProductionTruthSnapshotEvaluator.evaluateSnapshot(insecureSnapshot)
    expect(verdict.isValid).toBe(false)
    expect(verdict.isGreen).toBe(false)
    expect(verdict.violations.some((v) => v.includes('SECURITY_ADVISOR_ERRORS_EXIST'))).toBe(true)
  })
})
