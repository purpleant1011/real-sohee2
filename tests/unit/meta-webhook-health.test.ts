import { describe, expect, it, vi } from 'vitest'
import {
  evaluateSubscriptionHealth,
  type SubscriptionHealthContext,
} from '@/features/channels/meta-webhook-health'

describe('Meta Webhook Subscription Health & Control Plane (ANI-1010)', () => {
  it('reports PENDING when connection exists but zero webhook events have been received', () => {
    const context: SubscriptionHealthContext = {
      channel: 'instagram',
      connectionStatus: 'connected',
      subscribedFields: ['comments', 'messages'],
      lastWebhookAt: null,
      lastProviderEventAt: null,
      recentErrorCount: 0,
    }

    const health = evaluateSubscriptionHealth(context)

    expect(health.status).toBe('PENDING')
    expect(health.isListening).toBe(false)
    expect(health.reason).toContain('웹훅 이벤트가 아직 수신되지 않았습니다')
  })

  it('reports LISTENING when valid webhook events are recently received and lag is low', () => {
    const now = Date.now()
    const fiveMinutesAgo = new Date(now - 5 * 60 * 1000).toISOString()

    const context: SubscriptionHealthContext = {
      channel: 'instagram',
      connectionStatus: 'connected',
      subscribedFields: ['comments', 'messages'],
      lastWebhookAt: fiveMinutesAgo,
      lastProviderEventAt: fiveMinutesAgo,
      recentErrorCount: 0,
    }

    const health = evaluateSubscriptionHealth(context, now)

    expect(health.status).toBe('LISTENING')
    expect(health.isListening).toBe(true)
    expect(health.lagSeconds).toBe(300)
  })

  it('reports DEGRADED when last webhook event is stale (> 24 hours ago)', () => {
    const now = Date.now()
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString()

    const context: SubscriptionHealthContext = {
      channel: 'threads',
      connectionStatus: 'connected',
      subscribedFields: ['replies'],
      lastWebhookAt: twoDaysAgo,
      lastProviderEventAt: twoDaysAgo,
      recentErrorCount: 0,
    }

    const health = evaluateSubscriptionHealth(context, now)

    expect(health.status).toBe('DEGRADED')
    expect(health.isListening).toBe(false)
    expect(health.reason).toContain('웹훅 수신이 지연/중단되었습니다')
  })

  it('reports ERROR when recent processing errors exceed threshold', () => {
    const now = Date.now()
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString()

    const context: SubscriptionHealthContext = {
      channel: 'instagram',
      connectionStatus: 'connected',
      subscribedFields: ['comments'],
      lastWebhookAt: tenMinutesAgo,
      lastProviderEventAt: tenMinutesAgo,
      recentErrorCount: 5,
    }

    const health = evaluateSubscriptionHealth(context, now)

    expect(health.status).toBe('ERROR')
    expect(health.isListening).toBe(false)
  })
})
