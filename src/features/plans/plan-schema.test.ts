import { describe, expect, it } from 'vitest'
import { periodPlanRequestSchema } from './plan-schema'

const request = {
  periodStart: '2026-08-24',
  periodEnd: '2026-08-30',
  timezone: 'Asia/Seoul',
  goal: '신규 예약 문의를 늘린다',
  generationDepth: 'balanced',
  idempotencyKey: '10000000-0000-4000-8000-000000000001',
  channels: [{ channel: 'instagram', postCount: 7, imagesPerPost: 4 }],
}

describe('period plan request contract', () => {
  it('accepts a bounded channel plan with the required period and idempotency key', () => {
    expect(periodPlanRequestSchema.parse(request)).toMatchObject(request)
  })

  it('rejects a plan whose end is before its start', () => {
    expect(() => periodPlanRequestSchema.parse({ ...request, periodEnd: '2026-08-23' })).toThrow('PERIOD_END_BEFORE_START')
  })

  it('rejects duplicate channel rows', () => {
    expect(() => periodPlanRequestSchema.parse({
      ...request,
      channels: [...request.channels, { channel: 'instagram', postCount: 1, imagesPerPost: 0 }],
    })).toThrow('PLAN_CHANNEL_DUPLICATE')
  })

  it('allows twenty images only for a Naver Blog plan entry', () => {
    expect(periodPlanRequestSchema.safeParse({
      ...request,
      channels: [{ channel: 'naver_blog', postCount: 1, imagesPerPost: 20 }],
    }).success).toBe(true)
    expect(periodPlanRequestSchema.safeParse({
      ...request,
      channels: [{ channel: 'instagram', postCount: 1, imagesPerPost: 11 }],
    }).success).toBe(false)
  })
})
