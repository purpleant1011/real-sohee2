import { describe, expect, it } from 'vitest'
import {
  evaluateCapabilityState,
  type CapabilityDefinition,
  type CapabilityEvaluationContext,
} from '@/features/channels/meta-capability-registry'

describe('Meta Capability Registry Contract (ANI-1009)', () => {
  const sampleCapability: CapabilityDefinition = {
    id: 'instagram_comment_reply',
    channel: 'instagram',
    name: 'Instagram 댓글 자동 답글',
    metaPermission: 'instagram_business_manage_comments',
    requiredScope: 'instagram_business_manage_comments',
    webhookField: 'comments',
    consentScope: 'reply_comments',
    runtimeTool: 'sendCommentReply',
    actionKind: 'INSTAGRAM_COMMENT_REPLY',
    providerReadback: true,
  }

  const baseContext: CapabilityEvaluationContext = {
    hasConnection: true,
    connectionStatus: 'connected',
    tokenScopes: ['instagram_business_manage_comments'],
    hasWebhookSubscription: true,
    hasConsent: true,
    hasAutonomousConsent: false,
    hasRuntimeTool: true,
    isKillSwitchBlocked: false,
    accessGateAllowed: true,
    proofCount: 0,
    lastReceiptAt: null,
  }

  it('evaluates state as EXECUTABLE when connected, authorized, listening, consented, and tool available, but has zero proof', () => {
    const evaluation = evaluateCapabilityState(sampleCapability, baseContext)

    expect(evaluation.state).toBe('EXECUTABLE')
    expect(evaluation.proofStatus).toBe('NO_PROOF')
    expect(evaluation.isExecutable).toBe(true)
    expect(evaluation.isProven).toBe(false)
    expect(evaluation.isAutonomous).toBe(false)
  })

  it('promotes to PROVEN when observed receipts exist in production ledger', () => {
    const contextWithProof: CapabilityEvaluationContext = {
      ...baseContext,
      proofCount: 3,
      lastReceiptAt: '2026-09-07T05:00:00Z',
    }

    const evaluation = evaluateCapabilityState(sampleCapability, contextWithProof)

    expect(evaluation.state).toBe('PROVEN')
    expect(evaluation.proofStatus).toBe('PROVEN')
    expect(evaluation.isProven).toBe(true)
    expect(evaluation.lastSuccessAt).toBe('2026-09-07T05:00:00Z')
  })

  it('promotes to AUTONOMOUS when autonomous delegation consent is active and proven', () => {
    const autonomousContext: CapabilityEvaluationContext = {
      ...baseContext,
      hasAutonomousConsent: true,
      proofCount: 5,
      lastReceiptAt: '2026-09-07T05:10:00Z',
    }

    const evaluation = evaluateCapabilityState(sampleCapability, autonomousContext)

    expect(evaluation.state).toBe('AUTONOMOUS')
    expect(evaluation.isAutonomous).toBe(true)
  })

  it('drops to AUTHORIZED when webhook subscription is missing (not LISTENING)', () => {
    const noWebhookContext: CapabilityEvaluationContext = {
      ...baseContext,
      hasWebhookSubscription: false,
    }

    const evaluation = evaluateCapabilityState(sampleCapability, noWebhookContext)

    expect(evaluation.state).toBe('AUTHORIZED')
    expect(evaluation.isExecutable).toBe(false)
    expect(evaluation.failureCode).toBe('WEBHOOK_SUBSCRIPTION_MISSING')
  })

  it('drops to CONNECTED when token scope is absent (not AUTHORIZED)', () => {
    const noScopeContext: CapabilityEvaluationContext = {
      ...baseContext,
      tokenScopes: [], // missing requiredScope
    }

    const evaluation = evaluateCapabilityState(sampleCapability, noScopeContext)

    expect(evaluation.state).toBe('CONNECTED')
    expect(evaluation.failureCode).toBe('META_PERMISSION_MISSING')
  })

  it('detects SCOPE_DRIFT when token has other scopes but is missing the specific required scope (ANI-1011)', () => {
    const scopeDriftContext: CapabilityEvaluationContext = {
      ...baseContext,
      tokenScopes: ['threads_basic', 'threads_content_publish'], // missing required threads_manage_mentions
    }

    const evaluation = evaluateCapabilityState(
      {
        id: 'threads_mentions',
        channel: 'threads',
        name: 'Threads 멘션 모니터링',
        metaPermission: 'threads_manage_mentions',
        requiredScope: 'threads_manage_mentions',
        webhookField: 'mentions',
        consentScope: 'read_comments',
        runtimeTool: 'readMentions',
        actionKind: 'THREADS_MENTIONS_READ',
        providerReadback: false,
      },
      scopeDriftContext,
    )

    expect(evaluation.state).toBe('CONNECTED')
    expect(evaluation.failureCode).toBe('SCOPE_DRIFT')
  })

  it('blocks EXECUTABLE when active consent is revoked or missing', () => {
    const noConsentContext: CapabilityEvaluationContext = {
      ...baseContext,
      hasConsent: false,
    }

    const evaluation = evaluateCapabilityState(sampleCapability, noConsentContext)

    expect(evaluation.state).toBe('LISTENING')
    expect(evaluation.isExecutable).toBe(false)
    expect(evaluation.failureCode).toBe('CONSENT_MISSING')
  })

  it('blocks EXECUTABLE when kill-switch is active', () => {
    const killSwitchContext: CapabilityEvaluationContext = {
      ...baseContext,
      isKillSwitchBlocked: true,
    }

    const evaluation = evaluateCapabilityState(sampleCapability, killSwitchContext)

    expect(evaluation.isExecutable).toBe(false)
    expect(evaluation.failureCode).toBe('KILL_SWITCH_ACTIVE')
  })
})
