import { describe, it, expect } from 'vitest'
import {
  createImageHarnessDraft,
  runImageHarnessTest,
  confirmImageHarnessVersion,
  validateGoldenImageRequirement,
  validateRightsAndConsent,
  evaluateMediaPublishEligibility,
  type ImageReferenceAsset,
  type VisualRules,
  type MediaHarnessLineage,
} from '@/features/image-harness/image-harness-manager'

describe('HF-16 & HF-17: Image Harness Rights & Consent Split Validation', () => {
  it('permits reference asset with OWNED rights and NOT_APPLICABLE consent', () => {
    const asset: ImageReferenceAsset = {
      id: 'img-1',
      workspaceId: 'ws-sample-1',
      storagePath: 'workspaces/ws-sample-1/references/img-1.jpg',
      publicUrl: 'https://cdn.example.com/img-1.jpg',
      category: 'STORE_EXTERIOR',
      caption: '매장 전경',
      positivePoints: ['따뜻한 햇살', '벽돌 외관'],
      negativePoints: ['과도한 역광'],
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
      rightsConfirmedAt: new Date().toISOString(),
      mimeType: 'image/jpeg',
      sortOrder: 1,
      isGolden: true,
      createdAt: new Date().toISOString(),
    }

    const check = validateRightsAndConsent(asset)
    expect(check.eligible).toBe(true)
    expect(check.blocker).toBeUndefined()
  })

  it('permits reference asset with USER_CONFIRMED rights and CONFIRMED portrait consent', () => {
    const asset: ImageReferenceAsset = {
      id: 'img-2',
      workspaceId: 'ws-sample-1',
      storagePath: 'workspaces/ws-sample-1/references/img-2.jpg',
      publicUrl: 'https://cdn.example.com/img-2.jpg',
      category: 'PRODUCT',
      caption: '사장님이 직접 빵을 굽는 모습',
      positivePoints: ['장인정신', '위생적인 복장'],
      rightsStatus: 'USER_CONFIRMED',
      consentStatus: 'CONFIRMED',
      rightsConfirmedAt: new Date().toISOString(),
      mimeType: 'image/jpeg',
      sortOrder: 2,
      isGolden: true,
      createdAt: new Date().toISOString(),
    }

    const check = validateRightsAndConsent(asset)
    expect(check.eligible).toBe(true)
  })

  it('rejects asset with UNKNOWN or PROHIBITED rights', () => {
    const unknownAsset: ImageReferenceAsset = {
      id: 'img-3',
      workspaceId: 'ws-sample-1',
      storagePath: 'workspaces/ws-sample-1/references/img-3.jpg',
      publicUrl: 'https://cdn.example.com/img-3.jpg',
      category: 'ATMOSPHERE',
      rightsStatus: 'UNKNOWN',
      consentStatus: 'NOT_APPLICABLE',
      mimeType: 'image/jpeg',
      sortOrder: 3,
      isGolden: false,
      createdAt: new Date().toISOString(),
    }

    const check = validateRightsAndConsent(unknownAsset)
    expect(check.eligible).toBe(false)
    expect(check.blocker).toBe('RIGHTS_NOT_PERMITTED')
  })

  it('rejects asset with REQUIRED_MISSING portrait likeness consent', () => {
    const missingConsentAsset: ImageReferenceAsset = {
      id: 'img-4',
      workspaceId: 'ws-sample-1',
      storagePath: 'workspaces/ws-sample-1/references/img-4.jpg',
      publicUrl: 'https://cdn.example.com/img-4.jpg',
      category: 'PRODUCT',
      caption: '손님들 얼굴이 나온 테이블 전경',
      rightsStatus: 'OWNED',
      consentStatus: 'REQUIRED_MISSING',
      mimeType: 'image/jpeg',
      sortOrder: 4,
      isGolden: true,
      createdAt: new Date().toISOString(),
    }

    const check = validateRightsAndConsent(missingConsentAsset)
    expect(check.eligible).toBe(false)
    expect(check.blocker).toBe('CONSENT_REQUIRED_MISSING')
  })
})

