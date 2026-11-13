import { describe, expect, it, vi } from 'vitest'
import {
  conflictSlotSchema,
  isValidIanaTimezone,
  scheduleSchema,
} from './schedule-schema'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const approvalId = '22222222-2222-4222-8222-222222222222'
const versionId = '33333333-3333-4333-8333-333333333333'
const channelConnectionId = '44444444-4444-4444-8444-444444444444'
const scheduleId = '55555555-5555-4555-8555-555555555555'

function validScheduleInput() {
  return {
    workspaceId,
    approvalId,
    versionId,
    channelConnectionId,
    scheduledLocal: '2026-08-10T09:30:00',
    timezone: 'Asia/Seoul',
  }
}

describe('scheduleSchema', () => {
  it.each([
    '2026-08-10T09:30:00',
    '2024-02-29T23:59:59',
    '2026-08-10T09:30:00.1',
    '2026-08-10T09:30:00.123456789',
  ])('accepts a real ISO local date-time with seconds: %s', (scheduledLocal) => {
    const input = { ...validScheduleInput(), scheduledLocal }

    expect(scheduleSchema.parse(input).scheduledLocal).toBe(scheduledLocal)
  })

  it.each([
    ['an impossible day', '2026-02-29T09:30:00'],
    ['an impossible month', '2026-13-01T09:30:00'],
    ['hour 24', '2026-08-10T24:00:00'],
    ['missing seconds', '2026-08-10T09:30'],
    ['a space separator', '2026-08-10 09:30:00'],
    ['a Z suffix', '2026-08-10T09:30:00Z'],
    ['a positive offset', '2026-08-10T09:30:00+09:00'],
    ['a negative offset', '2026-08-10T09:30:00-07:00'],
    ['a date only', '2026-08-10'],
  ])('rejects %s in scheduledLocal', (_label, scheduledLocal) => {
    expect(scheduleSchema.safeParse({ ...validScheduleInput(), scheduledLocal }).success).toBe(
      false,
    )
  })

  it.each([
    ['workspace ID', { workspaceId: 'not-a-uuid' }],
    ['approval ID', { approvalId: 'not-a-uuid' }],
    ['version ID', { versionId: 'not-a-uuid' }],
    ['channel connection ID', { channelConnectionId: 'not-a-uuid' }],
  ])('rejects a malformed %s', (_label, override) => {
    expect(scheduleSchema.safeParse({ ...validScheduleInput(), ...override }).success).toBe(false)
  })

  it.each([
    'Asia/Seoul',
    'America/Los_Angeles',
    'Pacific/Auckland',
    'UTC',
    'GMT',
    'Etc/UTC',
    'US/Pacific',
    'Etc/GMT+9',
  ])('accepts the valid timezone %s and preserves it', (timezone) => {
    expect(scheduleSchema.parse({ ...validScheduleInput(), timezone }).timezone).toBe(timezone)
  })

  it.each(['', '   ', 'Asia/Unknown_City', ' Asia/Seoul ', 'not/a timezone'])(
    'rejects the invalid timezone %j',
    (timezone) => {
      expect(scheduleSchema.safeParse({ ...validScheduleInput(), timezone }).success).toBe(false)
    },
  )
})

describe('isValidIanaTimezone', () => {
  it('returns a boolean without throwing for arbitrary runtime input', () => {
    const values: unknown[] = [
      'Asia/Seoul',
      '',
      '   ',
      'Mars/Olympus_Mons',
      null,
      undefined,
      123,
      {},
      Symbol('timezone'),
    ]

    expect(values.map((value) => isValidIanaTimezone(value))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('validates with an explicit instant instead of an implicit current time', () => {
    const format = vi.fn(() => '1/1/1970')
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      function () {
        return { format } as unknown as Intl.DateTimeFormat
      },
    )

    try {
      expect(isValidIanaTimezone('Asia/Seoul')).toBe(true)
      expect(format).toHaveBeenCalledWith(0)
    } finally {
      dateTimeFormat.mockRestore()
    }
  })

  it.each(['+09:00', '-05:30', '+09', '-0530'])(
    'rejects the numeric fixed-offset identifier %s in the predicate and schema',
    (timezone) => {
      expect(isValidIanaTimezone(timezone)).toBe(false)
      expect(scheduleSchema.safeParse({ ...validScheduleInput(), timezone }).success).toBe(false)
    },
  )
})

describe('conflictSlotSchema', () => {
  it.each([
    ['Z', '2026-08-10T00:30:00Z'],
    ['positive numeric offset', '2026-08-10T09:30:00+09:00'],
    ['negative numeric offset with fractional seconds', '2026-08-09T17:30:00.125-07:00'],
    ['Z without seconds', '2026-08-10T00:30Z'],
    ['numeric offset without seconds', '2026-08-10T09:30+09:00'],
  ])('accepts an absolute ISO datetime with %s', (_label, scheduledAtUtc) => {
    const input = { scheduleId, channelConnectionId, scheduledAtUtc }

    expect(conflictSlotSchema.parse(input)).toEqual(input)
  })

  it('accepts a slot without a schedule ID', () => {
    const input = { channelConnectionId, scheduledAtUtc: '2026-08-10T00:30:00Z' }

    expect(conflictSlotSchema.parse(input)).toEqual(input)
  })

  it.each([
    ['local datetime', '2026-08-10T09:30:00'],
    ['space-separated datetime', '2026-08-10 00:30:00Z'],
    ['impossible date', '2026-02-29T00:30:00Z'],
    ['invalid offset', '2026-08-10T00:30:00+24:00'],
  ])('rejects a scheduledAtUtc with %s', (_label, scheduledAtUtc) => {
    expect(
      conflictSlotSchema.safeParse({ channelConnectionId, scheduledAtUtc }).success,
    ).toBe(false)
  })

  it.each([
    ['schedule ID', { scheduleId: 'not-a-uuid' }],
    ['channel connection ID', { channelConnectionId: 'not-a-uuid' }],
  ])('rejects a malformed %s', (_label, override) => {
    expect(
      conflictSlotSchema.safeParse({
        scheduleId,
        channelConnectionId,
        scheduledAtUtc: '2026-08-10T00:30:00Z',
        ...override,
      }).success,
    ).toBe(false)
  })
})
