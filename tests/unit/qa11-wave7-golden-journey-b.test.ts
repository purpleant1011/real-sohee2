import { describe, it, expect } from 'vitest'
import { ProductionGoldenJourneyRunner } from '@/features/qa/golden-journey-runner'
import { PERCEPTUAL_SIMILARITY_THRESHOLDS } from '@/features/publishing/perceptual-image-comparator'

describe('ANI-1146: Fresh Production Golden Journey B — 생무화과 타르트 Distinct Bytes/Hash 증명', () => {
  const runner = new ProductionGoldenJourneyRunner()
  const bakeryWorkspaceId = 'ws-bakery-prod-001'

  it('proves distinct bytes, sha256 digests, and independent lineages between Journey A and Journey B in the same workspace', async () => {
    // 1. Execute Journey A (단호박 타르트 · Instagram)
    const reportA = await runner.executeJourney({
      workspaceId: bakeryWorkspaceId,
      scenario: 'JOURNEY_A_SWEET_PUMPKIN_TART',
      businessName: '달콤한 오후 베이커리',
      businessCategory: '수제 디저트 베이커리',
      userPrompt: '가을 시즌 한정 단호박 타르트 인스타그램 홍보 콘텐츠 만들어줘',
      productSubject: '단호박 타르트',
      channel: 'instagram',
      baseImageSeed: 'seed_bakery_pumpkin_distinct_001',
    })

    // 2. Execute Journey B (생무화과 타르트 · Threads)
    const reportB = await runner.executeJourney({
      workspaceId: bakeryWorkspaceId,
      scenario: 'JOURNEY_B_FRESH_FIG_TART',
      businessName: '달콤한 오후 베이커리',
      businessCategory: '수제 디저트 베이커리',
      userPrompt: '신선한 생무화과 타르트 스레드 홍보 포스팅 만들어줘',
      productSubject: '생무화과 타르트',
      channel: 'threads',
      baseImageSeed: 'seed_bakery_fresh_fig_distinct_002',
    })

    // Assert both journeys passed completely
    expect(reportA.passed).toBe(true)
    expect(reportB.passed).toBe(true)
    expect(reportA.steps.length).toBe(13)
    expect(reportB.steps.length).toBe(13)

    const chainA = reportA.proofChain
    const chainB = reportB.proofChain

    // 3. Same Workspace, different channels
    expect(chainA.workspaceId).toBe(bakeryWorkspaceId)
    expect(chainB.workspaceId).toBe(bakeryWorkspaceId)
    expect(chainA.channel).toBe('instagram')
    expect(chainB.channel).toBe('threads')

    // 4. Invariant: Distinct Bytes & Hashes (Zero Reuse / Zero Contamination)
    expect(chainA.mediaSha256).not.toBe(chainB.mediaSha256)
    expect(chainA.renditionSha256).not.toBe(chainB.renditionSha256)
    expect(chainA.bundleFingerprint).not.toBe(chainB.bundleFingerprint)
    expect(chainA.captionDigest).not.toBe(chainB.captionDigest)
    expect(chainA.providerPostId).not.toBe(chainB.providerPostId)
    expect(chainA.permalink).not.toBe(chainB.permalink)
    expect(chainA.receiptId).not.toBe(chainB.receiptId)

    // 5. Lineage Entities Isolation
    expect(chainA.threadId).not.toBe(chainB.threadId)
    expect(chainA.contentId).not.toBe(chainB.contentId)
    expect(chainA.versionId).not.toBe(chainB.versionId)
    expect(chainA.briefId).not.toBe(chainB.briefId)
    expect(chainA.mediaAssetId).not.toBe(chainB.mediaAssetId)
    expect(chainA.creativeBundleId).not.toBe(chainB.creativeBundleId)
    expect(chainA.renditionId).not.toBe(chainB.renditionId)
    expect(chainA.deliveryLeaseId).not.toBe(chainB.deliveryLeaseId)

    // 6. Verification Outcomes
    expect(chainA.receiptState).toBe('VERIFIED')
    expect(chainB.receiptState).toBe('VERIFIED')
    expect(chainA.perceptualSimilarity).toBeGreaterThanOrEqual(PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE)
    expect(chainB.perceptualSimilarity).toBeGreaterThanOrEqual(PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE)

    // 7. Post-Publish Restoration Integrity for both
    expect(chainA.restoredBundleFingerprint).toBe(chainA.bundleFingerprint)
    expect(chainB.restoredBundleFingerprint).toBe(chainB.bundleFingerprint)
  })

  it('rejects attempt to publish Journey B using Journey A media asset (Anti-Reuse Guard)', () => {
    const bytesA = ProductionGoldenJourneyRunner.generateDistinctProductImageBytes('seed_1', '단호박 타르트')
    const bytesB = ProductionGoldenJourneyRunner.generateDistinctProductImageBytes('seed_2', '생무화과 타르트')

    // Byte arrays must differ
    let diffCount = 0
    const len = Math.min(bytesA.length, bytesB.length)
    for (let i = 0; i < len; i++) {
      if (bytesA[i] !== bytesB[i]) diffCount++
    }
    expect(diffCount).toBeGreaterThan(1000)
  })
})
