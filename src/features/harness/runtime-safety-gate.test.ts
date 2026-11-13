import { describe, it, expect } from 'vitest'
import { runtimeSafetyGate } from './runtime-safety-gate'
import { platformCapabilityRegistry } from './platform-capability-registry'

describe('Runtime Safety Gate & Platform Capability (v1.1)', () => {
  it('AC-21 & AC-22: Blocks publish when OAuth session is expired or action unsupported', () => {
    // 1. Expired session
    const check1 = platformCapabilityRegistry.checkCapability('instagram', 'publish_image', false)
    expect(check1.canExecute).toBe(false)
    expect(check1.reason).toBe('SESSION_OR_OAUTH_EXPIRED')

    // 2. Unsupported action (e.g. sending cold DMs)
    const check2 = platformCapabilityRegistry.checkCapability('instagram', 'send_dm', true)
    expect(check2.canExecute).toBe(false)
    expect(check2.reason).toContain('ACTION_NOT_SUPPORTED')

    // 3. Official valid action
    const check3 = platformCapabilityRegistry.checkCapability('instagram', 'publish_image', true)
    expect(check3.canExecute).toBe(true)
  })

  it('AC-24: Blocks publish if HARD_LIVE_FACT verification failed or stale', () => {
    const verdict = runtimeSafetyGate.verify({
      brandFacts: [
        {
          key: 'reservation_available_slot',
          factClass: 'HARD_LIVE_FACT',
          value: '내일 오후 3시',
          verifiedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 hours ago
        }
      ],
      sourceBenchmarkData: {
        sourceHandle: 'noor.brow',
        sourceRawSentences: []
      },
      generatedContent: '내일 오후 3시 빈자리 예약 가능합니다.',
      industry: 'beauty_salon'
    })

    expect(verdict.passed).toBe(false)
    expect(verdict.blockingReasons.some(r => r.includes('HARD_LIVE_FACT_STALE'))).toBe(true)
  })

  it('AC-08 & AC-29: Blocks publish on source handle/price/verbatim near-copy leakage', () => {
    const verdict = runtimeSafetyGate.verify({
      brandFacts: [],
      sourceBenchmarkData: {
        sourceHandle: 'studio_by.reum',
        sourcePrices: ['250,000원'],
        sourceRawSentences: ['이 문장은 벤치마크 계정의 아주 고유한 고객 후기 원문 전체입니다.']
      },
      generatedContent: 'studio_by.reum의 노하우로 250,000원에 시술해 드립니다.',
      industry: 'beauty_salon'
    })

    expect(verdict.passed).toBe(false)
    expect(verdict.blockingReasons.some(r => r.includes('SOURCE_IDENTITY_LEAK'))).toBe(true)
    expect(verdict.blockingReasons.some(r => r.includes('SOURCE_PRICE_LEAK'))).toBe(true)
  })

  it('AC-28: Purges raw third-party media after 24 hours TTL', () => {
    const media = [
      { id: 'media_1', capturedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), ttlHours: 24 }, // expired
      { id: 'media_2', capturedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), ttlHours: 24 } // fresh
    ]

    const result = runtimeSafetyGate.purgeExpiredRawMedia(media)
    expect(result.purgedIds).toEqual(['media_1'])
    expect(result.retainedCount).toBe(1)
  })
})
