import { describe, expect, it } from 'vitest'
import {
  autonomyDistributionSchema,
  autoReplyStatsSchema,
  engagementKillSwitchRequestSchema,
  expiringDmThreadSchema,
} from '../schemas'

describe('operator-engagement schemas', () => {
  it('validates autonomyDistributionSchema correctly', () => {
    const valid = {
      l1Manual: 5,
      l2Assisted: 3,
      l3Autonomous: 2,
      totalConfigured: 10,
      pausedCount: 1,
    }
    const result = autonomyDistributionSchema.safeParse(valid)
    expect(result.success).toBe(true)

    const invalid = {
      l1Manual: -1,
      l2Assisted: 3,
      l3Autonomous: 2,
      totalConfigured: 10,
      pausedCount: 1,
    }
    expect(autonomyDistributionSchema.safeParse(invalid).success).toBe(false)
  })

  it('validates expiringDmThreadSchema with urgency enum', () => {
    const valid = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      workspaceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      workspaceName: '맛있는 커피',
      customerHandle: '@coffeelover',
      lastMessageText: '영업시간 문의드려요',
      lastMessageAt: '2026-10-14T10:00:00.000Z',
      expiresAt: '2026-10-15T10:00:00.000Z',
      remainingMinutes: 45,
      status: 'NEEDS_REPLY',
      urgency: 'CRITICAL',
    }
    const result = expiringDmThreadSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates autoReplyStatsSchema correctly', () => {
    const valid = {
      windowHours: 24,
      totalAttempts: 50,
      successfulReplies: 48,
      failedReplies: 2,
      successRatePercent: 96.0,
    }
    const result = autoReplyStatsSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  describe('engagementKillSwitchRequestSchema', () => {
    it('allows scope=all without workspaceId', () => {
      const valid = {
        scope: 'all',
        action: 'downgrade_to_l1',
        reason: '긴급 점검으로 인한 L3 모드 격하',
      }
      const result = engagementKillSwitchRequestSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('requires workspaceId when scope=workspace', () => {
      const invalid = {
        scope: 'workspace',
        action: 'pause',
        reason: '특정 매장 댓글 오작동 중단',
      }
      const result = engagementKillSwitchRequestSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })

    it('accepts valid scope=workspace with valid UUID', () => {
      const valid = {
        scope: 'workspace',
        workspaceId: '123e4567-e89b-12d3-a456-426614174000',
        action: 'pause',
        reason: '특정 매장 긴급 일시 정지',
      }
      const result = engagementKillSwitchRequestSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('rejects too short reason', () => {
      const invalid = {
        scope: 'all',
        action: 'downgrade_to_l1',
        reason: 'a',
      }
      const result = engagementKillSwitchRequestSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })
})
