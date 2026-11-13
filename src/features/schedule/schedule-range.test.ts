import { describe, expect, it, vi } from 'vitest'
import { detectOneHourConflict, getScheduleRange } from './schedule-range'

const channelA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const channelB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const scheduleA = '11111111-1111-4111-8111-111111111111'
const scheduleB = '22222222-2222-4222-8222-222222222222'

function slot(
  scheduledAtUtc: string,
  overrides: Partial<{
    scheduleId: string
    channelConnectionId: string
  }> = {},
) {
  return {
    channelConnectionId: channelA,
    scheduledAtUtc,
    ...overrides,
  }
}

describe('getScheduleRange', () => {
  it('returns the Monday-through-Sunday desktop week with a stable Korean label', () => {
    const range = getScheduleRange('desktop', new Date('2026-08-05T03:00:00Z'), 'Asia/Seoul')

    expect(range).toEqual({
      viewport: 'desktop',
      timezone: 'Asia/Seoul',
      startLocalDate: '2026-08-03',
      endLocalDateExclusive: '2026-08-10',
      label: '이번 주 · 2026-08-03~2026-08-09 · Asia/Seoul',
    })
  })

  it('returns thirty local calendar dates on mobile with a stable Korean label', () => {
    const range = getScheduleRange('mobile', new Date('2026-08-09T03:00:00Z'), 'Asia/Seoul')

    expect(range).toEqual({
      viewport: 'mobile',
      timezone: 'Asia/Seoul',
      startLocalDate: '2026-08-09',
      endLocalDateExclusive: '2026-09-08',
      label: '다가오는 30일 · 2026-08-09~2026-09-07 · Asia/Seoul',
    })
  })

  it.each([
    [
      'Monday',
      '2026-08-02T15:00:00Z',
      'Asia/Seoul',
      '2026-08-03',
      '2026-08-10',
    ],
    [
      'Sunday',
      '2026-08-09T14:59:59Z',
      'Asia/Seoul',
      '2026-08-03',
      '2026-08-10',
    ],
    [
      'year boundary',
      '2027-01-01T03:00:00Z',
      'Asia/Seoul',
      '2026-12-28',
      '2027-01-04',
    ],
  ])(
    'keeps the correct desktop week across a %s',
    (_label, now, timezone, startLocalDate, endLocalDateExclusive) => {
      expect(getScheduleRange('desktop', new Date(now), timezone)).toMatchObject({
        startLocalDate,
        endLocalDateExclusive,
      })
    },
  )

  it.each([
    ['month boundary', '2026-01-31T12:00:00Z', 'UTC', '2026-01-31', '2026-03-02'],
    ['year boundary', '2026-12-31T12:00:00Z', 'UTC', '2026-12-31', '2027-01-30'],
    [
      'spring DST boundary',
      '2026-03-08T09:30:00Z',
      'America/Los_Angeles',
      '2026-03-08',
      '2026-04-07',
    ],
    [
      'fall DST boundary',
      '2026-11-01T08:30:00Z',
      'America/Los_Angeles',
      '2026-11-01',
      '2026-12-01',
    ],
  ])(
    'adds civil dates rather than fixed elapsed hours at a %s',
    (_label, now, timezone, startLocalDate, endLocalDateExclusive) => {
      expect(getScheduleRange('mobile', new Date(now), timezone)).toMatchObject({
        startLocalDate,
        endLocalDateExclusive,
      })
    },
  )

  it('interprets the same UTC-boundary instant in the supplied timezone', () => {
    const now = new Date('2026-08-09T16:30:00Z')

    expect(getScheduleRange('desktop', now, 'Asia/Seoul')).toMatchObject({
      startLocalDate: '2026-08-10',
      endLocalDateExclusive: '2026-08-17',
    })
    expect(getScheduleRange('desktop', now, 'America/Los_Angeles')).toMatchObject({
      startLocalDate: '2026-08-03',
      endLocalDateExclusive: '2026-08-10',
    })
  })

  it.each([
    ['first Gregorian AD date', '0001-01-01T00:00:00.000Z', '0001-01-01', '0001-01-31'],
    ['latest valid mobile end', '9999-12-01T00:00:00.000Z', '9999-12-01', '9999-12-31'],
  ])(
    'keeps four-digit Gregorian dates at the %s boundary',
    (_label, now, startLocalDate, endLocalDateExclusive) => {
      expect(getScheduleRange('mobile', new Date(now), 'UTC')).toMatchObject({
        startLocalDate,
        endLocalDateExclusive,
      })
    },
  )

  it.each([
    ['maximum Date mobile end overflow', 'mobile', '+275760-09-12T00:00:00.000Z'],
    ['year zero', 'mobile', '0000-01-01T00:00:00.000Z'],
    ['BCE year', 'desktop', '-000001-01-01T00:00:00.000Z'],
    ['five-digit AD year', 'desktop', '+010000-01-01T00:00:00.000Z'],
    ['desktop end beyond year 9999', 'desktop', '9999-12-31T00:00:00.000Z'],
    ['mobile end beyond year 9999', 'mobile', '9999-12-15T00:00:00.000Z'],
  ])('rejects the unrepresentable %s with the stable RangeError', (_label, viewport, now) => {
    expect(() =>
      getScheduleRange(viewport as 'desktop' | 'mobile', new Date(now), 'UTC'),
    ).toThrowError(new RangeError('일정 범위를 계산할 수 없습니다.'))
  })

  it.each([
    ['invalid Date', 'desktop', new Date(Number.NaN), 'Asia/Seoul'],
    ['non-Date runtime value', 'desktop', '2026-08-09', 'Asia/Seoul'],
    ['invalid timezone', 'desktop', new Date('2026-08-09T03:00:00Z'), 'Mars/Olympus'],
    ['invalid viewport', 'tablet', new Date('2026-08-09T03:00:00Z'), 'Asia/Seoul'],
  ])('throws the stable public RangeError for an %s', (_label, viewport, now, timezone) => {
    expect(() =>
      getScheduleRange(
        viewport as 'desktop',
        now as Date,
        timezone,
      ),
    ).toThrowError(new RangeError('일정 범위를 계산할 수 없습니다.'))
  })

  it('does not mutate the supplied Date or read an implicit current time', () => {
    const now = new Date('2026-08-09T16:30:00Z')
    const originalTime = now.getTime()
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })

    try {
      expect(getScheduleRange('mobile', now, 'Asia/Seoul').startLocalDate).toBe('2026-08-10')
      expect(now.getTime()).toBe(originalTime)
      expect(dateNow).not.toHaveBeenCalled()
    } finally {
      dateNow.mockRestore()
    }
  })
})

