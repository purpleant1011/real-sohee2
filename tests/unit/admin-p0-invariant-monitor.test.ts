import { describe, it, expect } from 'vitest'
import {
  evaluateP0Invariants,
  type SystemTelemetrySnapshot,
  type P0InvariantCode,
  ALL_P0_INVARIANT_CODES,
} from '@/lib/admin-ops/p0-invariant-monitor'

describe('Wave 7: Admin P0 Invariant Monitor & Supabase Security Closure (ANI-1050, ANI-1051)', () => {
  describe('ANI-1051: P0 Invariant Detection & Anti-False-Green Engine', () => {
    it('defines the canonical P0 invariant codes (including 10th Creative Invariants)', () => {
      expect(ALL_P0_INVARIANT_CODES).toEqual([
        'EDGE_AGENT_BYPASS',
        'DURABLE_CHAT_ZERO_WRITE',
        'WORKSPACE_CONTEXT_SPLIT_BRAIN',
        'FAKE_CAPABILITY_EXPOSED',
        'CONTENT_WITHOUT_DURABLE_VERSION',
        'APPROVAL_WITHOUT_DB_ROW',
        'EXTERNAL_ACTION_WITHOUT_LEDGER',
        'AGED_RESULT_UNKNOWN',
        'WEBHOOK_FALSE_GREEN',
        'UNEXPECTED_SECURITY_DEFINER_GRANT',
        'RELEASE_IDENTITY_MISMATCH',
        'STATIC_OR_STOCK_MEDIA_IN_PRODUCTION',
        'MEDIA_ASSET_LINEAGE_MISSING',
        'CREATIVE_BUNDLE_NOT_APPROVED',
        'PROVIDER_VISUAL_MISMATCH',
        'SUPABASE_SECURITY_ADVISOR_ERROR',
        'META_PUBLIC_NOT_READY_MISREPRESENTED',
      ])
    })

    it('reports allClear = true only when all 11 invariants are zero', () => {
      const healthySnapshot: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 5,
        durableMessagesCount: 15,
        workspaceContextMatch: true,
        exposedToolNames: [
          'business_brand_read',
          'marketing_work_create',
          'content_draft_create',
          'content_draft_revise',
          'content_approval',
          'instagram_supervised_publish',
          'threads_supervised_publish',
          'work_status_read',
        ],
        contentItemsCount: 3,
        contentVersionsCount: 6,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 12,
        webhookStatus: 'HEALTHY',
        anonSecurityDefinerExecutables: [],
        releaseIdentityMatches: true,
      }

      const result = evaluateP0Invariants(healthySnapshot)
      expect(result.allClear).toBe(true)
      expect(result.violations).toHaveLength(0)
      expect(result.hasP0Violation).toBe(false)
    })

    it('detects DURABLE_CHAT_ZERO_WRITE failure (threads > 0 but messages = 0)', () => {
      const failureSnapshot: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 3,
        durableMessagesCount: 0, // Zero messages written!
        workspaceContextMatch: true,
        exposedToolNames: ['business_brand_read'],
        contentItemsCount: 0,
        contentVersionsCount: 0,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 0,
        webhookStatus: 'PENDING',
        anonSecurityDefinerExecutables: [],
        releaseIdentityMatches: true,
      }

      const result = evaluateP0Invariants(failureSnapshot)
      expect(result.allClear).toBe(false)
      expect(result.hasP0Violation).toBe(true)
      const codes = result.violations.map((v) => v.code)
      expect(codes).toContain('DURABLE_CHAT_ZERO_WRITE')
    })

    it('detects WEBHOOK_FALSE_GREEN failure (providerEventCount = 0 but status = HEALTHY)', () => {
      const failureSnapshot: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 1,
        durableMessagesCount: 5,
        workspaceContextMatch: true,
        exposedToolNames: ['business_brand_read'],
        contentItemsCount: 1,
        contentVersionsCount: 1,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 0, // Zero events!
        webhookStatus: 'HEALTHY', // False green!
        anonSecurityDefinerExecutables: [],
        releaseIdentityMatches: true,
      }

      const result = evaluateP0Invariants(failureSnapshot)
      expect(result.allClear).toBe(false)
      const codes = result.violations.map((v) => v.code)
      expect(codes).toContain('WEBHOOK_FALSE_GREEN')
    })

    it('detects FAKE_CAPABILITY_EXPOSED failure when model sees fake tools', () => {
      const failureSnapshot: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 1,
        durableMessagesCount: 5,
        workspaceContextMatch: true,
        exposedToolNames: ['business_brand_read', 'predict_marketing_roi'], // Fake tool exposed!
        contentItemsCount: 1,
        contentVersionsCount: 1,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 1,
        webhookStatus: 'HEALTHY',
        anonSecurityDefinerExecutables: [],
        releaseIdentityMatches: true,
      }

      const result = evaluateP0Invariants(failureSnapshot)
      expect(result.allClear).toBe(false)
      const codes = result.violations.map((v) => v.code)
      expect(codes).toContain('FAKE_CAPABILITY_EXPOSED')
    })

    it('detects UNEXPECTED_SECURITY_DEFINER_GRANT failure (ANI-1050 integration)', () => {
      const failureSnapshot: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 1,
        durableMessagesCount: 5,
        workspaceContextMatch: true,
        exposedToolNames: ['business_brand_read'],
        contentItemsCount: 1,
        contentVersionsCount: 1,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 1,
        webhookStatus: 'HEALTHY',
        anonSecurityDefinerExecutables: ['complete_channel_verification_v12'], // Anon can execute!
        releaseIdentityMatches: true,
      }

      const result = evaluateP0Invariants(failureSnapshot)
      expect(result.allClear).toBe(false)
      const codes = result.violations.map((v) => v.code)
      expect(codes).toContain('UNEXPECTED_SECURITY_DEFINER_GRANT')
    })

    it('detects 10th revision invariants: STATIC_OR_STOCK_MEDIA_IN_PRODUCTION and SUPABASE_SECURITY_ADVISOR_ERROR (ANI-1089)', () => {
      const tenthFailureSnapshot: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 2,
        durableMessagesCount: 5,
        workspaceContextMatch: true,
        exposedToolNames: ['business_brand_read'],
        contentItemsCount: 1,
        contentVersionsCount: 1,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 1,
        webhookStatus: 'HEALTHY',
        anonSecurityDefinerExecutables: [],
        releaseIdentityMatches: true,

        // 10th failures
        staticOrStockPublishAttempts: 1, // Attempted to use static image!
        securityAdvisorErrorsCount: 2, // 2 unclosed security advisor errors!
        publishedWithCanonicalMediaOnly: false,
      }

      const result = evaluateP0Invariants(tenthFailureSnapshot)
      expect(result.allClear).toBe(false)
      const codes = result.violations.map((v) => v.code)
      expect(codes).toContain('STATIC_OR_STOCK_MEDIA_IN_PRODUCTION')
      expect(codes).toContain('SUPABASE_SECURITY_ADVISOR_ERROR')
    })
  })
})

