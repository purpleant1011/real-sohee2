import { describe, it, expect } from 'vitest'
import {
  FUNNEL_STEPS,
  type FunnelEventPayload,
  type FailureCategory,
  sanitizeTelemetryMetadata,
  validateFunnelEvent,
  calculateFunnelMetrics,
  aggregateFailureTaxonomy,
  createFunnelEvent,
} from '@/features/telemetry/first-post-funnel-telemetry'

describe('ANI-1436: Time to First Verified Post Funnel Telemetry', () => {
  describe('1. Funnel Steps & Lifecycle Order', () => {
    it('defines the complete 16-step onboarding to verified post lifecycle', () => {
      expect(FUNNEL_STEPS).toHaveLength(16)
      expect(FUNNEL_STEPS[0]).toBe('ONBOARDING_START')
      expect(FUNNEL_STEPS[5]).toBe('PROVIDER_VERIFIED')
      expect(FUNNEL_STEPS[10]).toBe('SOHEE_READY_ACHIEVED')
      expect(FUNNEL_STEPS[12]).toBe('EXACT_APPROVAL')
      expect(FUNNEL_STEPS[14]).toBe('EXTERNALLY_VERIFIED')
      expect(FUNNEL_STEPS[15]).toBe('FIRST_POST_COMPLETE')
    })

    it('validates a valid funnel event and rejects invalid payload', () => {
      const validEvent: FunnelEventPayload = {
        workspaceId: 'ws-cafe-1',
        correlationId: 'corr-session-123',
        step: 'ONBOARDING_START',
        stepIndex: 0,
        timestamp: new Date().toISOString(),
        metadata: { channel: 'web' },
      }

      const validation = validateFunnelEvent(validEvent)
      expect(validation.isValid).toBe(true)

      const invalidEvent: any = {
        workspaceId: '',
        correlationId: 'corr-session-123',
        step: 'UNKNOWN_STEP',
      }
      const invalidValidation = validateFunnelEvent(invalidEvent)
      expect(invalidValidation.isValid).toBe(false)
      expect(invalidValidation.errors.length).toBeGreaterThan(0)
    })
  })

  describe('2. Zero PII & Sensitive Token Redaction Guard', () => {
    it('redacts passwords, authorization tokens, and API keys from metadata', () => {
      const rawMetadata = {
        action: 'oauth_token_exchange',
        token: 'Bearer ya29.a0AfH6SMB...',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
        password: 'mySecretPassword123!',
        userApiKey: 'sk-ant-api03-abcdef1234567890',
        businessName: '달콤카페',
      }

      const sanitized = sanitizeTelemetryMetadata(rawMetadata)
      expect(sanitized.token).toBe('[REDACTED_SECRET]')
      expect(sanitized.jwt).toBe('[REDACTED_SECRET]')
      expect(sanitized.password).toBe('[REDACTED_SECRET]')
      expect(sanitized.userApiKey).toBe('[REDACTED_SECRET]')
      expect(sanitized.businessName).toBe('달콤카페')
    })

    it('truncates raw verbose prompts to prevent prompt injection and data bloat', () => {
      const longPrompt = 'A'.repeat(500)
      const sanitized = sanitizeTelemetryMetadata({
        prompt: longPrompt,
        instruction: '짧은 지시사항',
      })

      expect(typeof sanitized.prompt).toBe('string')
      expect((sanitized.prompt as string).length).toBeLessThanOrEqual(120)
      expect((sanitized.prompt as string).endsWith('...[TRUNCATED]')).toBe(true)
      expect(sanitized.instruction).toBe('짧은 지시사항')
    })

    it('redacts potential personal identification numbers (credit card, resident reg number)', () => {
      const sensitiveInput = {
        memo: '사장님 주민번호: 880101-1234567 및 카드 1234-5678-9012-3456',
      }
      const sanitized = sanitizeTelemetryMetadata(sensitiveInput)
      expect(sanitized.memo).not.toContain('880101-1234567')
      expect(sanitized.memo).not.toContain('1234-5678-9012-3456')
      expect(sanitized.memo).toContain('[REDACTED_PII]')
    })
  })

  describe('3. Event Creation & Duration Calculation', () => {
    it('computes durationMsFromStart relative to correlation start timestamp', () => {
      const startTime = new Date(Date.now() - 15000).toISOString() // 15s ago
      const event = createFunnelEvent({
        workspaceId: 'ws-cafe-1',
        correlationId: 'corr-trace-1',
        step: 'PROVIDER_VERIFIED',
        correlationStartTime: startTime,
        metadata: { provider: 'instagram', handle: '@cafe_dalkom' },
      })

      expect(event.step).toBe('PROVIDER_VERIFIED')
      expect(event.stepIndex).toBe(5)
      expect(event.durationMsFromStart).toBeGreaterThanOrEqual(14000)
      expect(event.durationMsFromStart).toBeLessThanOrEqual(16000)
    })
  })

  describe('4. Funnel Metrics & Conversion Engine', () => {
    it('calculates conversion rate and drop-off accurately across multiple journeys', () => {
      const now = Date.now()

      // Journey 1: Complete journey (all 16 steps)
      const journey1: FunnelEventPayload[] = FUNNEL_STEPS.map((step, idx) => ({
        workspaceId: 'ws-1',
        correlationId: 'trace-1',
        step,
        stepIndex: idx,
        timestamp: new Date(now - (16 - idx) * 10000).toISOString(),
        durationMsFromStart: idx * 10000,
      }))

      // Journey 2: Drops off after PROVIDER_VERIFIED (step 5)
      const journey2: FunnelEventPayload[] = FUNNEL_STEPS.slice(0, 6).map((step, idx) => ({
        workspaceId: 'ws-1',
        correlationId: 'trace-2',
        step,
        stepIndex: idx,
        timestamp: new Date(now - (16 - idx) * 10000).toISOString(),
        durationMsFromStart: idx * 10000,
      }))

      // Journey 3: Drops off at EXACT_APPROVAL (step 12)
      const journey3: FunnelEventPayload[] = FUNNEL_STEPS.slice(0, 13).map((step, idx) => ({
        workspaceId: 'ws-1',
        correlationId: 'trace-3',
        step,
        stepIndex: idx,
        timestamp: new Date(now - (16 - idx) * 10000).toISOString(),
        durationMsFromStart: idx * 10000,
      }))

      const allEvents = [...journey1, ...journey2, ...journey3]
      const metrics = calculateFunnelMetrics(allEvents, 'ws-1')

      expect(metrics.totalJourneys).toBe(3)
      expect(metrics.completedJourneys).toBe(1)
      expect(metrics.overallConversionRatePct).toBeCloseTo(33.33, 1)

      // Step conversions:
      // ONBOARDING_START: 3/3 (100%)
      expect(metrics.steps[0].step).toBe('ONBOARDING_START')
      expect(metrics.steps[0].reachCount).toBe(3)
      expect(metrics.steps[0].conversionFromStartPct).toBe(100)

      // PROVIDER_VERIFIED: 3/3 reached
      expect(metrics.steps[5].step).toBe('PROVIDER_VERIFIED')
      expect(metrics.steps[5].reachCount).toBe(3)

      // KNOWLEDGE_CONFIRMED: 2/3 reached (Journey 2 dropped off)
      expect(metrics.steps[6].step).toBe('KNOWLEDGE_CONFIRMED')
      expect(metrics.steps[6].reachCount).toBe(2)
      expect(metrics.steps[6].dropOffFromPrevPct).toBeCloseTo(33.33, 1)

      // FIRST_POST_COMPLETE: 1/3 reached
      expect(metrics.steps[15].step).toBe('FIRST_POST_COMPLETE')
      expect(metrics.steps[15].reachCount).toBe(1)
      expect(metrics.steps[15].conversionFromStartPct).toBeCloseTo(33.33, 1)

      // Time to First Verified Post metrics
      expect(metrics.timeToFirstVerifiedPostSec.totalCompletedCount).toBe(1)
      expect(metrics.timeToFirstVerifiedPostSec.avgSeconds).toBe(150) // 15 steps * 10s = 150s
      expect(metrics.timeToFirstVerifiedPostSec.medianSeconds).toBe(150)
    })
  })

  describe('5. Failure Taxonomy & Root Cause Aggregation', () => {
    it('aggregates failure categories and identifies biggest blockers', () => {
      const failureEvents: FunnelEventPayload[] = [
        {
          workspaceId: 'ws-1',
          correlationId: 'trace-f1',
          step: 'OAUTH_CALLBACK',
          stepIndex: 4,
          timestamp: new Date().toISOString(),
          metadata: {
            failureCategory: 'OAUTH_REJECTED' as FailureCategory,
            errorMessage: 'User canceled provider authorization',
          },
        },
        {
          workspaceId: 'ws-1',
          correlationId: 'trace-f2',
          step: 'OAUTH_CALLBACK',
          stepIndex: 4,
          timestamp: new Date().toISOString(),
          metadata: {
            failureCategory: 'OAUTH_REJECTED' as FailureCategory,
            errorMessage: 'User denied scope access',
          },
        },
        {
          workspaceId: 'ws-1',
          correlationId: 'trace-f3',
          step: 'PROVIDER_VERIFIED',
          stepIndex: 5,
          timestamp: new Date().toISOString(),
          metadata: {
            failureCategory: 'CAPABILITY_FAILED' as FailureCategory,
            errorMessage: 'Permission missing for feed publishing',
          },
        },
        {
          workspaceId: 'ws-1',
          correlationId: 'trace-f4',
          step: 'EXTERNALLY_VERIFIED',
          stepIndex: 14,
          timestamp: new Date().toISOString(),
          metadata: {
            failureCategory: 'READBACK_TIMEOUT' as FailureCategory,
            errorMessage: 'Meta live permalink could not be verified in 30s',
          },
        },
      ]

      const taxonomy = aggregateFailureTaxonomy(failureEvents)
      expect(taxonomy.totalFailures).toBe(4)
      expect(taxonomy.breakdown[0].category).toBe('OAUTH_REJECTED')
      expect(taxonomy.breakdown[0].count).toBe(2)
      expect(taxonomy.breakdown[0].percentage).toBe(50)

      expect(taxonomy.breakdown[1].category).toBe('CAPABILITY_FAILED')
      expect(taxonomy.breakdown[1].count).toBe(1)
      expect(taxonomy.breakdown[1].percentage).toBe(25)

      expect(taxonomy.breakdown[2].category).toBe('READBACK_TIMEOUT')
      expect(taxonomy.breakdown[2].count).toBe(1)
      expect(taxonomy.breakdown[2].percentage).toBe(25)
    })
  })

  describe('6. Tenant Isolation Guard', () => {
    it('strictly isolates events and metrics between different workspaces', () => {
      const events: FunnelEventPayload[] = [
        {
          workspaceId: 'ws-tenant-A',
          correlationId: 'trace-A-1',
          step: 'ONBOARDING_START',
          stepIndex: 0,
          timestamp: new Date().toISOString(),
        },
        {
          workspaceId: 'ws-tenant-B',
          correlationId: 'trace-B-1',
          step: 'ONBOARDING_START',
          stepIndex: 0,
          timestamp: new Date().toISOString(),
        },
        {
          workspaceId: 'ws-tenant-B',
          correlationId: 'trace-B-1',
          step: 'FIRST_POST_COMPLETE',
          stepIndex: 15,
          timestamp: new Date().toISOString(),
          durationMsFromStart: 60000,
        },
      ]

      const metricsA = calculateFunnelMetrics(events, 'ws-tenant-A')
      expect(metricsA.totalJourneys).toBe(1)
      expect(metricsA.completedJourneys).toBe(0)

      const metricsB = calculateFunnelMetrics(events, 'ws-tenant-B')
      expect(metricsB.totalJourneys).toBe(1)
      expect(metricsB.completedJourneys).toBe(1)
    })
  })
})
