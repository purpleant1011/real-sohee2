import { describe, expect, it } from 'vitest'
import { decideAutoReply } from './policy'
import type { EngagementPolicy, SocialComment } from './types'

const basePolicy: EngagementPolicy = {
  id: '00000000-0000-0000-0000-000000000001',
  workspace_id: 'ws-1',
  channel: 'instagram',
  auto_reply_enabled: true,
  is_paused: false,
  allowed_classes: ['THANKS', 'GREETING'],
  min_confidence: 0.85,
  daily_cap: 5,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  max_comment_age_days: 7,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

const baseComment: SocialComment = {
  id: 'cm-1',
  workspace_id: 'ws-1',
  channel_connection_id: 'conn-1',
  channel: 'instagram',
  provider_comment_id: 'p-cm-1',
  provider_media_id: 'p-media-1',
  author_handle: 'customer123',
  author_id: 'user-c-1',
  comment_text: '정말 친절하고 좋았어요 감사합니다!',
  comment_created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  classification: 'THANKS',
  confidence: 0.95,
  status: 'DRAFTED',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('decideAutoReply policy matrix (Invariant 5)', () => {
  it('allows auto-reply when all conditions are satisfied', () => {
    const result = decideAutoReply({
      policy: basePolicy,
      comment: baseComment,
      sentCountToday: 0,
      now: new Date(),
    })
    expect(result.shouldAutoReply).toBe(true)
    expect(result.reason).toContain('정책 기준을 모두 만족합니다')
  })

  it('rejects when auto_reply_enabled is false', () => {
    const result = decideAutoReply({
      policy: { ...basePolicy, auto_reply_enabled: false },
      comment: baseComment,
      sentCountToday: 0,
    })
    expect(result.shouldAutoReply).toBe(false)
    expect(result.reason).toContain('비활성화')
  })

  it('rejects when policy is paused', () => {
    const result = decideAutoReply({
      policy: { ...basePolicy, is_paused: true },
      comment: baseComment,
      sentCountToday: 0,
    })
    expect(result.shouldAutoReply).toBe(false)
    expect(result.reason).toContain('일시 중지')
  })

  it('strictly rejects COMPLAINT, SENSITIVE, SPAM, and NEEDS_HUMAN classes', () => {
    for (const disallowed of ['COMPLAINT', 'SENSITIVE', 'SPAM', 'NEEDS_HUMAN'] as const) {
      const result = decideAutoReply({
        policy: { ...basePolicy, allowed_classes: ['THANKS', 'GREETING', disallowed as any] },
        comment: { ...baseComment, classification: disallowed },
        sentCountToday: 0,
      })
      expect(result.shouldAutoReply).toBe(false)
      expect(result.reason).toContain('사람 확인')
    }
  })

  it('rejects QUESTION by default unless explicitly allowed by owner', () => {
    const notAllowed = decideAutoReply({
      policy: { ...basePolicy, allowed_classes: ['THANKS', 'GREETING'] },
      comment: { ...baseComment, classification: 'QUESTION' },
      sentCountToday: 0,
    })
    expect(notAllowed.shouldAutoReply).toBe(false)
    expect(notAllowed.reason).toContain('질문')

    const allowed = decideAutoReply({
      policy: { ...basePolicy, allowed_classes: ['THANKS', 'GREETING', 'QUESTION'] },
      comment: { ...baseComment, classification: 'QUESTION' },
      sentCountToday: 0,
    })
    expect(allowed.shouldAutoReply).toBe(true)
  })

  it('rejects when classification confidence is below threshold', () => {
    const result = decideAutoReply({
      policy: { ...basePolicy, min_confidence: 0.9 },
      comment: { ...baseComment, confidence: 0.84 },
      sentCountToday: 0,
    })
    expect(result.shouldAutoReply).toBe(false)
    expect(result.reason).toContain('신뢰도')
  })

  it('rejects when daily cap is reached', () => {
    const result = decideAutoReply({
      policy: { ...basePolicy, daily_cap: 5 },
      comment: baseComment,
      sentCountToday: 5,
    })
    expect(result.shouldAutoReply).toBe(false)
    expect(result.reason).toContain('한도')
  })

  it('rejects during quiet hours (KST)', () => {
    // 23:00 KST = 14:00 UTC
    const nightKst = new Date('2026-10-08T14:30:00Z')
    const result = decideAutoReply({
      policy: {
        ...basePolicy,
        quiet_hours_enabled: true,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
      },
      comment: baseComment,
      sentCountToday: 0,
      now: nightKst,
    })
    expect(result.shouldAutoReply).toBe(false)
    expect(result.reason).toContain('방해 금지')

    // 11:00 KST = 02:00 UTC (daytime outside quiet hours)
    const dayKst = new Date('2026-10-08T02:30:00Z')
    const dayResult = decideAutoReply({
      policy: {
        ...basePolicy,
        quiet_hours_enabled: true,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
      },
      comment: baseComment,
      sentCountToday: 0,
      now: dayKst,
    })
    expect(dayResult.shouldAutoReply).toBe(true)
  })

  it('rejects when comment author is the connected account itself', () => {
    const byHandle = decideAutoReply({
      policy: basePolicy,
      comment: { ...baseComment, author_handle: 'our_official_store' },
      sentCountToday: 0,
      connectedAccountHandle: 'our_official_store',
    })
    expect(byHandle.shouldAutoReply).toBe(false)
    expect(byHandle.reason).toContain('자사 계정')

    const byId = decideAutoReply({
      policy: basePolicy,
      comment: { ...baseComment, author_id: 'store-acc-id' },
      sentCountToday: 0,
      connectedAccountId: 'store-acc-id',
    })
    expect(byId.shouldAutoReply).toBe(false)
    expect(byId.reason).toContain('자사 계정')
  })

  it('rejects comments older than max_comment_age_days (default 7 days)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    const result = decideAutoReply({
      policy: basePolicy,
      comment: { ...baseComment, comment_created_at: eightDaysAgo },
      sentCountToday: 0,
    })
    expect(result.shouldAutoReply).toBe(false)
    expect(result.reason).toContain('7일이 지난')
  })

  describe('Autonomy Level matrix (L1_MANUAL, L2_ASSISTED, L3_AUTONOMOUS)', () => {
    it('L1_MANUAL: rejects auto-reply for all comments even if auto_reply_enabled is true', () => {
      const result = decideAutoReply({
        policy: { ...basePolicy, autonomy_level: 'L1_MANUAL' },
        comment: baseComment,
        sentCountToday: 0,
      })
      expect(result.shouldAutoReply).toBe(false)
      expect(result.reason).toContain('비서형(수동 승인)')
    })

    it('L2_ASSISTED: allows auto-reply for THANKS and GREETING', () => {
      const thanksResult = decideAutoReply({
        policy: { ...basePolicy, autonomy_level: 'L2_ASSISTED' },
        comment: { ...baseComment, classification: 'THANKS' },
        sentCountToday: 0,
      })
      expect(thanksResult.shouldAutoReply).toBe(true)

      const greetingResult = decideAutoReply({
        policy: { ...basePolicy, autonomy_level: 'L2_ASSISTED' },
        comment: { ...baseComment, classification: 'GREETING' },
        sentCountToday: 0,
      })
      expect(greetingResult.shouldAutoReply).toBe(true)
    })

    it('L2_ASSISTED: strictly blocks COMPLAINT and SENSITIVE for owner escalation', () => {
      const complaintResult = decideAutoReply({
        policy: { ...basePolicy, autonomy_level: 'L2_ASSISTED' },
        comment: { ...baseComment, classification: 'COMPLAINT' },
        sentCountToday: 0,
      })
      expect(complaintResult.shouldAutoReply).toBe(false)
      expect(complaintResult.reason).toContain('사람 확인')
    })

    it('L3_AUTONOMOUS: allows auto-reply when conditions are met but still blocks COMPLAINT', () => {
      const autoResult = decideAutoReply({
        policy: { ...basePolicy, autonomy_level: 'L3_AUTONOMOUS' },
        comment: { ...baseComment, classification: 'THANKS' },
        sentCountToday: 0,
      })
      expect(autoResult.shouldAutoReply).toBe(true)

      const blockedResult = decideAutoReply({
        policy: { ...basePolicy, autonomy_level: 'L3_AUTONOMOUS' },
        comment: { ...baseComment, classification: 'COMPLAINT' },
        sentCountToday: 0,
      })
      expect(blockedResult.shouldAutoReply).toBe(false)
    })
  })
})
