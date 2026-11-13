import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RealToolRegistry, type AdmittedToolDefinition } from '@/lib/agent-os/real-tool-registry'
import { evaluateSubscriptionHealthWithDb, type WebhookHealthState } from '@/features/channels/meta-webhook-health'
import { evaluateMetaAccessMode, type MetaAccessEvaluation } from '@/features/channels/meta-access-gate'

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'

describe('Wave 5: Channel · Webhook · Capability Truth (ANI-1044, ANI-1048, ANI-1049)', () => {
  describe('ANI-1044: Real Tool Registry + Execution Admission Gate', () => {
    it('only exposes real, implemented tools and completely excludes fake capabilities', async () => {
      const tools = await RealToolRegistry.getAdmittedTools({
        workspaceId: WORKSPACE_ID,
        actorUserId: ACTOR_ID,
        connectedChannels: ['instagram', 'threads'],
      })

      const toolNames = tools.map((t: AdmittedToolDefinition) => t.name)

      // Minimum 9th Tools must be present
      expect(toolNames).toContain('business_brand_read')
      expect(toolNames).toContain('marketing_work_create')
      expect(toolNames).toContain('content_draft_create')
      expect(toolNames).toContain('content_draft_revise')
      expect(toolNames).toContain('content_approval')
      expect(toolNames).toContain('instagram_supervised_publish')
      expect(toolNames).toContain('threads_supervised_publish')
      expect(toolNames).toContain('work_status_read')

      // Capability Theatre Prohibition: Must NOT expose fake/unimplemented tools
      expect(toolNames).not.toContain('reserve_seat_slot')
      expect(toolNames).not.toContain('predict_marketing_roi')
      expect(toolNames).not.toContain('occupancy_rate_query')
      expect(toolNames).not.toContain('crm_customer_blast')
      expect(toolNames).not.toContain('run_meta_ad_campaign')
      expect(toolNames).not.toContain('harness_override_mutation')
    })

    it('filters out channel-specific publish tools when channel is not connected', async () => {
      const tools = await RealToolRegistry.getAdmittedTools({
        workspaceId: WORKSPACE_ID,
        actorUserId: ACTOR_ID,
        connectedChannels: ['instagram'], // Threads disconnected
      })

      const toolNames = tools.map((t: AdmittedToolDefinition) => t.name)
      expect(toolNames).toContain('instagram_supervised_publish')
      expect(toolNames).not.toContain('threads_supervised_publish')
    })

    it('evaluates tool execution admission with user-readable blocked reason', async () => {
      // Trying to execute Instagram publish without approval
      const admission = await RealToolRegistry.checkExecutionAdmission({
        workspaceId: WORKSPACE_ID,
        toolName: 'instagram_supervised_publish',
        actorUserId: ACTOR_ID,
        inputPayload: {
          caption: '미승인 원고',
          // missing contentVersionId and expectedFingerprint
        },
      })

      expect(admission.admitted).toBe(false)
      expect(admission.reasonCode).toBe('APPROVAL_REQUIRED')
      expect(admission.message).toContain('원고 승인')
    })
  })

  describe('ANI-1048: Real Meta Webhook Truth (Signed Event Canary & Health Gate)', () => {
    it('returns PENDING when provider_webhook_events count is 0 (No False-Green Healthy)', () => {
      const health = evaluateSubscriptionHealthWithDb({
        channel: 'instagram',
        connectionStatus: 'connected',
        lastWebhookAt: null,
        providerEventCount: 0,
        recentErrorCount: 0,
        referenceNowMs: Date.now(),
      })

      expect(health.status).toBe('PENDING')
      expect(health.isListening).toBe(false)
      expect(health.reason).toContain('실제 공급자 서명 웹훅 이벤트가 아직 수신되지 않았습니다')
    })

    it('returns HEALTHY only when valid signed event exists within freshness window', () => {
      const now = Date.now()
      const health = evaluateSubscriptionHealthWithDb({
        channel: 'instagram',
        connectionStatus: 'connected',
        lastWebhookAt: new Date(now - 10 * 60 * 1000).toISOString(), // 10 mins ago
        providerEventCount: 5,
        recentErrorCount: 0,
        referenceNowMs: now,
      })

      expect(health.status).toBe('HEALTHY')
      expect(health.isListening).toBe(true)
      expect(health.lagSeconds).toBeLessThan(3600)
    })

    it('returns STALE when last event exceeds freshness threshold (>24 hours)', () => {
      const now = Date.now()
      const health = evaluateSubscriptionHealthWithDb({
        channel: 'instagram',
        connectionStatus: 'connected',
        lastWebhookAt: new Date(now - 30 * 3600 * 1000).toISOString(), // 30 hours ago
        providerEventCount: 1,
        recentErrorCount: 0,
        referenceNowMs: now,
      })

      expect(health.status).toBe('STALE')
      expect(health.isListening).toBe(false)
      expect(health.reason).toContain('지연/중단')
    })

    it('returns FAILED when recent errors exceed threshold', () => {
      const health = evaluateSubscriptionHealthWithDb({
        channel: 'threads',
        connectionStatus: 'connected',
        lastWebhookAt: new Date().toISOString(),
        providerEventCount: 2,
        recentErrorCount: 4,
        referenceNowMs: Date.now(),
      })

      expect(health.status).toBe('FAILED')
      expect(health.isListening).toBe(false)
    })
  })

  describe('ANI-1049: Meta INTERNAL_TEST vs PUBLIC_CUSTOMER_READY', () => {
    it('classifies Development mode + Test-Role account as INTERNAL_TEST_VERIFIED', () => {
      const evalResult = evaluateMetaAccessMode({
        channel: 'instagram',
        connectionStatus: 'connected',
        metaAppMode: 'development',
        appReviewStatus: 'unsubmitted',
        accessTier: 'standard',
        isTestRoleMember: true,
      })

      expect(evalResult.status).toBe('INTERNAL_TEST_VERIFIED')
      expect(evalResult.allowSupervisedExecution).toBe(true)
      expect(evalResult.allowPublicCustomerDelegation).toBe(false)
      expect(evalResult.publicCustomerReady).toBe(false)
      expect(evalResult.reason).toContain('내부 테스트 역할')
    })

    it('classifies Development mode + Non-test public customer as BLOCKED_EXTERNAL', () => {
      const evalResult = evaluateMetaAccessMode({
        channel: 'instagram',
        connectionStatus: 'connected',
        metaAppMode: 'development',
        appReviewStatus: 'unsubmitted',
        accessTier: 'standard',
        isTestRoleMember: false,
      })

      expect(evalResult.status).toBe('BLOCKED_EXTERNAL')
      expect(evalResult.allowSupervisedExecution).toBe(false)
      expect(evalResult.allowPublicCustomerDelegation).toBe(false)
      expect(evalResult.publicCustomerReady).toBe(false)
      expect(evalResult.reason).toContain('App Review')
    })

    it('classifies Live mode + Approved App Review + Advanced Access as PUBLIC_CUSTOMER_READY', () => {
      const evalResult = evaluateMetaAccessMode({
        channel: 'instagram',
        connectionStatus: 'connected',
        metaAppMode: 'live',
        appReviewStatus: 'approved',
        accessTier: 'advanced',
        isTestRoleMember: false,
      })

      expect(evalResult.status).toBe('PUBLIC_CUSTOMER_READY')
      expect(evalResult.allowSupervisedExecution).toBe(true)
      expect(evalResult.allowPublicCustomerDelegation).toBe(true)
      expect(evalResult.publicCustomerReady).toBe(true)
    })
  })
})
