import { describe, it, expect } from 'vitest'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'
import { requireSoheeReady, SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'
import { grantSoheeReadyStarterEntitlement } from '@/features/sohee-ready/entitlement'
import {
  verifyInstagramEvidence,
  verifyThreadsEvidence,
  evaluateDualChannelReadiness,
} from '@/features/channels/dual-channel-verification'
import {
  createKnowledgeCandidate,
  confirmKnowledgeFacts,
  getGroundingKnowledge,
} from '@/features/knowledge/knowledge-manager'
import {
  createTextHarnessDraft,
  runTextHarnessTest,
  confirmTextHarnessVersion,
} from '@/features/text-harness/text-harness-manager'
import {
  createImageHarnessDraft,
  runImageHarnessTest,
  confirmImageHarnessVersion,
  validateRightsAndConsent,
  evaluateMediaPublishEligibility,
  type ImageReferenceAsset,
} from '@/features/image-harness/image-harness-manager'
import {
  createSharedMissionEntry,
  resolveDockUIMode,
} from '@/features/content/shared-mission-runtime'
import {
  computeExactApprovalFingerprint,
  validateApprovalFingerprint,
  executeDualChannelPublish,
  type ExactApprovalPayload,
} from '@/features/publishing/dual-publish-coordinator'
import type { SoheeReadinessSnapshot, SoheeReadinessFactKey, ReadinessFactProvenance } from '@/features/sohee-ready/types'

describe('HF-32 [P0][E2E]: Golden Journey · Full Harness-First Production Lifecycle', () => {
  const testRunId = `run_${Date.now()}`
  const workspaceId = `ws-golden-${testRunId}`
  const userId = `user-owner-${testRunId}`

  it('executes the full end-to-end journey from signup to dual publish with zero partial state', async () => {
    // -------------------------------------------------------------
    // Step 1: Newly Created Workspace (Initial Pre-Ready State)
    // -------------------------------------------------------------
    const initialReadiness = await getSoheeReadiness(workspaceId, {
      fixtureState: {
        BUSINESS_VERIFIED: true, // Only business verified at start
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: false,
        BUSINESS_KNOWLEDGE_CONFIRMED: false,
        TEXT_HARNESS_CONFIRMED: false,
        IMAGE_HARNESS_CONFIRMED: false,
        OPERATING_POLICY_CONFIRMED: false,
      },
    })
    expect(initialReadiness.ready).toBe(false)
    expect(initialReadiness.blockers.length).toBe(6)

    // Verify Admission Guard strictly blocks mission creation at Step 1
    await expect(
      createSharedMissionEntry(
        {
          workspaceId,
          source: 'CONTENT_UI',
          intent: '포스팅 작성',
          channelTargets: ['instagram', 'threads'],
        },
        { readinessSnapshot: initialReadiness }
      )
    ).rejects.toThrowError(SoheeNotReadyError)

    // -------------------------------------------------------------
    // Step 2: Dual Meta Channel Verification (Instagram + Threads)
    // -------------------------------------------------------------
    const igReceipt = verifyInstagramEvidence({
      accountId: 'ig_acc_123',
      username: 'sohee_bakery',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
      capabilityReceipt: {
        profileReadSuccess: true,
        publishQuotaVerified: true,
        probedAt: new Date().toISOString(),
      },
    })
    expect(igReceipt.status).toBe('VERIFIED')

    const thReceipt = verifyThreadsEvidence({
      threadsUserId: 'th_usr_456',
      threadsUsername: 'sohee_bakery',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      scopes: ['threads_basic', 'threads_content_publish'],
      capabilityReceipt: {
        profileReadSuccess: true,
        publishQuotaVerified: true,
        probedAt: new Date().toISOString(),
      },
    })
    expect(thReceipt.status).toBe('VERIFIED')

    const dualEval = evaluateDualChannelReadiness({ instagram: igReceipt, threads: thReceipt })
    expect(dualEval.dualVerified).toBe(true)

    // -------------------------------------------------------------
    // Step 3: Business Knowledge Grounding & Fact Confirmation
    // -------------------------------------------------------------
    const cand1 = createKnowledgeCandidate({
      workspaceId,
      sourceId: 'src-interview-1',
      category: 'MENU',
      key: 'signature_menu',
      candidateValue: '유기농 사워도우',
      confidence: 0.95,
    })
    const cand2 = createKnowledgeCandidate({
      workspaceId,
      sourceId: 'src-interview-2',
      category: 'HOURS',
      key: 'operating_hours',
      candidateValue: '화-일 09:00 - 20:00',
      confidence: 0.95,
    })
    
    // Pre-confirmed candidates must NOT be groundable
    const initialGrounding = getGroundingKnowledge({
      candidates: [cand1, cand2],
      confirmedFacts: [],
    })
    expect(initialGrounding.facts).toEqual([])
    expect(initialGrounding.groundingText).toBe('')

    const confirmedKnowledge = confirmKnowledgeFacts({
      workspaceId,
      approvedCandidates: [cand1, cand2],
      userId,
      previousVersionNumber: 0,
    })
    expect(confirmedKnowledge.factsSnapshot.length).toBe(2)

    const postConfirmGrounding = getGroundingKnowledge({
      candidates: [],
      confirmedFacts: confirmedKnowledge.factsSnapshot,
    })
    expect(postConfirmGrounding.facts.length).toBe(2)

    // -------------------------------------------------------------
    // Step 4: Text Harness (Draft → Test Run → Confirmation)
    // -------------------------------------------------------------
    let textDraft = createTextHarnessDraft({
      workspaceId,
      versionNumber: 1,
      rules: {
        toneAndManner: '따뜻하고 정갈한 동네 빵집',
        targetAudience: '건강한 빵을 찾는 주민들',
        keyPhrases: ['매일 아침 직접 구운', '유기농 천연 발효종'],
        prohibitedWords: ['초특가', '폭탄세일'],
        positiveExamples: ['오늘도 따뜻한 빵과 함께 든든한 하루 시작하세요.'],
        negativeExamples: ['지금 안 사면 후회할 초특가 세일!'],
      },
    })

    // Confirm without test run must throw
    expect(() => confirmTextHarnessVersion({ draft: textDraft, userId })).toThrowError(/최소 1회 이상 테스트 생성을 실행해야/)

    // Run test generation
    const textTestRes = runTextHarnessTest({ draft: textDraft, sampleTopic: '유기농 사워도우 소개' })
    textDraft = textTestRes.updatedDraft
    expect(textDraft.testRunsCount).toBe(1)
    expect(textTestRes.instagramCopies.length).toBe(2)
    expect(textTestRes.threadsCopies.length).toBe(2)

    const confirmedTextHarness = confirmTextHarnessVersion({ draft: textDraft, userId })
    expect(confirmedTextHarness.confirmedVersion.status).toBe('ACTIVE_CONFIRMED')

    // -------------------------------------------------------------
    // Step 5: Image Harness (Golden 3~5 + Rights + Test Run + Confirmation)
    // -------------------------------------------------------------
    const goldenAssets: ImageReferenceAsset[] = [
      {
        id: 'gold-asset-1',
        workspaceId,
        storagePath: 'assets/store.jpg',
        publicUrl: 'https://cdn.example.com/store.jpg',
        category: 'STORE_EXTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        mimeType: 'image/jpeg',
        sortOrder: 1,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'gold-asset-2',
        workspaceId,
        storagePath: 'assets/bread.jpg',
        publicUrl: 'https://cdn.example.com/bread.jpg',
        category: 'SIGNATURE_MENU',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        mimeType: 'image/jpeg',
        sortOrder: 2,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'gold-asset-3',
        workspaceId,
        storagePath: 'assets/interior.jpg',
        publicUrl: 'https://cdn.example.com/interior.jpg',
        category: 'ATMOSPHERE',
        rightsStatus: 'USER_CONFIRMED',
        consentStatus: 'NOT_APPLICABLE',
        mimeType: 'image/jpeg',
        sortOrder: 3,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
    ]

    let imageDraft = createImageHarnessDraft({
      workspaceId,
      versionNumber: 1,
      rules: {
        environment: '원목 테라스와 자연 채광',
        colorTone: '골든 브라운 웜톤',
        forbiddenElements: ['과도한 CG', '네온사인'],
      },
      referenceAssets: goldenAssets,
      goldenImageIds: ['gold-asset-1', 'gold-asset-2', 'gold-asset-3'],
    })

    // Must run at least 1 variation test
    const imageTestRes = runImageHarnessTest({ draft: imageDraft })
    imageDraft = imageTestRes.updatedDraft
    expect(imageDraft.testRunsCount).toBe(1)
    expect(imageTestRes.variations.length).toBeGreaterThanOrEqual(2)

    const confirmedImageHarness = confirmImageHarnessVersion({
      draft: imageDraft,
      confirmedByUserId: userId,
    })
    expect(confirmedImageHarness.confirmedVersion.status).toBe('ACTIVE_CONFIRMED')

    // -------------------------------------------------------------
    // Step 6 & 7: Operating Policy & Canonical SOHEE_READY Verification
    // -------------------------------------------------------------
    const finalReadiness = await getSoheeReadiness(workspaceId, {
      fixtureState: {
        BUSINESS_VERIFIED: true,
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: true,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      },
    })
    expect(finalReadiness.ready).toBe(true)
    expect(finalReadiness.blockers.length).toBe(0)

    // -------------------------------------------------------------
    // Step 8: Starter Entitlement Grant (Exactly Once 50 Energy)
    // -------------------------------------------------------------
    const mockEntitlementSupabase = {
      rpc: async () => ({
        data: {
          success: true,
          already_granted: false,
          energy_granted: 50,
          credits_granted: 40000,
          benefit_type: 'FREE_TASTE_50',
          claimed_at: new Date().toISOString(),
        },
        error: null,
      }),
    } as any

    const entitlementRes = await grantSoheeReadyStarterEntitlement(
      mockEntitlementSupabase,
      'ws-all-7-ready',
      userId,
      undefined,
      { readinessSnapshot: finalReadiness }
    )
    expect(entitlementRes.granted).toBe(true)
    expect(entitlementRes.energyGranted).toBe(50)
    expect(entitlementRes.benefitType).toBe('FREE_TASTE_50')

    // -------------------------------------------------------------
    // Step 9: Shared Mission Entry & Exact Approval & Dual Publish
    // -------------------------------------------------------------
    const mission = await createSharedMissionEntry(
      {
        workspaceId,
        source: 'CONTENT_UI',
        intent: '아침 유기농 사워도우 갓 구워져 나왔습니다 홍보',
        channelTargets: ['instagram', 'threads'],
      },
      { readinessSnapshot: finalReadiness }
    )
    expect(mission.id).toBeDefined()
    expect(mission.status).toBe('PLANNING')

    const approvalPayload: ExactApprovalPayload = {
      workspaceId,
      contentId: mission.id,
      contentVersion: 1,
      copyText: '오늘 아침 갓 구워낸 프랑스 유기농 샤워도우입니다.',
      imageUrl: 'https://cdn.example.com/bread.jpg',
      channelTargets: ['instagram', 'threads'],
      harnessVersions: {
        knowledgeVersionId: confirmedKnowledge.id,
        textHarnessVersionId: confirmedTextHarness.confirmedVersion.id,
        imageHarnessVersionId: confirmedImageHarness.confirmedVersion.id,
        operatingPolicyVersionId: 'policy-v1',
      },
      rightsAndConsent: {
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
      },
    }

    const fingerprint = computeExactApprovalFingerprint(approvalPayload)

    // Execute dual channel publish
    const publishRes = await executeDualChannelPublish({
      payload: approvalPayload,
      approvalFingerprint: fingerprint,
      executor: async (ch) => ({
        success: true,
        nativePostId: `${ch}_post_${Date.now()}`,
        liveUrl: `https://${ch}.com/p/live_${Date.now()}`,
      }),
    })

    expect(publishRes.overallStatus).toBe('ALL_VERIFIED')
    expect(publishRes.receipts.instagram.status).toBe('VERIFIED')
    expect(publishRes.receipts.threads.status).toBe('VERIFIED')
  })
})

describe('HF-33 [P0][E2E]: Negative Readiness & API Bypass Protection', () => {
  const factKeys: SoheeReadinessFactKey[] = [
    'BUSINESS_VERIFIED',
    'INSTAGRAM_VERIFIED',
    'THREADS_VERIFIED',
    'BUSINESS_KNOWLEDGE_CONFIRMED',
    'TEXT_HARNESS_CONFIRMED',
    'IMAGE_HARNESS_CONFIRMED',
    'OPERATING_POLICY_CONFIRMED',
  ]

  // [HF-33 & P0-7] Canonical 7-Fact Negative Suite: Exactly 6 TRUE + Exactly 1 FALSE per test
  factKeys.forEach((missingFact) => {
    it(`strictly fails admission when [${missingFact}] is missing (6 TRUE + exactly 1 FALSE)`, async () => {
      // 1. Construct canonical fixture with exactly 6 TRUE and exactly 1 FALSE
      const fixtureState: Record<SoheeReadinessFactKey, boolean> = {
        BUSINESS_VERIFIED: true,
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: true,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      }
      fixtureState[missingFact] = false

      // 2. Mathematically assert 6 TRUE + exactly 1 FALSE
      const trueCount = Object.values(fixtureState).filter((v) => v === true).length
      const falseCount = Object.values(fixtureState).filter((v) => v === false).length
      expect(trueCount).toBe(6)
      expect(falseCount).toBe(1)

      // 3. Evaluate readiness
      const readiness = await getSoheeReadiness(`ws-neg-${missingFact}`, { fixtureState })

      expect(readiness.ready).toBe(false)
      expect(readiness.blockers.length).toBe(1)
      expect(readiness.blockers[0].factKey).toBe(missingFact)

      // 4. Direct API bypass attempt must be rejected fail-closed
      await expect(
        createSharedMissionEntry(
          {
            workspaceId: `ws-neg-${missingFact}`,
            source: 'CONTENT_UI',
            intent: '불법 우회 생성 시도',
            channelTargets: ['instagram'],
          },
          { readinessSnapshot: readiness }
        )
      ).rejects.toThrowError(SoheeNotReadyError)
    })
  })
})


describe('HF-34 [P0][E2E]: Cross-Tenant, Reference Rights & Security Definer Threat Suite', () => {
  it('blocks cross-tenant media harness injection', () => {
    expect(() =>
      evaluateMediaPublishEligibility({
        lineage: {
          mediaAssetId: 'media-1',
          workspaceId: 'ws-victim-tenant',
          imageHarnessVersionId: 'ih-v1',
          referenceAssetIds: [],
          goldenAssetIds: [],
          provider: 'imagen-3',
          promptFingerprint: 'fp-1',
          rightsStatus: 'OWNED',
          consentStatus: 'NOT_APPLICABLE',
          createdAt: new Date().toISOString(),
        },
        activeHarnessVersion: {
          id: 'ih-v1',
          workspaceId: 'ws-attacker-tenant',
          versionNumber: 1,
          status: 'ACTIVE_CONFIRMED',
        },
      })
    ).toThrowError(/CROSS_TENANT_DENIED/)
  })

  it('rejects assets with UNKNOWN rights from being eligible for publication', () => {
    const unverifiedAsset: ImageReferenceAsset = {
      id: 'asset-unverified',
      workspaceId: 'ws-test',
      storagePath: 'test.jpg',
      publicUrl: 'https://cdn.example.com/test.jpg',
      category: 'PRODUCT',
      rightsStatus: 'UNKNOWN',
      consentStatus: 'NOT_APPLICABLE',
      mimeType: 'image/jpeg',
      sortOrder: 1,
      isGolden: false,
      createdAt: new Date().toISOString(),
    }

    const check = validateRightsAndConsent(unverifiedAsset)
    expect(check.eligible).toBe(false)
    expect(check.blocker).toBe('RIGHTS_NOT_PERMITTED')
  })

  it('rejects assets with REQUIRED_MISSING portrait likeness consent', () => {
    const missingConsentAsset: ImageReferenceAsset = {
      id: 'asset-no-consent',
      workspaceId: 'ws-test',
      storagePath: 'test.jpg',
      publicUrl: 'https://cdn.example.com/test.jpg',
      category: 'PRODUCT',
      rightsStatus: 'OWNED',
      consentStatus: 'REQUIRED_MISSING',
      mimeType: 'image/jpeg',
      sortOrder: 1,
      isGolden: false,
      createdAt: new Date().toISOString(),
    }

    const check = validateRightsAndConsent(missingConsentAsset)
    expect(check.eligible).toBe(false)
    expect(check.blocker).toBe('CONSENT_REQUIRED_MISSING')
  })
})
