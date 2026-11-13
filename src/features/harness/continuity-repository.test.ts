import { describe, expect, it } from 'vitest'
import { calculateContinuitySignals } from './continuity-repository'

describe('calculateContinuitySignals', () => {
  it('flags a repeated hook used in the previous three posts', () => {
    const signals = calculateContinuitySignals([
      { hook: '상담 전 이것부터 확인해요', topic: '상담 준비' },
      { hook: '상담 전 이것부터 확인해요', topic: '예약 준비' },
      { hook: '상담 전 이것부터 확인해요', topic: '관리 준비' },
    ], { hook: '상담 전 이것부터 확인해요', topic: '상담 준비' })
    expect(signals.repetitionRisk).toBe('high')
    expect(signals.reasons).toContain('recent_hook_repeated')
  })
})