describe('detectOneHourConflict', () => {
  it.each([
    ['the exact same instant', '2026-08-10T00:00:00Z', true],
    ['59 minutes 59 seconds away', '2026-08-10T00:59:59Z', true],
    ['exactly 60 minutes away', '2026-08-10T01:00:00Z', true],
    ['60 minutes and 1 millisecond away', '2026-08-10T01:00:00.001Z', false],
  ])('returns %s for the one-hour boundary', (_label, scheduledAtUtc, expected) => {
    const existing = [slot('2026-08-10T00:00:00Z')]

    expect(detectOneHourConflict(existing, slot(scheduledAtUtc))).toBe(expected)
  })

  it('compares absolute instants after parsing offsets', () => {
    const existing = [slot('2026-08-10T09:00:00+09:00')]

    expect(detectOneHourConflict(existing, slot('2026-08-09T17:00:00-07:00'))).toBe(true)
  })

  it.each([
    [
      'exact later boundary with fractional zero',
      '2026-08-10T00:00:00Z',
      '2026-08-10T01:00:00.0000Z',
      true,
    ],
    [
      'later boundary plus a tenth of a millisecond',
      '2026-08-10T00:00:00Z',
      '2026-08-10T01:00:00.0001Z',
      false,
    ],
    [
      'exact reverse boundary with fractional zero',
      '2026-08-10T01:00:00.0000Z',
      '2026-08-10T00:00:00Z',
      true,
    ],
    [
      'reverse boundary plus a tenth of a millisecond',
      '2026-08-10T01:00:00.0001Z',
      '2026-08-10T00:00:00Z',
      false,
    ],
    [
      'exact offset boundary with fractional zero',
      '2026-08-10T09:00:00+09:00',
      '2026-08-09T18:00:00.0000-07:00',
      true,
    ],
    [
      'offset boundary plus a long fractional value',
      '2026-08-10T09:00:00+09:00',
      '2026-08-09T18:00:00.00000000000000000001-07:00',
      false,
    ],
  ])(
    'returns %s for %s',
    (_label, existingAtUtc, candidateAtUtc, expected) => {
      expect(detectOneHourConflict([slot(existingAtUtc)], slot(candidateAtUtc))).toBe(expected)
    },
  )

  it('ignores schedules on another channel', () => {
    const existing = [slot('2026-08-10T00:00:00Z', { channelConnectionId: channelB })]

    expect(detectOneHourConflict(existing, slot('2026-08-10T00:00:00Z'))).toBe(false)
  })

  it('excludes only the defined matching schedule ID while editing', () => {
    const candidate = slot('2026-08-10T00:00:00Z', { scheduleId: scheduleA })

    expect(
      detectOneHourConflict(
        [slot('2026-08-10T00:00:00Z', { scheduleId: scheduleA })],
        candidate,
      ),
    ).toBe(false)
    expect(
      detectOneHourConflict(
        [
          slot('2026-08-10T00:00:00Z', { scheduleId: scheduleA }),
          slot('2026-08-10T00:59:00Z', { scheduleId: scheduleB }),
        ],
        candidate,
      ),
    ).toBe(true)
  })

  it('does not treat two absent schedule IDs as self-exclusion', () => {
    expect(
      detectOneHourConflict(
        [slot('2026-08-10T00:00:00Z')],
        slot('2026-08-10T00:00:00Z'),
      ),
    ).toBe(true)
  })

  it('returns false for an empty valid collection', () => {
    expect(detectOneHourConflict([], slot('2026-08-10T00:00:00Z'))).toBe(false)
  })

  it.each([
    ['null candidate', [], null],
    ['local candidate datetime', [], slot('2026-08-10T00:00:00')],
    ['non-array collection', {}, slot('2026-08-10T00:00:00Z')],
    ['malformed existing slot', [slot('2026-08-10T00:00:00')], slot('2026-08-10T00:00:00Z')],
    ['non-object existing slot', [null], slot('2026-08-10T00:00:00Z')],
  ])('fails closed without throwing for %s', (_label, existing, candidate) => {
    expect(() => detectOneHourConflict(existing, candidate)).not.toThrow()
    expect(detectOneHourConflict(existing, candidate)).toBe(true)
  })

  it('fails closed for a sparse existing collection', () => {
    const sparse = new Array(1)

    expect(detectOneHourConflict(sparse, slot('2026-08-10T00:00:00Z'))).toBe(true)
  })

  it('fails closed when an Array proxy underreports a conflicting target length', () => {
    const target = [slot('2026-08-10T00:00:00Z')]
    const existing = new Proxy(target, {
      get(array, property, receiver) {
        return property === 'length' ? 0 : Reflect.get(array, property, receiver)
      },
    })

    expect(detectOneHourConflict(existing, slot('2026-08-10T00:00:00Z'))).toBe(true)
  })

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '0',
    false,
    null,
    undefined,
    2 ** 32,
    Number.MAX_SAFE_INTEGER,
  ])(
    'fails closed when an Array proxy reports invalid length %s',
    (reportedLength) => {
      const existing = new Proxy([], {
        get(array, property, receiver) {
          return property === 'length'
            ? reportedLength
            : Reflect.get(array, property, receiver)
        },
      })

      expect(detectOneHourConflict(existing, slot('2026-08-10T00:00:00Z'))).toBe(true)
    },
  )

  it('snapshots the validated collection length once', () => {
    let lengthReads = 0
    const existing = new Proxy([slot('2026-08-10T02:00:00Z')], {
      get(array, property, receiver) {
        if (property === 'length') {
          lengthReads += 1

          if (lengthReads > 1) throw new Error('length was read more than once')
        }

        return Reflect.get(array, property, receiver)
      },
    })

    expect(detectOneHourConflict(existing, slot('2026-08-10T00:00:00Z'))).toBe(false)
    expect(lengthReads).toBe(1)
  })

  it('fails closed when an Array proxy reports a phantom own index', () => {
    const synthesizedSlot = slot('2026-08-10T02:00:00Z')
    const existing = new Proxy([], {
      get(array, property, receiver) {
        if (property === 'length') return 1
        if (property === '0') return synthesizedSlot
        return Reflect.get(array, property, receiver)
      },
      ownKeys() {
        return ['0', 'length']
      },
    })

    expect(detectOneHourConflict(existing, slot('2026-08-10T00:00:00Z'))).toBe(true)
  })

  it('does not invoke caller-provided array iteration methods', () => {
    const existing = [slot('2026-08-10T02:00:00Z')]
    const poison = () => {
      throw new Error('caller-provided array method was invoked')
    }

    Object.defineProperties(existing, {
      some: { value: poison },
      every: { value: poison },
      forEach: { value: poison },
      map: { value: poison },
      filter: { value: poison },
      values: { value: poison },
      [Symbol.iterator]: { value: poison },
    })

    expect(detectOneHourConflict(existing, slot('2026-08-10T00:00:00Z'))).toBe(false)
  })

  it('fails closed when runtime property access throws', () => {
    const candidate = Object.defineProperty({}, 'scheduleId', {
      get() {
        throw new Error('untrusted getter')
      },
    })

    expect(() => detectOneHourConflict([], candidate)).not.toThrow()
    expect(detectOneHourConflict([], candidate)).toBe(true)
  })

  it('does not mutate frozen inputs', () => {
    const existingSlot = Object.freeze(
      slot('2026-08-10T02:00:00Z', { scheduleId: scheduleA }),
    )
    const existing = Object.freeze([existingSlot])
    const candidate = Object.freeze(slot('2026-08-10T00:00:00Z', { scheduleId: scheduleB }))
    const before = JSON.stringify({ existing, candidate })

    expect(detectOneHourConflict(existing, candidate)).toBe(false)
    expect(JSON.stringify({ existing, candidate })).toBe(before)
  })
})
