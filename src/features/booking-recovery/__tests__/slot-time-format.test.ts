import { afterEach, describe, expect, it } from 'vitest'
import { formatSlotTimeForCustomer } from '../slot-time-format'

/**
 * D-7 — 고객 안내 문안의 시각은 사업장 timezone 기준이어야 한다.
 * 저장 값은 UTC ISO 이므로 잘라 쓰면 9시간(KST) 어긋난다.
 *
 * 2026-10-29T05:00:00Z 는
 *   14:00 KST (목)
 *   01:00 America/New_York (EDT, 목)
 */

const SLOT_UTC = '2026-10-29T05:00:00+00:00'

describe('formatSlotTimeForCustomer', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('한국 슬롯은 KST 로 표기한다(UTC 문자열을 그대로 자르지 않는다)', () => {
    expect(formatSlotTimeForCustomer({ startsAt: SLOT_UTC, timezone: 'Asia/Seoul' }))
      .toBe('10월 29일 (목) 오후 2:00')
  })

  it('timezone 이 비어 있으면 Asia/Seoul 로 본다', () => {
    expect(formatSlotTimeForCustomer({ startsAt: SLOT_UTC })).toBe('10월 29일 (목) 오후 2:00')
    expect(formatSlotTimeForCustomer({ startsAt: SLOT_UTC, timezone: null })).toBe('10월 29일 (목) 오후 2:00')
  })

  it('다른 timezone 슬롯은 그 timezone 기준으로 표기하고 시간대를 덧붙인다', () => {
    expect(formatSlotTimeForCustomer({ startsAt: SLOT_UTC, timezone: 'America/New_York' }))
      .toBe('10월 29일 (목) 오전 1:00 (America/New_York)')
  })

  it('서버 로컬 TZ 가 무엇이든 결과가 같다(CI 러너 UTC 에서도 동일)', () => {
    const expected = '10월 29일 (목) 오후 2:00'
    for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Europe/Berlin']) {
      process.env.TZ = tz
      expect(formatSlotTimeForCustomer({ startsAt: SLOT_UTC, timezone: 'Asia/Seoul' })).toBe(expected)
    }
  })

  it('자정은 오전 12:00 으로 표기한다(24:00 아님)', () => {
    // 2026-10-29T15:00:00Z == 2026-10-30 00:00 KST
    expect(formatSlotTimeForCustomer({ startsAt: '2026-10-29T15:00:00+00:00', timezone: 'Asia/Seoul' }))
      .toBe('10월 30일 (금) 오전 12:00')
  })

  it('정오는 오후 12:00 으로 표기한다', () => {
    // 2026-10-29T03:00:00Z == 2026-10-29 12:00 KST
    expect(formatSlotTimeForCustomer({ startsAt: '2026-10-29T03:00:00+00:00', timezone: 'Asia/Seoul' }))
      .toBe('10월 29일 (목) 오후 12:00')
  })

  it('읽을 수 없는 값은 추측하지 않고 원본을 돌려준다', () => {
    expect(formatSlotTimeForCustomer({ startsAt: 'not-a-date', timezone: 'Asia/Seoul' })).toBe('not-a-date')
    expect(formatSlotTimeForCustomer({ startsAt: SLOT_UTC, timezone: 'Not/AZone' })).toBe(SLOT_UTC)
  })
})
