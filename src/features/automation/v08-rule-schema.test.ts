import { describe, expect, it, vi } from 'vitest'

import { isWithinQuietHours, nextScheduledRun, v08AutomationRuleSchema } from './v08-rule-schema'

const baseRule = {
  kind: 'twice_daily_performance_report', active: true, approvalRequired: true,
  timezone: 'Asia/Seoul', localTimes: ['09:00', '18:00'],
  quietHours: { start: '22:00', end: '07:00' },
  perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200,
  channels: ['instagram', 'threads', 'naver_blog'],
}

describe('V0.8 recurring automation rule schema', () => {
  it('constructs the timezone formatter once per search, not once per examined minute', () => {
    const rule = v08AutomationRuleSchema.parse({ ...baseRule, kind: 'daily_performance_report', localTimes: ['09:00'] })
    const NativeFormatter = Intl.DateTimeFormat
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) { return new NativeFormatter(locale, options) })
    try {
      expect(nextScheduledRun(rule, new Date('2026-10-30T23:30:00Z')).toISOString()).toBe('2026-10-31T00:00:00.000Z')
      expect(formatter).toHaveBeenCalledTimes(1)
    } finally { formatter.mockRestore() }
  })
  it('schedules midnight as 00:00 in the configured timezone when quiet hours allow it', () => {
    const rule = v08AutomationRuleSchema.parse({ ...baseRule, kind: 'daily_performance_report', localTimes: ['00:00'], quietHours: { start: '01:00', end: '07:00' } })
    expect(nextScheduledRun(rule, new Date('2026-10-30T14:59:00Z')).toISOString()).toBe('2026-10-30T15:00:00.000Z')
  })
  it('accepts twice-daily report times in a valid IANA timezone', () => {
    expect(v08AutomationRuleSchema.parse(baseRule).localTimes).toHaveLength(2)
  })

  it('rejects a report time inside configured quiet hours', () => {
    expect(v08AutomationRuleSchema.safeParse({ ...baseRule, localTimes: ['06:00', '18:00'] }).success).toBe(false)
  })

  it('requires one daily time, two distinct twice-daily times, and one weekday for a weekly proposal', () => {
    expect(v08AutomationRuleSchema.safeParse({ ...baseRule, localTimes: ['09:00'] }).success).toBe(false)
    expect(v08AutomationRuleSchema.safeParse({ ...baseRule, localTimes: ['09:00', '09:00'] }).success).toBe(false)
    expect(v08AutomationRuleSchema.safeParse({
      ...baseRule, kind: 'weekly_plan_proposal', localTimes: ['18:00'], weekday: 1,
    }).success).toBe(true)
    expect(v08AutomationRuleSchema.safeParse({
      ...baseRule, kind: 'weekly_plan_proposal', localTimes: ['18:00'],
    }).success).toBe(false)
  })

  it('handles quiet hours across midnight and schedules the next local run after the given instant', () => {
    expect(isWithinQuietHours('23:00', { start: '22:00', end: '07:00' })).toBe(true)
    expect(isWithinQuietHours('12:00', { start: '22:00', end: '07:00' })).toBe(false)
    const daily = v08AutomationRuleSchema.parse({
      ...baseRule, kind: 'daily_performance_report', localTimes: ['09:00'],
    })
    expect(nextScheduledRun(daily, new Date('2026-08-19T00:30:00.000Z')).toISOString())
      .toBe('2026-08-20T00:00:00.000Z')
  })
})