describe('HF-16 & HF-18: Golden Image 3~5 Invariant & Confirmation Enforcement', () => {
  it('strictly validates golden image count boundary (min 3, max 5)', () => {
    expect(validateGoldenImageRequirement([]).valid).toBe(false)
    expect(validateGoldenImageRequirement(['img-1', 'img-2']).valid).toBe(false)
    expect(validateGoldenImageRequirement(['img-1', 'img-2', 'img-3']).valid).toBe(true)
    expect(validateGoldenImageRequirement(['img-1', 'img-2', 'img-3', 'img-4', 'img-5']).valid).toBe(true)
    expect(validateGoldenImageRequirement(['1', '2', '3', '4', '5', '6']).valid).toBe(false)
  })

  const sampleRules: VisualRules = {
    modelStyle: '친근하고 정갈한 베이커리 셰프',
    environment: '따뜻한 원목 인테리어와 자연 채광',
    composition: '상단 45도 클로즈업 및 매장 풀샷',
    lighting: '부드러운 자연광',
    colorTone: '따뜻한 베이지 및 골든 브라운 웜톤',
    sellingPoints: ['당일 생산 유기농 통밀빵', '100% 천연 버터'],
    forbiddenElements: ['과도한 CG 왜곡', '네온사인 인공 조명', '기형적인 손가락'],
  }

  const validGoldenAssets: ImageReferenceAsset[] = [
    {
      id: 'gold-1',
      workspaceId: 'ws-test',
      storagePath: 'p1',
      publicUrl: 'u1',
      category: 'STORE_EXTERIOR',
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
      mimeType: 'image/jpeg',
      sortOrder: 1,
      isGolden: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'gold-2',
      workspaceId: 'ws-test',
      storagePath: 'p2',
      publicUrl: 'u2',
      category: 'SIGNATURE_MENU',
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
      mimeType: 'image/jpeg',
      sortOrder: 2,
      isGolden: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'gold-3',
      workspaceId: 'ws-test',
      storagePath: 'p3',
      publicUrl: 'u3',
      category: 'ATMOSPHERE',
      rightsStatus: 'USER_CONFIRMED',
      consentStatus: 'CONFIRMED',
      mimeType: 'image/jpeg',
      sortOrder: 3,
      isGolden: true,
      createdAt: new Date().toISOString(),
    },
  ]

  it('fails to confirm if test runs have not been executed (testRunsCount === 0)', async () => {
    const draft = createImageHarnessDraft({
      workspaceId: 'ws-test',
      versionNumber: 1,
      rules: sampleRules,
      referenceAssets: validGoldenAssets,
      goldenImageIds: ['gold-1', 'gold-2', 'gold-3'],
    })

    expect(draft.testRunsCount).toBe(0)

    expect(() =>
      confirmImageHarnessVersion({
        draft,
        confirmedByUserId: 'user-owner-1',
      })
    ).toThrowError(/TEST_RUN_REQUIRED/)
  })

  it('fails to confirm if golden images are fewer than 3', async () => {
    let draft = createImageHarnessDraft({
      workspaceId: 'ws-test',
      versionNumber: 1,
      rules: sampleRules,
      referenceAssets: validGoldenAssets.slice(0, 2),
      goldenImageIds: ['gold-1', 'gold-2'],
    })

    // Run test to satisfy test run requirement
    const testRes = runImageHarnessTest({ draft })
    draft = testRes.updatedDraft

    expect(() =>
      confirmImageHarnessVersion({
        draft,
        confirmedByUserId: 'user-owner-1',
      })
    ).toThrowError(/GOLDEN_IMAGE_MINIMUM_REQUIRED/)
  })

  it('successfully confirms when Golden 3~5 and test run requirements are met', async () => {
    let draft = createImageHarnessDraft({
      workspaceId: 'ws-test',
      versionNumber: 1,
      rules: sampleRules,
      referenceAssets: validGoldenAssets,
      goldenImageIds: ['gold-1', 'gold-2', 'gold-3'],
    })

    // 1. Run test variation
    const testRes = runImageHarnessTest({ draft })
    draft = testRes.updatedDraft
    expect(draft.testRunsCount).toBe(1)
    expect(testRes.variations.length).toBeGreaterThanOrEqual(2)

    // 2. Confirm version
    const { confirmedVersion, fact } = confirmImageHarnessVersion({
      draft,
      confirmedByUserId: 'user-owner-1',
    })

    expect(confirmedVersion.status).toBe('ACTIVE_CONFIRMED')
    expect(confirmedVersion.confirmedAt).toBeDefined()
    expect(confirmedVersion.confirmedByUserId).toBe('user-owner-1')
    expect(fact.key).toBe('IMAGE_HARNESS_CONFIRMED')
    expect(fact.verified).toBe(true)
    expect(fact.status).toBe('CONFIRMED')
  })
})

describe('HF-20: Media Asset & Creative Bundle Lineage Protection', () => {
  const activeHarness = {
    id: 'ih_v1_confirmed',
    workspaceId: 'ws-prod-bakery',
    versionNumber: 1,
    status: 'ACTIVE_CONFIRMED' as const,
  }

  it('rejects publish eligibility when media lineage is missing', () => {
    const result = evaluateMediaPublishEligibility({
      lineage: null,
      activeHarnessVersion: activeHarness,
    })

    expect(result.eligible).toBe(false)
    expect(result.blocker).toBe('LINEAGE_MISSING')
  })

  it('rejects when lineage belongs to a different workspace (cross-tenant attack)', () => {
    const maliciousLineage: MediaHarnessLineage = {
      mediaAssetId: 'media-hack-1',
      workspaceId: 'ws-malicious-attacker',
      imageHarnessVersionId: activeHarness.id,
      referenceAssetIds: ['ref-1'],
      goldenAssetIds: ['ref-1'],
      provider: 'openai/dall-e-3',
      promptFingerprint: 'fp-12345',
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
      createdAt: new Date().toISOString(),
    }

    expect(() =>
      evaluateMediaPublishEligibility({
        lineage: maliciousLineage,
        activeHarnessVersion: activeHarness,
      })
    ).toThrowError(/CROSS_TENANT_DENIED/)
  })

  it('approves publish eligibility for valid lineage tied to active confirmed harness', () => {
    const validLineage: MediaHarnessLineage = {
      mediaAssetId: 'media-legit-1',
      workspaceId: 'ws-prod-bakery',
      imageHarnessVersionId: activeHarness.id,
      textHarnessVersionId: 'th_v1_confirmed',
      referenceAssetIds: ['gold-1', 'gold-2', 'gold-3'],
      goldenAssetIds: ['gold-1', 'gold-2', 'gold-3'],
      provider: 'google/imagen-3',
      promptFingerprint: 'fp-abcdef-6789',
      rightsStatus: 'OWNED',
      consentStatus: 'CONFIRMED',
      createdAt: new Date().toISOString(),
    }

    const result = evaluateMediaPublishEligibility({
      lineage: validLineage,
      activeHarnessVersion: activeHarness,
    })

    expect(result.eligible).toBe(true)
    expect(result.blocker).toBeUndefined()
  })
})
