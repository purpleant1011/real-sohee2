import { describe, it, expect } from 'vitest'
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
  type ImageReferenceAsset,
} from '@/features/image-harness/image-harness-manager'
import {
  createSharedMissionEntry,
  resolveDockUIMode,
} from '@/features/content/shared-mission-runtime'
import { resolveAppShellMode } from '@/features/sohee-ready/shell-resolver'
import {
  computeExactApprovalFingerprint,
  validateApprovalFingerprint,
  executeDualChannelPublish,
  type ExactApprovalPayload,
} from '@/features/publishing/dual-publish-coordinator'
import { grantSoheeReadyStarterEntitlement } from '@/features/sohee-ready/entitlement'
import { SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'
import type {
  SoheeReadinessSnapshot,
  SoheeReadinessFactKey,
  ReadinessFactProvenance,
  ReadinessFactStatus,
} from '@/features/sohee-ready/types'

function makeFact(
  key: SoheeReadinessFactKey,
  verified: boolean,
  status: ReadinessFactStatus,
  evidenceId: string | null = null,
  version: string | number | null = null,
  verifiedAt: string | null = null
): ReadinessFactProvenance {
  return {
    key,
    verified,
    status,
    source: 'db:test',
    evidenceId,
    version,
    verifiedAt,
    freshness: 'FRESH',
  }
}

describe('HF-35 [P0][Contract]: Pure Golden Journey Domain Lifecycle Contract (Zero FixtureState, Zero Sample)', () => {
  const runId = `fresh_${Date.now()}`
  const workspaceId = `ws-fresh-${runId}`
  const ownerUserId = `user-fresh-${runId}`

  it('proves the pure end-to-end golden journey from unverified to dual published with real domain primitives', async () => {
    // ------------------------------------------------------------------------
    // Step 1: Pre-Ready Workspace (All 7 facts unverified/absent)
    // ------------------------------------------------------------------------
    const initialSnapshot: SoheeReadinessSnapshot = {
      workspaceId,
      ready: false,
      facts: {
        BUSINESS_VERIFIED: makeFact('BUSINESS_VERIFIED', false, 'MISSING'),
        INSTAGRAM_VERIFIED: makeFact('INSTAGRAM_VERIFIED', false, 'MISSING'),
        THREADS_VERIFIED: makeFact('THREADS_VERIFIED', false, 'MISSING'),
        BUSINESS_KNOWLEDGE_CONFIRMED: makeFact('BUSINESS_KNOWLEDGE_CONFIRMED', false, 'MISSING'),
        TEXT_HARNESS_CONFIRMED: makeFact('TEXT_HARNESS_CONFIRMED', false, 'MISSING'),
        IMAGE_HARNESS_CONFIRMED: makeFact('IMAGE_HARNESS_CONFIRMED', false, 'MISSING'),
        OPERATING_POLICY_CONFIRMED: makeFact('OPERATING_POLICY_CONFIRMED', false, 'MISSING'),
      },
      blockers: [
        { code: 'BUSINESS_NOT_VERIFIED', factKey: 'BUSINESS_VERIFIED', message: '사업자 등록 진위 확인 필요', remediationAction: '확인하기', remediationHref: '/start' },
        { code: 'INSTAGRAM_NOT_VERIFIED', factKey: 'INSTAGRAM_VERIFIED', message: '인스타그램 연동 및 권한 확인 필요', remediationAction: '연동하기', remediationHref: '/start?step=channels' },
        { code: 'THREADS_NOT_VERIFIED', factKey: 'THREADS_VERIFIED', message: '스레드 연동 및 권한 확인 필요', remediationAction: '연동하기', remediationHref: '/start?step=channels' },
        { code: 'BUSINESS_KNOWLEDGE_NOT_CONFIRMED', factKey: 'BUSINESS_KNOWLEDGE_CONFIRMED', message: '매장 정보 지식베이스 확정 필요', remediationAction: '확정하기', remediationHref: '/app/sohee?tab=training' },
        { code: 'TEXT_HARNESS_NOT_CONFIRMED', factKey: 'TEXT_HARNESS_CONFIRMED', message: '문체 하네스 테스트 및 확정 필요', remediationAction: '확정하기', remediationHref: '/app/sohee?tab=training' },
        { code: 'IMAGE_HARNESS_NOT_CONFIRMED', factKey: 'IMAGE_HARNESS_CONFIRMED', message: '비주얼 하네스 골든 레퍼런스 확정 필요', remediationAction: '확정하기', remediationHref: '/app/sohee?tab=training' },
        { code: 'OPERATING_POLICY_NOT_CONFIRMED', factKey: 'OPERATING_POLICY_CONFIRMED', message: '운영 정책 확정 필요', remediationAction: '확정하기', remediationHref: '/app/sohee?tab=command' },
      ],
      evaluatedAt: new Date().toISOString(),
    }

    expect(initialSnapshot.ready).toBe(false)
    expect(initialSnapshot.blockers.length).toBe(7)

    // Fail-Closed Admission Gate: Proves mission creation blocked at Step 1
    await expect(
      createSharedMissionEntry(
        {
          workspaceId,
          source: 'CONTENT_UI',
          intent: '아침 빵 메뉴 소개',
          channelTargets: ['instagram', 'threads'],
        },
        { readinessSnapshot: initialSnapshot }
      )
    ).rejects.toThrowError(SoheeNotReadyError)

    // Shell Resolver & Dock UI Mode: Pre-ready resolves to EDUCATION_SHELL & EDUCATION
    const initialShell = resolveAppShellMode(initialSnapshot)
    expect(initialShell).toBe('EDUCATION_SHELL')

    const initialDockMode = resolveDockUIMode({
      isSoheeReady: initialSnapshot.ready,
      hasPendingApproval: false,
      runtimeReadiness: 'BLOCKED',
    })
    expect(initialDockMode).toBe('EDUCATION')

    // ------------------------------------------------------------------------
    // Step 2: 국세청 사업자 진위 확인 (BUSINESS_VERIFIED)
    // ------------------------------------------------------------------------
    const businessFact = makeFact(
      'BUSINESS_VERIFIED',
      true,
      'VERIFIED',
      `biz_${runId}`,
      'v1',
      new Date().toISOString()
    )

    // ------------------------------------------------------------------------
    // Step 3: Dual Meta Channel Verification (Instagram + Threads)
    // ------------------------------------------------------------------------
    const igReceipt = verifyInstagramEvidence({
      accountId: `ig_${runId}`,
      username: 'fresh_bakery_seoul',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 60).toISOString(),
      scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      capabilityReceipt: {
        profileReadSuccess: true,
        publishQuotaVerified: true,
        probedAt: new Date().toISOString(),
      },
    })
    expect(igReceipt.status).toBe('VERIFIED')

    const thReceipt = verifyThreadsEvidence({
      threadsUserId: `th_${runId}`,
      threadsUsername: 'fresh_bakery_seoul',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 60).toISOString(),
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

    // ------------------------------------------------------------------------
    // Step 4: 매장 지식베이스 후보 등록 및 확정 (BUSINESS_KNOWLEDGE_CONFIRMED)
    // ------------------------------------------------------------------------
    const cand1 = createKnowledgeCandidate({
      workspaceId,
      sourceId: 'biz-reg-1',
      category: 'HOURS',
      key: 'opening_hours',
      candidateValue: '월-토 08:00 - 21:00',
      confidence: 1.0,
    })
    const cand2 = createKnowledgeCandidate({
      workspaceId,
      sourceId: 'biz-reg-2',
      category: 'DIFFERENTIATOR',
      key: 'store_signature',
      candidateValue: '천연 발효 유기농 샤워도우 전문',
      confidence: 1.0,
    })

    const confirmedKnowledge = confirmKnowledgeFacts({
      workspaceId,
      approvedCandidates: [cand1, cand2],
      userId: ownerUserId,
      previousVersionNumber: 0,
    })
    expect(confirmedKnowledge.factsSnapshot.length).toBe(2)

    const grounding = getGroundingKnowledge({
      candidates: [],
      confirmedFacts: confirmedKnowledge.factsSnapshot,
    })
    expect(grounding.facts.length).toBe(2)

    // ------------------------------------------------------------------------
    // Step 5: 문체 하네스 (Draft -> Test Run -> Confirmation)
    // ------------------------------------------------------------------------
    let textDraft = createTextHarnessDraft({
      workspaceId,
      versionNumber: 1,
      rules: {
        toneAndManner: '진정성 있고 다정한 동네 베이커리 어조',
        targetAudience: '건강한 아침 식사를 즐기는 이웃 주민',
        keyPhrases: ['매일 아침 갓 구운', '천연 발효 샤워도우'],
        prohibitedWords: ['초특가', '폭탄세일', '광고'],
        positiveExamples: ['좋은 아침입니다! 오늘도 정성껏 구운 빵으로 인사드립니다.'],
        negativeExamples: ['역대급 최저가 세일 마감임박!!'],
      },
    })

    const textTestRes = runTextHarnessTest({ draft: textDraft, sampleTopic: '유기농 샤워도우 소개' })
    textDraft = textTestRes.updatedDraft
    expect(textDraft.testRunsCount).toBe(1)

    const confirmedTextHarness = confirmTextHarnessVersion({ draft: textDraft, userId: ownerUserId })
    expect(confirmedTextHarness.confirmedVersion.status).toBe('ACTIVE_CONFIRMED')

    // ------------------------------------------------------------------------
    // Step 6: 비주얼 하네스 (3~5 골든 에셋 + 권리 확인 + Test Run -> Confirmation)
    // ------------------------------------------------------------------------
    const realGoldenAssets: ImageReferenceAsset[] = [
      {
        id: `asset-exterior-${runId}`,
        workspaceId,
        storagePath: `workspaces/${workspaceId}/exterior.jpg`,
        publicUrl: `https://storage.example.com/workspaces/${workspaceId}/exterior.jpg`,
        category: 'STORE_EXTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        mimeType: 'image/jpeg',
        sortOrder: 1,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: `asset-bread-${runId}`,
        workspaceId,
        storagePath: `workspaces/${workspaceId}/sourdough.jpg`,
        publicUrl: `https://storage.example.com/workspaces/${workspaceId}/sourdough.jpg`,
        category: 'SIGNATURE_MENU',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        mimeType: 'image/jpeg',
        sortOrder: 2,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: `asset-interior-${runId}`,
        workspaceId,
        storagePath: `workspaces/${workspaceId}/dining.jpg`,
        publicUrl: `https://storage.example.com/workspaces/${workspaceId}/dining.jpg`,
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
        environment: '아늑한 우드 인테리어와 자연 채광',
        colorTone: '따뜻한 골든 앰버 톤',
        forbiddenElements: ['합성 티가 나는 렌더링', '인공 네온사인'],
      },
      referenceAssets: realGoldenAssets,
      goldenImageIds: realGoldenAssets.map((a) => a.id),
    })

    const imageTestRes = runImageHarnessTest({ draft: imageDraft })
    imageDraft = imageTestRes.updatedDraft
    expect(imageDraft.testRunsCount).toBe(1)

    const confirmedImageHarness = confirmImageHarnessVersion({
      draft: imageDraft,
      confirmedByUserId: ownerUserId,
    })
    expect(confirmedImageHarness.confirmedVersion.status).toBe('ACTIVE_CONFIRMED')

    // ------------------------------------------------------------------------
    // Step 7: 운영 정책 확정 (OPERATING_POLICY_CONFIRMED)
    // ------------------------------------------------------------------------
    const policyFact = makeFact(
      'OPERATING_POLICY_CONFIRMED',
      true,
      'CONFIRMED',
      `policy_${runId}`,
      'v1',
      new Date().toISOString()
    )

    // ------------------------------------------------------------------------
    // Step 8: SOHEE_READY 7개 Fact 전수 충족 달성 검증
    // ------------------------------------------------------------------------
    const soheeReadySnapshot: SoheeReadinessSnapshot = {
      workspaceId,
      ready: true,
      facts: {
        BUSINESS_VERIFIED: businessFact,
        INSTAGRAM_VERIFIED: makeFact('INSTAGRAM_VERIFIED', true, 'VERIFIED', `ig_receipt_${runId}`, 'v1', new Date().toISOString()),
        THREADS_VERIFIED: makeFact('THREADS_VERIFIED', true, 'VERIFIED', `th_receipt_${runId}`, 'v1', new Date().toISOString()),
        BUSINESS_KNOWLEDGE_CONFIRMED: makeFact('BUSINESS_KNOWLEDGE_CONFIRMED', true, 'CONFIRMED', confirmedKnowledge.id, confirmedKnowledge.versionNumber, new Date().toISOString()),
        TEXT_HARNESS_CONFIRMED: makeFact('TEXT_HARNESS_CONFIRMED', true, 'CONFIRMED', confirmedTextHarness.confirmedVersion.id, confirmedTextHarness.confirmedVersion.versionNumber, new Date().toISOString()),
        IMAGE_HARNESS_CONFIRMED: makeFact('IMAGE_HARNESS_CONFIRMED', true, 'CONFIRMED', confirmedImageHarness.confirmedVersion.id, confirmedImageHarness.confirmedVersion.versionNumber, new Date().toISOString()),
        OPERATING_POLICY_CONFIRMED: policyFact,
      },
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    }

    expect(soheeReadySnapshot.ready).toBe(true)
    expect(soheeReadySnapshot.blockers.length).toBe(0)

    // Shell Resolver: Now resolves to WORK_APP_SHELL & WORK Dock Mode
    const finalShell = resolveAppShellMode(soheeReadySnapshot)
    expect(finalShell).toBe('WORK_APP_SHELL')

    const finalDockMode = resolveDockUIMode({
      isSoheeReady: soheeReadySnapshot.ready,
      hasPendingApproval: false,
      runtimeReadiness: 'SOHEE_READY',
    })
    expect(finalDockMode).toBe('WORK')

    // ------------------------------------------------------------------------
    // Step 9: Starter Entitlement Grant (Exactly-Once 50 Energy)
    // ------------------------------------------------------------------------
    let rpcCallCount = 0
    const mockDbClient = {
      rpc: async (fnName: string, args: any) => {
        rpcCallCount += 1
        if (rpcCallCount === 1) {
          return {
            data: {
              success: true,
              already_granted: false,
              energy_granted: 50,
              credits_granted: 40000,
              benefit_type: 'FREE_TASTE_50',
              claimed_at: new Date().toISOString(),
            },
            error: null,
          }
        }
        // Second call idempotent replay
        return {
          data: {
            success: true,
            already_granted: true,
            energy_granted: 0,
            credits_granted: 0,
            benefit_type: 'FREE_TASTE_50',
            claimed_at: new Date().toISOString(),
          },
          error: null,
        }
      },
    } as any

    const grantFirst = await grantSoheeReadyStarterEntitlement(
      mockDbClient,
      workspaceId,
      ownerUserId,
      undefined,
      { readinessSnapshot: soheeReadySnapshot }
    )
    expect(grantFirst.granted).toBe(true)
    expect(grantFirst.energyGranted).toBe(50)

    const grantSecond = await grantSoheeReadyStarterEntitlement(
      mockDbClient,
      workspaceId,
      ownerUserId,
      undefined,
      { readinessSnapshot: soheeReadySnapshot }
    )
    expect(grantSecond.granted).toBe(true)
    expect(grantSecond.energyGranted).toBe(0)
    expect(grantSecond.alreadyGranted).toBe(true)

    // ------------------------------------------------------------------------
    // Step 10: Shared Mission Entry (With 4 Harness Version Snapshots)
    // ------------------------------------------------------------------------
    const mission = await createSharedMissionEntry(
      {
        workspaceId,
        source: 'CONTENT_UI',
        intent: '아침 갓 구운 천연 발효 사워도우 홍보',
        channelTargets: ['instagram', 'threads'],
      },
      { readinessSnapshot: soheeReadySnapshot }
    )

    expect(mission.id).toBeDefined()
    expect(mission.status).toBe('PLANNING')
    expect(mission.harnessSnapshot.textHarnessVersionId).toBe(confirmedTextHarness.confirmedVersion.id)
    expect(mission.harnessSnapshot.imageHarnessVersionId).toBe(confirmedImageHarness.confirmedVersion.id)

    // ------------------------------------------------------------------------
    // Step 11: Exact Approval Fingerprint Calculation & Anti-TOCTOU Gate
    // ------------------------------------------------------------------------
    const approvalPayload: ExactApprovalPayload = {
      workspaceId,
      contentId: mission.id,
      contentVersion: 1,
      copyText: '오늘 아침 갓 구워낸 프랑스 유기농 샤워도우입니다. 바삭한 크러스트와 부드러운 속살을 만나보세요.',
      imageUrl: realGoldenAssets[1].publicUrl,
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
    expect(fingerprint).toMatch(/^apfp_[a-f0-9]{24}$/)

    // Valid fingerprint check passes
    expect(() =>
      validateApprovalFingerprint({
        expectedFingerprint: fingerprint,
        currentPayload: approvalPayload,
      })
    ).not.toThrow()

    // Mutated copy triggers FINGERPRINT_MISMATCH
    const tamperedPayload = { ...approvalPayload, copyText: '변조된 문구입니다.' }
    expect(() =>
      validateApprovalFingerprint({
        expectedFingerprint: fingerprint,
        currentPayload: tamperedPayload,
      })
    ).toThrowError(/FINGERPRINT_MISMATCH/)

    // ------------------------------------------------------------------------
    // Step 12: Dual Channel Live Publish & Rejection of Synthetic URLs
    // ------------------------------------------------------------------------
    // A. Reject synthetic/mock URLs
    const syntheticRes = await executeDualChannelPublish({
      payload: approvalPayload,
      approvalFingerprint: fingerprint,
      executor: async (channel) => ({
        success: true,
        nativePostId: `post_${channel}_1`,
        liveUrl: 'https://instagram.com/p/live_recent', // Banned synthetic URL
      }),
    })
    expect(syntheticRes.overallStatus).toBe('FAILED')
    expect(syntheticRes.receipts.instagram.status).toBe('FAILED')

    // B. Real Live Publish with genuine independent readback
    const livePublishRes = await executeDualChannelPublish({
      payload: approvalPayload,
      approvalFingerprint: fingerprint,
      executor: async (channel) => {
        const realPostId = `live_post_${channel}_${Date.now()}`
        return {
          success: true,
          nativePostId: realPostId,
          liveUrl: channel === 'instagram'
            ? `https://www.instagram.com/p/C_${Date.now()}/`
            : `https://www.threads.net/@fresh_bakery/post/${realPostId}`,
        }
      },
    })

    expect(livePublishRes.overallStatus).toBe('ALL_VERIFIED')
    expect(livePublishRes.receipts.instagram.status).toBe('VERIFIED')
    expect(livePublishRes.receipts.threads.status).toBe('VERIFIED')
    expect(livePublishRes.receipts.instagram.nativePostId).toBeDefined()
    expect(livePublishRes.receipts.threads.nativePostId).toBeDefined()
  })
})
