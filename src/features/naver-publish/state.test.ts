import { describe, expect, it } from 'vitest'
import { canTransition, isTerminal } from './state'
import type { NaverPublishState } from './types'

describe('naver publish state machine', () => {
  it('allows the happy path through readback', () => {
    const path: NaverPublishState[] = ['QUEUED', 'RUNNING', 'PUBLISHED_REPORTED', 'VERIFIED']
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })

  it('never reaches VERIFIED without a reported publish or a reconcile', () => {
    const states: NaverPublishState[] = ['QUEUED', 'AWAITING_LOGIN', 'RUNNING', 'HANDOFF_REQUIRED', 'FAILED', 'MISMATCH']
    for (const from of states) expect(canTransition(from, 'VERIFIED')).toBe(false)
    expect(canTransition('PUBLISHED_REPORTED', 'VERIFIED')).toBe(true)
    expect(canTransition('UNKNOWN', 'VERIFIED')).toBe(true)
  })

  it('does not retry an unknown result by returning to RUNNING or QUEUED', () => {
    expect(canTransition('UNKNOWN', 'RUNNING')).toBe(false)
    expect(canTransition('UNKNOWN', 'QUEUED')).toBe(false)
  })

  it('lets a human handoff resume the same job', () => {
    expect(canTransition('RUNNING', 'HANDOFF_REQUIRED')).toBe(true)
    expect(canTransition('HANDOFF_REQUIRED', 'RUNNING')).toBe(true)
  })

  it('marks VERIFIED, MISMATCH and FAILED as terminal only', () => {
    expect(isTerminal('VERIFIED')).toBe(true)
    expect(isTerminal('MISMATCH')).toBe(true)
    expect(isTerminal('FAILED')).toBe(true)
    expect(isTerminal('UNKNOWN')).toBe(false)
    expect(isTerminal('RUNNING')).toBe(false)
  })
})
