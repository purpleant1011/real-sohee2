import { describe, it, expect } from 'vitest'
import { evaluatePluginExecutableReady } from '../router/plugin-ready-gate'
import type { SoheePluginManifest, WorkspaceInstalledPlugin } from '@/types/plugin-platform'

describe('Plugin READY Fail-Closed Gate (ANI-804)', () => {
  const baseManifest: SoheePluginManifest = {
    pluginId: 'plg_instagram_growth',
    slug: 'instagram-growth',
    displayName: '인스타그램 자율 성장 & 예약 연동',
    version: '1.2.0',
    publisherId: 'pub_sohee_core',
    publisherType: 'SOHEE',
    summary: '인스타그램 피드 자동 발행 및 DM 예약 상담 연동',
    categories: ['SNS', 'Marketing'],
    outcomeTags: ['인스타그램 성장', '예약 늘리기'],
    icon: 'Instagram',
    trustTier: 'SOHEE_CORE',
    minPlanTier: 'TIER_300K_GROWTH',
    entitlementKey: 'ent_instagram_marketing',
    capabilities: [
      {
        capabilityId: 'cap_insta_publish',
        name: '인스타그램 피드 발행',
        description: '인스타그램 비즈니스 피드 및 릴스 발행',
        actionRiskTier: 'R1_MODERATE',
        riskClass: 'WRITE',
        requiredScopes: ['instagram_basic', 'instagram_content_publish'],
        creditCostWeight: 1.5,
        supportsIdempotency: true,
        requiresExternalVerification: true,
      },
    ],
    requiredScopes: ['instagram_basic', 'instagram_content_publish'],
    approvalDefault: 'ASK_ON_CHANGE',
    creditMeteringPolicyId: 'meter_standard_publish',
  }

  const baseInstallation: WorkspaceInstalledPlugin = {
    installationId: 'inst-1',
    workspaceId: 'ws-main',
    pluginId: 'plg_instagram_growth',
    manifestVersion: '1.2.0',
    state: 'READY',
    installedAt: '2026-09-01T00:00:00Z',
    connectedAccountId: 'acc_insta_123',
    healthStatus: 'HEALTHY',
    lastHealthCheckedAt: '2026-09-06T06:00:00Z',
    approvalMode: 'ASK_ON_CHANGE',
    isCircuitBreakerOpen: false,
  }

  it('evaluates to isReady=true when all 12 criteria are satisfied', () => {
    const res = evaluatePluginExecutableReady({
      workspaceId: 'ws-main',
      manifest: baseManifest,
      installation: baseInstallation,
      currentPlanTier: 'TIER_300K_GROWTH',
      userRole: 'OWNER',
      targetCapabilityId: 'cap_insta_publish',
      creditBalance: 100,
      estimatedCreditCost: 15,
      isProviderHealthy: true,
      isPolicyAllowed: true,
      isRiskApproved: true,
    })

    expect(res.isReady).toBe(true)
    expect(res.failingChecks).toHaveLength(0)
    expect(res.blockedReason).toBeNull()
    expect(res.stateCopy).toBe('준비 완료 (READY)')
  })

  it('fails closed when not installed', () => {
    const res = evaluatePluginExecutableReady({
      workspaceId: 'ws-main',
      manifest: baseManifest,
      installation: null,
      currentPlanTier: 'TIER_300K_GROWTH',
      creditBalance: 100,
    })

    expect(res.isReady).toBe(false)
    expect(res.failingChecks).toContain('installed')
  })

  it('fails closed when plan tier is lower than minPlanTier', () => {
    const res = evaluatePluginExecutableReady({
      workspaceId: 'ws-main',
      manifest: baseManifest,
      installation: baseInstallation,
      currentPlanTier: 'FREE_TASTE',
      creditBalance: 100,
    })

    expect(res.isReady).toBe(false)
    expect(res.failingChecks).toContain('entitlement_allowed')
    expect(res.blockedReason).toContain('요금제')
  })

  it('fails closed when credit balance is less than estimatedCreditCost', () => {
    const res = evaluatePluginExecutableReady({
      workspaceId: 'ws-main',
      manifest: baseManifest,
      installation: baseInstallation,
      currentPlanTier: 'TIER_300K_GROWTH',
      creditBalance: 5,
      estimatedCreditCost: 20,
    })

    expect(res.isReady).toBe(false)
    expect(res.failingChecks).toContain('credit_preflight_passed')
  })

  it('fails closed when circuit breaker is open', () => {
    const res = evaluatePluginExecutableReady({
      workspaceId: 'ws-main',
      manifest: baseManifest,
      installation: { ...baseInstallation, isCircuitBreakerOpen: true },
      currentPlanTier: 'TIER_300K_GROWTH',
      creditBalance: 100,
    })

    expect(res.isReady).toBe(false)
    expect(res.failingChecks).toContain('circuit_breaker_closed')
  })

  it('fails closed when plugin version is blocked by administrator', () => {
    const res = evaluatePluginExecutableReady({
      workspaceId: 'ws-main',
      manifest: baseManifest,
      installation: baseInstallation,
      currentPlanTier: 'TIER_300K_GROWTH',
      creditBalance: 100,
      blockedPluginVersions: ['1.2.0'],
    })

    expect(res.isReady).toBe(false)
    expect(res.failingChecks).toContain('plugin_version_not_blocked')
  })
})
