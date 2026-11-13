import { describe, expect, it } from 'vitest'
import { recommendScheduleTimes } from './schedule-recommendations'

describe('recommendScheduleTimes', () => {
  it('returns at most three operating-hour candidates outside publish and customer conflicts', () => {
    const recommendations = recommendScheduleTimes({
      now: new Date('2030-08-14T00:00:00.000Z'),
      timezone: 'Asia/Seoul',
      channelConnectionId: '50000000-0000-4000-8000-000000000001',
      existingSchedules: [{
        channelConnectionId: '50000000-0000-4000-8000-000000000001',
        scheduledAtUtc: '2030-08-14T02:00:00.000Z',
      }],
      customerReservations: [{ startsAt: '2030-08-14T04:00:00.000Z' }],
    })

    expect(recommendations).toHaveLength(3)
    expect(recommendations.map((item) => item.scheduledAtUtc)).not.toContain('2030-08-14T02:00:00.000Z')
    expect(recommendations.map((item) => item.scheduledAtUtc)).not.toContain('2030-08-14T04:00:00.000Z')
    expect(recommendations.every((item) => item.reason.length > 0)).toBe(true)
  })

  it('keeps every candidate beyond the minimum preparation window', () => {
    const now = new Date('2030-08-14T07:10:00.000Z')
    const recommendations = recommendScheduleTimes({
      now,
      timezone: 'Asia/Seoul',
      channelConnectionId: '50000000-0000-4000-8000-000000000001',
      existingSchedules: [],
      customerReservations: [],
      minimumLeadMinutes: 60,
    })

    expect(recommendations).toHaveLength(3)
    expect(recommendations.every((item) => (
      new Date(item.scheduledAtUtc).getTime() >= now.getTime() + 60 * 60 * 1000
    ))).toBe(true)
  })
})
