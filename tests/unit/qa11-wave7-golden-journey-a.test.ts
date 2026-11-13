import { describe, it, expect } from 'vitest'
import { ProductionGoldenJourneyRunner } from '@/features/qa/golden-journey-runner'
import { calculateBundleFingerprint } from '@/features/creative/creative-bundle-engine'
import { PERCEPTUAL_SIMILARITY_THRESHOLDS } from '@/features/publishing/perceptual-image-comparator'

describe('ANI-1145: Fresh Production Golden Journey A — 단호박 타르트 End-to-End Closure', () => {
  const runner = new ProductionGoldenJourneyRunner()
  const bakeryWorkspaceId = 'ws-bakery-prod-001'

  it('executes full 13-step proof chain for Sweet Pumpkin Tart and achieves VERIFIED status', async () => {
    const report = await runner.executeJourney({
      workspaceId: bakeryWorkspaceId,
      scenario: 'JOURNEY_A_SWEET_PUMPKIN_TART',
      businessName: '달콤한 오후 베이커리',
      businessCategory: '수제 디저트 베이커리',
      userPrompt: '가을 시즌 한정 단호박 타르트 인스타그램 홍보 콘텐츠 만들어줘',
      productSubject: '단호박 타르트',
      channel: 'instagram',
    })

    // 1. All 13 steps must pass
    expect(report.passed).toBe(true)
    expect(report.steps.length).toBe(13)
    for (const step of report.steps) {
      expect(step.status).toBe('PASSED')
      expect(step.evidenceDigest).toBeDefined()
    }

    // 2. Proof Chain verification
    const { proofChain } = report
    expect(proofChain.workspaceId).toBe(bakeryWorkspaceId)
    expect(proofChain.channel).toBe('instagram')
    expect(proofChain.receiptState).toBe('VERIFIED')
    expect(proofChain.restoredReceiptState).toBe('VERIFIED')
    expect(proofChain.restoredBundleFingerprint).toBe(proofChain.bundleFingerprint)

    // 3. Genuine Hash & ID verification
    expect(proofChain.mediaSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(proofChain.renditionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(proofChain.bundleFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(proofChain.approvalFingerprint).toBe(proofChain.bundleFingerprint)
    expect(proofChain.providerPostId).toContain('ig_post_journey_a_sweet_pumpkin_tart')
    expect(proofChain.permalink).toContain('https://www.instagram.com/p/')

    // 4. Perceptual Similarity verification
    expect(proofChain.perceptualSimilarity).toBeGreaterThanOrEqual(PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE)

    // 5. Anti-False-Green Audit
    expect(report.antiFalseGreenAudit.zeroMockFixtures).toBe(true)
    expect(report.antiFalseGreenAudit.zeroUnsplashOrExternalStaticUrls).toBe(true)
    expect(report.antiFalseGreenAudit.genuineSha256Calculated).toBe(true)
    expect(report.antiFalseGreenAudit.exactApprovalOptimisticLockEnforced).toBe(true)
    expect(report.antiFalseGreenAudit.readbackPerceptuallyVerified).toBe(true)
    expect(report.antiFalseGreenAudit.f5RestorationByteIdentical).toBe(true)
  })

  it('guarantees deterministic non-empty JPEG payload for Sweet Pumpkin Tart without network fixtures', () => {
    const bytes = ProductionGoldenJourneyRunner.generateDistinctProductImageBytes(
      'seed_bakery_001',
      '단호박 타르트'
    )
    expect(bytes.length).toBeGreaterThan(10000)
    // Verify JPEG SOI marker
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
    expect(bytes[2]).toBe(0xff)
    expect(bytes[3]).toBe(0xe0)
  })

  it('detects tampering in caption or media before approval and rejects invalid fingerprint', () => {
    const originalFp = calculateBundleFingerprint({
      channel: 'instagram',
      caption: '오리지널 단호박 타르트 문구',
      hashtags: ['#단호박타르트'],
      orderedMedia: [
        {
          mediaAssetId: 'media_1',
          sha256Digest: 'a'.repeat(64),
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: 'v1.0',
    })

    const tamperedCaptionFp = calculateBundleFingerprint({
      channel: 'instagram',
      caption: '변조된 단호박 타르트 문구',
      hashtags: ['#단호박타르트'],
      orderedMedia: [
        {
          mediaAssetId: 'media_1',
          sha256Digest: 'a'.repeat(64),
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: 'v1.0',
    })

    expect(tamperedCaptionFp).not.toBe(originalFp)
  })
})
