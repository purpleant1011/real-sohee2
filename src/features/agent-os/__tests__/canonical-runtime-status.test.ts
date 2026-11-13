import { describe, it, expect } from 'vitest'
import {
  resolveCanonicalRuntimeStatus,
  sanitizeVendorTerms,
  PRODUCT_LANGUAGE_MAP,
} from '../canonical-runtime-status'

describe('Canonical Runtime Status Contract (ANI-847, ANI-869)', () => {
  it('never returns RUNNING when hasActiveRun is false', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: false,
      isPaused: false,
    })

    expect(status.primaryState).not.toBe('RUNNING')
    expect(status.primaryState).toBe('IDLE')
    expect(status.badgeLabel).toBe('대기 중')
    expect(status.statusHeadline).not.toContain('작업 중')
    expect(status.statusDescription).not.toContain('즉시')
  })

  it('prioritizes PAUSED over active runs and blockers', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: true,
      isPaused: true,
      creditBalance: 0,
      ownerActionRequiredCount: 2,
    })

    expect(status.primaryState).toBe('PAUSED')
    expect(status.badgeLabel).toBe('일시 정지')
    expect(status.canExecute).toBe(false)
  })

  it('resolves to BLOCKED (NO_CREDIT) when credit balance is zero or negative', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: true,
      isPaused: false,
      creditBalance: 0,
    })

    expect(status.primaryState).toBe('BLOCKED')
    expect(status.blocker).toBe('NO_CREDIT')
    expect(status.badgeLabel).toBe('크레딧 소진')
    expect(status.canExecute).toBe(false)
  })

  it('resolves to BLOCKED (NO_READY_PLUGIN) when hasReadyPlugin is false', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: false,
      isPaused: false,
      hasReadyPlugin: false,
      creditBalance: 100,
    })

    expect(status.primaryState).toBe('BLOCKED')
    expect(status.blocker).toBe('NO_READY_PLUGIN')
    expect(status.badgeLabel).toBe('도구 준비 필요')
    expect(status.canExecute).toBe(false)
  })

  it('resolves to OWNER_ACTION_REQUIRED when ownerActionRequiredCount > 0', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: true,
      isPaused: false,
      ownerActionRequiredCount: 1,
      creditBalance: 100,
      hasReadyPlugin: true,
    })

    expect(status.primaryState).toBe('OWNER_ACTION_REQUIRED')
    expect(status.badgeLabel).toBe('사장님 확인 필요')
    expect(status.canExecute).toBe(false)
  })

  it('resolves to RUNNING strictly when hasActiveRun is true and no blockers', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: true,
      isPaused: false,
      creditBalance: 50,
      hasReadyPlugin: true,
    })

    expect(status.primaryState).toBe('RUNNING')
    expect(status.badgeLabel).toBe('자율 근무 중')
    expect(status.statusDescription).not.toContain('24시간')
    expect(status.canExecute).toBe(true)
  })

  it('resolves to LEARNING when isLearning is true and no active run', () => {
    const status = resolveCanonicalRuntimeStatus({
      hasActiveRun: false,
      isPaused: false,
      isLearning: true,
      creditBalance: 50,
      hasReadyPlugin: true,
    })

    expect(status.primaryState).toBe('LEARNING')
    expect(status.badgeLabel).toBe('성과 학습 중')
    expect(status.canExecute).toBe(true)
  })
})

describe('Product Language SSOT & Vendor Abstraction (ANI-867)', () => {
  it('sanitizes vendor substrate terms into outcome terminology', () => {
    const raw = 'Postiz 채널을 통해 발송되었으며 Chatwoot 고객 상담 라우터에서 대기 중입니다.'
    const sanitized = sanitizeVendorTerms(raw)

    expect(sanitized).not.toContain('Postiz')
    expect(sanitized).not.toContain('Chatwoot')
    expect(sanitized).toContain('소희 외부 채널 게이트웨이')
    expect(sanitized).toContain('통합 고객 상담 라우터')
  })

  it('handles case-insensitive vendor matching', () => {
    const raw = 'postiz is connected, hubspot synced, and gpt-4o initialized'
    const sanitized = sanitizeVendorTerms(raw)

    expect(sanitized).toContain(PRODUCT_LANGUAGE_MAP.postiz)
    expect(sanitized).toContain(PRODUCT_LANGUAGE_MAP.hubspot)
    expect(sanitized).toContain(PRODUCT_LANGUAGE_MAP['gpt-4o'])
  })
})
