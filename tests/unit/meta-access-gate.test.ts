import { describe, expect, it } from 'vitest'
import {
  evaluateMetaAccessGate,
  type MetaAccessGateConfig,
} from '@/features/channels/meta-access-gate'

describe('Meta Production Access Gate (ANI-1008)', () => {
  const baseConfig: MetaAccessGateConfig = {
    appId: '1568352131460103',
    appMode: 'development',
    accessLevel: 'standard',
    reviewStatus: 'unsubmitted',
    businessVerificationStatus: 'unverified',
    lastVerifiedAt: '2026-09-07T00:00:00Z',
  }

  it('classifies unapproved development app as TEST_ROLE_ONLY and blocks general customer delegation', () => {
    const gate = evaluateMetaAccessGate(baseConfig, {
      userRole: 'general_customer',
      capability: 'instagram_feed_publish',
    })

    expect(gate.audience).toBe('TEST_ROLE_ONLY')
    expect(gate.allowed).toBe(false)
    expect(gate.gateCode).toBe('META_APP_NOT_LIVE')
    expect(gate.isProductionDelegatedAllowed).toBe(false)
    expect(gate.reason).toContain('앱이 라이브 상태가 아닙니다')
  })

  it('allows app tester/developer roles in development mode with TEST_ROLE_ONLY audience', () => {
    const gate = evaluateMetaAccessGate(baseConfig, {
      userRole: 'developer_or_tester',
      capability: 'instagram_feed_publish',
    })

    expect(gate.audience).toBe('TEST_ROLE_ONLY')
    expect(gate.allowed).toBe(true)
    expect(gate.isProductionDelegatedAllowed).toBe(false)
    expect(gate.gateCode).toBe('TEST_ROLE_PERMITTED')
  })

  it('blocks production publication if app is live but capability has only Standard Access and no review approval', () => {
    const liveStandardConfig: MetaAccessGateConfig = {
      ...baseConfig,
      appMode: 'live',
      accessLevel: 'standard',
      reviewStatus: 'pending',
    }

    const gate = evaluateMetaAccessGate(liveStandardConfig, {
      userRole: 'general_customer',
      capability: 'instagram_comment_reply',
    })

    expect(gate.audience).toBe('TEST_ROLE_ONLY')
    expect(gate.allowed).toBe(false)
    expect(gate.gateCode).toBe('ADVANCED_ACCESS_REQUIRED')
    expect(gate.isProductionDelegatedAllowed).toBe(false)
  })

  it('grants PRODUCTION_DELEGATED and allows capability when app is live, advanced access is granted, and review is approved', () => {
    const productionReadyConfig: MetaAccessGateConfig = {
      ...baseConfig,
      appMode: 'live',
      accessLevel: 'advanced',
      reviewStatus: 'approved',
      businessVerificationStatus: 'verified',
    }

    const gate = evaluateMetaAccessGate(productionReadyConfig, {
      userRole: 'general_customer',
      capability: 'instagram_comment_reply',
    })

    expect(gate.audience).toBe('PRODUCTION_DELEGATED')
    expect(gate.allowed).toBe(true)
    expect(gate.gateCode).toBe('PRODUCTION_ACCESS_APPROVED')
    expect(gate.isProductionDelegatedAllowed).toBe(true)
  })

  it('rejects unknown or invalid Meta App ID', () => {
    const invalidAppConfig: MetaAccessGateConfig = {
      ...baseConfig,
      appId: '9999999999999999',
    }

    const gate = evaluateMetaAccessGate(invalidAppConfig, {
      userRole: 'general_customer',
      capability: 'instagram_feed_publish',
    })

    expect(gate.allowed).toBe(false)
    expect(gate.gateCode).toBe('INVALID_META_APP_ID')
  })
})
