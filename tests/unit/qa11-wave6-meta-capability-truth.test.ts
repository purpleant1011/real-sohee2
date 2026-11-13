import { describe, expect, it } from 'vitest'
import {
  evaluateMetaCapabilityState,
  assertCustomerPublishAdmission,
  getMetaCapabilityTruth,
  PublicCustomerPublishBlockedError,
  MetaCapabilityState,
  CANONICAL_META_APP_ID,
  MetaCapabilityEvidence,
} from '@/features/channels/meta-capability-truth'

describe('Meta Capability Truth (ANI-1143)', () => {
  const baseInstagramPermissions = [
    { name: 'instagram_basic' as const, granted: true, tier: 'standard' as const, reviewStatus: 'unsubmitted' as const },
    { name: 'instagram_content_publish' as const, granted: true, tier: 'standard' as const, reviewStatus: 'unsubmitted' as const },
  ]

  const baseThreadsPermissions = [
    { name: 'threads_basic' as const, granted: true, tier: 'standard' as const, reviewStatus: 'unsubmitted' as const },
    { name: 'threads_content_publish' as const, granted: true, tier: 'standard' as const, reviewStatus: 'unsubmitted' as const },
  ]

  it('evaluates canonical production Meta app as TEST_ROLE_ONLY in development mode', () => {
    const evidence = evaluateMetaCapabilityState({
      channel: 'instagram',
      appId: CANONICAL_META_APP_ID,
      appMode: 'development',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: baseInstagramPermissions,
    })

    expect(evidence.appId).toBe(CANONICAL_META_APP_ID)
    expect(evidence.appMode).toBe('development')
    expect(evidence.capabilityState).toBe('TEST_ROLE_ONLY')
    expect(evidence.isPublicCustomerReady).toBe(false)
    expect(evidence.reasons).toContain('Meta 앱이 개발(Development) 모드이므로 테스터/개발자 역할(Test Role)만 사용 가능합니다.')
  })

  it('never returns PUBLIC_READY solely because an internal test publish succeeded (anti-false-green)', () => {
    // Even if an internal test was 100% successful with evidence
    const evidence = evaluateMetaCapabilityState({
      channel: 'threads',
      appId: CANONICAL_META_APP_ID,
      appMode: 'development',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: baseThreadsPermissions,
      internalTestSuccessObserved: true, // Internal test passed
    })

    // It must STILL be TEST_ROLE_ONLY, never PUBLIC_READY
    expect(evidence.capabilityState).toBe('TEST_ROLE_ONLY')
    expect(evidence.capabilityState).not.toBe('PUBLIC_READY')
    expect(evidence.isPublicCustomerReady).toBe(false)
  })

  it('blocks general public customer publish when capability is TEST_ROLE_ONLY (Fail-Closed)', () => {
    const evidence = evaluateMetaCapabilityState({
      channel: 'instagram',
      appId: CANONICAL_META_APP_ID,
      appMode: 'development',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: baseInstagramPermissions,
    })

    expect(() => {
      assertCustomerPublishAdmission(evidence, {
        role: 'public_customer',
        actorUserId: 'cust-1000',
      })
    }).toThrow(PublicCustomerPublishBlockedError)

    try {
      assertCustomerPublishAdmission(evidence, {
        role: 'public_customer',
        actorUserId: 'cust-1000',
      })
    } catch (err) {
      expect(err).toBeInstanceOf(PublicCustomerPublishBlockedError)
      const e = err as PublicCustomerPublishBlockedError
      expect(e.reasonCode).toBe('PUBLIC_CUSTOMER_PUBLISH_BLOCKED')
      expect(e.capabilityState).toBe('TEST_ROLE_ONLY')
      expect(e.channel).toBe('instagram')
    }
  })

  it('allows internal test-role operator to publish under TEST_ROLE_ONLY policy with explicit audit marker', () => {
    const evidence = evaluateMetaCapabilityState({
      channel: 'instagram',
      appId: CANONICAL_META_APP_ID,
      appMode: 'development',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: baseInstagramPermissions,
    })

    const decision = assertCustomerPublishAdmission(evidence, {
      role: 'internal_operator',
      actorUserId: 'tester-42',
      isTestRoleAccount: true,
    })

    expect(decision.allowed).toBe(true)
    expect(decision.executionAudience).toBe('TEST_ROLE_EXECUTION')
    expect(decision.requiresAuditFlag).toBe(true)
  })

  it('evaluates missing data deletion callback as BLOCKED', () => {
    const evidence = evaluateMetaCapabilityState({
      channel: 'instagram',
      appId: CANONICAL_META_APP_ID,
      appMode: 'live',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: false, // Missing callback!
      permissions: [
        { name: 'instagram_basic', granted: true, tier: 'advanced', reviewStatus: 'approved' },
        { name: 'instagram_content_publish', granted: true, tier: 'advanced', reviewStatus: 'approved' },
      ],
    })

    expect(evidence.capabilityState).toBe('BLOCKED')
    expect(evidence.isPublicCustomerReady).toBe(false)
    expect(evidence.reasons.some(r => r.includes('데이터 삭제 콜백'))).toBe(true)
  })

  it('evaluates live mode without advanced app review as REVIEW_REQUIRED', () => {
    const evidence = evaluateMetaCapabilityState({
      channel: 'threads',
      appId: CANONICAL_META_APP_ID,
      appMode: 'live',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: [
        { name: 'threads_basic', granted: true, tier: 'standard', reviewStatus: 'pending' },
        { name: 'threads_content_publish', granted: true, tier: 'standard', reviewStatus: 'pending' },
      ],
    })

    expect(evidence.capabilityState).toBe('REVIEW_REQUIRED')
    expect(evidence.isPublicCustomerReady).toBe(false)
    expect(evidence.reasons.some(r => r.includes('App Review'))).toBe(true)
  })

  it('evaluates full advanced live app with all approved permissions and callback as PUBLIC_READY', () => {
    const evidence = evaluateMetaCapabilityState({
      channel: 'instagram',
      appId: CANONICAL_META_APP_ID,
      appMode: 'live',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: [
        { name: 'instagram_basic', granted: true, tier: 'advanced', reviewStatus: 'approved' },
        { name: 'instagram_content_publish', granted: true, tier: 'advanced', reviewStatus: 'approved' },
      ],
    })

    expect(evidence.capabilityState).toBe('PUBLIC_READY')
    expect(evidence.isPublicCustomerReady).toBe(true)
    expect(evidence.reasons).toContain('Meta 플랫폼 정식 공개 배포 및 일반 고객 자율 실행이 승인되었습니다.')

    // Public customer admission should succeed!
    const decision = assertCustomerPublishAdmission(evidence, {
      role: 'public_customer',
      actorUserId: 'cust-1000',
    })
    expect(decision.allowed).toBe(true)
    expect(decision.executionAudience).toBe('PUBLIC_CUSTOMER_EXECUTION')
  })

  it('supports evidence timestamping, expiry, stale detection and revalidation window', () => {
    const now = new Date('2026-09-09T08:00:00Z')
    const evidence = evaluateMetaCapabilityState({
      channel: 'instagram',
      appId: CANONICAL_META_APP_ID,
      appMode: 'development',
      businessVerification: 'verified',
      dataDeletionCallbackConfigured: true,
      permissions: baseInstagramPermissions,
      observedAt: now.toISOString(),
      revalidationWindowSeconds: 3600,
    })

    expect(evidence.observedAt).toBe('2026-09-09T08:00:00.000Z')
    expect(evidence.expiresAt).toBe('2026-09-09T09:00:00.000Z')
    expect(evidence.revalidationWindowSeconds).toBe(3600)

    // At now + 30m: not stale
    expect(evidence.isStale(new Date('2026-09-09T08:30:00Z'))).toBe(false)

    // At now + 2h: stale
    expect(evidence.isStale(new Date('2026-09-09T10:00:00Z'))).toBe(true)

    // If stale, admission asserts FAIL-CLOSED
    expect(() => {
      assertCustomerPublishAdmission(evidence, {
        role: 'internal_operator',
        actorUserId: 'tester-42',
        isTestRoleAccount: true,
        evaluatedAt: new Date('2026-09-09T10:00:00Z'),
      })
    }).toThrow(/만료/)
  })

  it('provides getMetaCapabilityTruth with current runtime environment truth', () => {
    const truth = getMetaCapabilityTruth('instagram')
    expect(truth.channel).toBe('instagram')
    expect(truth.appId).toBe(CANONICAL_META_APP_ID)
    expect(['TEST_ROLE_ONLY', 'REVIEW_REQUIRED', 'PUBLIC_READY', 'BLOCKED']).toContain(truth.capabilityState)
    expect(truth.observedAt).toBeDefined()
    expect(truth.expiresAt).toBeDefined()
  })
})
