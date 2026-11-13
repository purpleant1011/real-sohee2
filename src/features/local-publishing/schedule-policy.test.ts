import { describe, expect, it } from 'vitest'

import { classifyLocalSchedule } from './schedule-policy'

describe('local publish schedule grace', () => {
  it.each([
    ['2026-08-19T05:29:59.999Z', 'auto_execute'],
    ['2026-08-19T05:30:00.000Z', 'auto_execute'],
    ['2026-08-19T05:30:00.001Z', 'reconfirmation_required'],
  ])('classifies the exact server deadline at %s', (now, expected) => {
    expect(classifyLocalSchedule(now, '2026-08-19T05:00:00.000Z')).toBe(expected)
  })

  it('keeps future jobs not due and rejects invalid times', () => {
    expect(classifyLocalSchedule('2026-08-19T04:59:59.999Z', '2026-08-19T05:00:00.000Z')).toBe('not_due')
    expect(() => classifyLocalSchedule('invalid', '2026-08-19T05:00:00.000Z')).toThrow('INVALID_SCHEDULE_TIME')
  })
})
