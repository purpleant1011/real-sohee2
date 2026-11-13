import { describe, it, expect } from 'vitest'
import {
  evaluateActionEnvelope,
  isWithinQuietHours,
} from '../charter-policy'
import type { AutonomyCharter, AutonomousActionCandidate } from '../types'

describe('Charter Policy Executor (ANI-900)', () => {
  const activeCharter: AutonomyCharter = {
    autonomyCharterId: 'chart_studio_01',
    workspaceId: 'ws-main',
    version: 1,
    title: '바이름 뷰티샵 2026 자율근무 헌장',
    status: 'ACTIVE',
    envelope: {
      allowedChannels: ['instagram', 'naver_blog', 'kakao'],
      prohibitedActions: ['direct_dm_spam', 'unauthorized_refund'],
      maxCreditPerAction: 50,
      maxCreditPerWeek: 300,
      maxExternalSpendKrw: 30000,
      maxPostingFrequencyPerDay: 3,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      maxDiscountRatePercent: 15,
      customerResponseScope: ['booking_inquiry', 'pricing_faq'],
    },
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }

  it('allows in-envelope action and inherits charter approval ID without redundant prompts', () => {
    const action: AutonomousActionCandidate = {
      actionId: 'act-1',
      actionType: 'channel.publish_instagram',
      channel: 'instagram',
      creditCost: 30,
      externalSpendKrw: 0,
      discountRatePercent: 10,
    }

    // 14:00 KST (daytime) -> UTC 05:00
    const daytime = new Date('2026-09-06T05:00:00.000Z')
    const decision = evaluateActionEnvelope(action, activeCharter, daytime)

    expect(decision.allowed).toBe(true)
    expect(decision.decision).toBe('IN_ENVELOPE')
    if (decision.allowed) {
      expect(decision.inheritedApprovalId).toBe('appr_charter_chart_studio_01_v1')
      expect(decision.charterId).toBe('chart_studio_01')
    }
  })

  it('blocks action when channel is not in allowedChannels', () => {
    const action: AutonomousActionCandidate = {
      actionId: 'act-2',
      actionType: 'channel.publish_tiktok',
      channel: 'tiktok',
      creditCost: 20,
    }

    const decision = evaluateActionEnvelope(action, activeCharter)
    expect(decision.allowed).toBe(false)
    expect(decision.decision).toBe('OUT_OF_ENVELOPE')
    if (!decision.allowed) {
      expect(decision.violationCode).toBe('CHANNEL_NOT_ALLOWED')
      expect(decision.requestedDelta).toContain('tiktok')
    }
  })

  it('blocks action when actionType is explicitly prohibited', () => {
    const action: AutonomousActionCandidate = {
      actionId: 'act-3',
      actionType: 'direct_dm_spam',
      channel: 'instagram',
      creditCost: 10,
    }

    const decision = evaluateActionEnvelope(action, activeCharter)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.violationCode).toBe('ACTION_PROHIBITED')
    }
  })

  it('blocks action when credit cost exceeds single action cap', () => {
    const action: AutonomousActionCandidate = {
      actionId: 'act-4',
      actionType: 'channel.publish_instagram',
      channel: 'instagram',
      creditCost: 80, // Cap is 50
    }

    const decision = evaluateActionEnvelope(action, activeCharter)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.violationCode).toBe('EXCEEDS_ACTION_CREDIT_CAP')
      expect(decision.requestedDelta).toContain('80 SC')
    }
  })

  it('blocks action when discount exceeds maximum discount cap', () => {
    const action: AutonomousActionCandidate = {
      actionId: 'act-5',
      actionType: 'channel.publish_instagram',
      channel: 'instagram',
      creditCost: 20,
      discountRatePercent: 25, // Cap is 15%
    }

    const decision = evaluateActionEnvelope(action, activeCharter)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.violationCode).toBe('EXCEEDS_DISCOUNT_CAP')
      expect(decision.requestedDelta).toContain('25%')
    }
  })

  it('blocks action during quiet hours (23:00 KST)', () => {
    const action: AutonomousActionCandidate = {
      actionId: 'act-6',
      actionType: 'channel.publish_instagram',
      channel: 'instagram',
      creditCost: 20,
    }

    // 23:00 KST -> UTC 14:00
    const nighttime = new Date('2026-09-06T14:00:00.000Z')
    const decision = evaluateActionEnvelope(action, activeCharter, nighttime)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.violationCode).toBe('QUIET_HOURS_VIOLATION')
    }
  })

  it('blocks any action if charter is PAUSED or REVOKED', () => {
    const pausedCharter: AutonomyCharter = { ...activeCharter, status: 'PAUSED' }
    const action: AutonomousActionCandidate = {
      actionId: 'act-7',
      actionType: 'channel.publish_instagram',
      channel: 'instagram',
      creditCost: 10,
    }

    const decision = evaluateActionEnvelope(action, pausedCharter)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.violationCode).toBe('CHARTER_NOT_ACTIVE')
    }
  })
})
