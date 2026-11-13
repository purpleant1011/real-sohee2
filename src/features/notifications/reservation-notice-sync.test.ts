/**
 * 예약 취소·변경 → 안내 job 동기화 계약 (TEST 전용) · ANI-1620
 *
 * 이 계층은 예약 쓰기가 이미 커밋된 뒤에 호출되므로, 포트 예외를 예약 실패로 승격하지 않는다.
 * 대신 SYNC_FAILED를 결과로 돌려주고 noticesTouched를 0으로 둔다(성공 위장 금지).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reservationNoticeVersion,
  setBookingNoticeSyncPort,
  syncBookingNoticeState,
  type BookingNoticeSyncInput,
  type BookingNoticeSyncPort,
} from './reservation-notice-sync'
import { TestNoticeJobLedger } from './notice-job-ledger'
import { createNoticeLedgerSyncPort } from './testing/notice-ledger-sync-port'

const WS = '11111111-2222-3333-4444-555555555555'
const BOOKING = 'bk-sync-unit'
const UPDATED_AT = '2026-10-22T02:00:00.000Z'
const SLOT_16 = '2026-10-23T16:00:00+09:00'
const NOW_BEFORE = new Date('2026-10-22T00:00:00+09:00')

function syncInput(overrides: Partial<BookingNoticeSyncInput> = {}): BookingNoticeSyncInput {
  return {
    workspaceId: WS,
    bookingId: BOOKING,
    change: 'RESCHEDULED',
    currentVersion: reservationNoticeVersion(UPDATED_AT),
    currentStatus: 'CONFIRMED',
    slotId: SLOT_16,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  setBookingNoticeSyncPort(null)
})

describe('reservationNoticeVersion · 예약 updated_at → 단조 version', () => {
  it('offset 있는 instant를 ms epoch 정수로 바꾼다', () => {
    expect(reservationNoticeVersion('2026-10-22T01:00:00.000Z')).toBe(Date.parse('2026-10-22T01:00:00.000Z'))
    expect(Number.isSafeInteger(reservationNoticeVersion('2026-10-22T01:00:00+09:00'))).toBe(true)
  })

  it('나중 updated_at은 더 큰 version이다', () => {
    expect(reservationNoticeVersion('2026-10-22T02:00:00.000Z')).toBeGreaterThan(
      reservationNoticeVersion('2026-10-22T01:00:00.000Z')
    )
  })

  it.each(['2026-10-22T02:00:00', 'not-a-date', '', '   '])(
    'offset이 없거나 파싱 불가한 %j 는 추측하지 않고 INVALID_NOTICE_VERSION으로 거부한다',
    (updatedAt) => {
      expect(() => reservationNoticeVersion(updatedAt)).toThrow('INVALID_NOTICE_VERSION')
    }
  )
})

describe('syncBookingNoticeState · 포트 미등록은 예약 흐름을 막지 않는다', () => {
  it('포트가 없으면 NOT_CONFIGURED이고 아무 것도 건드리지 않는다', async () => {
    const result = await syncBookingNoticeState(syncInput())

    expect(result.kind).toBe('NOT_CONFIGURED')
    expect(result.noticesTouched).toBe(0)
    expect(result.invalidated).toBe(0)
    expect(result.inFlightOrSent).toBe(0)
    expect(result.replanned).toBe(0)
    expect(result.datasetMode).toBe('TEST')
    expect(result.actualVerified).toBe(false)
  })
})

describe('syncBookingNoticeState · 변경/취소 순서', () => {
  it('변경은 무효화 후 새 일정으로 재계획한다', async () => {
    const calls: string[] = []
    const port: BookingNoticeSyncPort = {
      async invalidateForBooking(received) {
        calls.push(`invalidate:${received.change}:${received.currentVersion}:${received.slotId}`)
        return { invalidated: 2, inFlightOrSent: 1 }
      },
      async replanForBooking(received) {
        calls.push(`replan:${received.change}:${received.currentVersion}`)
        return { planned: 1 }
      },
    }
    setBookingNoticeSyncPort(port)

    const result = await syncBookingNoticeState(syncInput())

    expect(calls).toEqual([
      `invalidate:RESCHEDULED:${reservationNoticeVersion(UPDATED_AT)}:${SLOT_16}`,
      `replan:RESCHEDULED:${reservationNoticeVersion(UPDATED_AT)}`,
    ])
    expect(result.kind).toBe('SYNCED')
    expect(result.invalidated).toBe(2)
    expect(result.inFlightOrSent).toBe(1)
    expect(result.replanned).toBe(1)
    expect(result.noticesTouched).toBe(3)
    expect(result.error).toBeNull()
    expect(result.datasetMode).toBe('TEST')
    expect(result.actualVerified).toBe(false)
  })

  it('취소는 재계획하지 않는다(취소 안내는 별도 승인·별도 job)', async () => {
    let replanCalled = false
    const port: BookingNoticeSyncPort = {
      async invalidateForBooking() {
        return { invalidated: 1, inFlightOrSent: 0 }
      },
      async replanForBooking() {
        replanCalled = true
        return { planned: 1 }
      },
    }
    setBookingNoticeSyncPort(port)

    const result = await syncBookingNoticeState(
      syncInput({ change: 'CANCELLED', currentStatus: 'CANCELLED' })
    )

    expect(replanCalled).toBe(false)
    expect(result.kind).toBe('SYNCED')
    expect(result.replanned).toBe(0)
    expect(result.noticesTouched).toBe(1)
  })

  it('replan 포트가 없으면 무효화만 하고 planned는 0이다', async () => {
    setBookingNoticeSyncPort({
      async invalidateForBooking() {
        return { invalidated: 1, inFlightOrSent: 0 }
      },
    })

    const result = await syncBookingNoticeState(syncInput())

    expect(result.kind).toBe('SYNCED')
    expect(result.replanned).toBe(0)
    expect(result.noticesTouched).toBe(1)
  })
})

describe('syncBookingNoticeState · 포트 예외는 삼키지 않고 SYNC_FAILED로 남긴다', () => {
  it('무효화 중 예외가 나도 throw하지 않고 SYNC_FAILED + noticesTouched 0이다', async () => {
    setBookingNoticeSyncPort({
      async invalidateForBooking() {
        throw new Error('LEDGER_UNAVAILABLE')
      },
      async replanForBooking() {
        return { planned: 1 }
      },
    })

    const result = await syncBookingNoticeState(syncInput())

    expect(result.kind).toBe('SYNC_FAILED')
    expect(result.error).toContain('LEDGER_UNAVAILABLE')
    expect(result.noticesTouched).toBe(0)
    expect(result.invalidated).toBe(0)
    expect(result.replanned).toBe(0)
    expect(result.datasetMode).toBe('TEST')
    expect(result.actualVerified).toBe(false)
  })

  it('재계획 중 예외도 SYNC_FAILED이며 성공으로 집계하지 않는다', async () => {
    setBookingNoticeSyncPort({
      async invalidateForBooking() {
        return { invalidated: 1, inFlightOrSent: 0 }
      },
      async replanForBooking() {
        throw new Error('REPLAN_FAILED')
      },
    })

    const result = await syncBookingNoticeState(syncInput())

    expect(result.kind).toBe('SYNC_FAILED')
    expect(result.error).toContain('REPLAN_FAILED')
    expect(result.noticesTouched).toBe(0)
  })
})

describe('setBookingNoticeSyncPort · 운영에서는 등록할 수 없다', () => {
  it('production에서 포트 등록은 거부한다', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() =>
      setBookingNoticeSyncPort({
        async invalidateForBooking() {
          return { invalidated: 0, inFlightOrSent: 0 }
        },
      })
    ).toThrow(/PRODUCTION_FORBIDDEN/)
  })
})

describe('createNoticeLedgerSyncPort · TEST 전용 어댑터', () => {
  it('slot_id가 offset ISO가 아니면 시각을 지어내지 않고 SLOT_NOT_INSTANT로 건너뛴다', async () => {
    const ledger = new TestNoticeJobLedger()
    const port = createNoticeLedgerSyncPort({
      ledger,
      templateVersion: 'tpl-v1',
      recipientRefHash: 'recipient-ref-hash-unit',
      renderedBodyFor: () => '방문 전 안내예요.',
      now: () => NOW_BEFORE,
      consentGrantedFor: () => true,
    })

    const result = await port.replanForBooking?.(
      syncInput({ slotId: 'slot-16', currentVersion: reservationNoticeVersion(UPDATED_AT) })
    )

    expect(result?.planned).toBe(0)
    expect(result?.skippedReason).toBe('SLOT_NOT_INSTANT')
    expect(ledger.list(WS, BOOKING)).toEqual([])
  })

  it('수신 근거가 주입되지 않으면 fail-closed로 계획하지 않는다', async () => {
    const ledger = new TestNoticeJobLedger()
    const port = createNoticeLedgerSyncPort({
      ledger,
      templateVersion: 'tpl-v1',
      recipientRefHash: 'recipient-ref-hash-unit',
      renderedBodyFor: () => '방문 전 안내예요.',
      now: () => NOW_BEFORE,
    })

    const result = await port.replanForBooking?.(syncInput())

    expect(result?.planned).toBe(0)
    expect(result?.skippedReason).toBe('REJECTED:CONSENT_NOT_GRANTED')
    expect(ledger.list(WS, BOOKING)).toEqual([])
  })

  it('slot_id instant와 주입된 본문으로만 REMINDER를 계획한다', async () => {
    const ledger = new TestNoticeJobLedger()
    const port = createNoticeLedgerSyncPort({
      ledger,
      templateVersion: 'tpl-v1',
      recipientRefHash: 'recipient-ref-hash-unit',
      renderedBodyFor: () => '10월 23일 16:00 예약 안내입니다.',
      now: () => NOW_BEFORE,
      consentGrantedFor: () => true,
    })

    const result = await port.replanForBooking?.(syncInput())

    expect(result?.planned).toBe(1)
    const jobs = ledger.list(WS, BOOKING)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.kind).toBe('REMINDER')
    expect(jobs[0]?.leadMinutes).toBe(1440)
    expect(Date.parse(jobs[0]!.scheduledAt)).toBe(Date.parse('2026-10-22T16:00:00+09:00'))
    expect(Date.parse(jobs[0]!.startsAt)).toBe(Date.parse(SLOT_16))
    expect(jobs[0]?.renderedBody).toBe('10월 23일 16:00 예약 안내입니다.')
  })

  it('변경 사유가 없으면 BOOKING_CHANGED_BEFORE_DISPATCH로 무효화한다', async () => {
    const ledger = new TestNoticeJobLedger()
    const planned = ledger.plan({
      workspaceId: WS,
      bookingId: BOOKING,
      bookingVersion: reservationNoticeVersion('2026-10-22T01:00:00.000Z'),
      kind: 'REMINDER',
      templateVersion: 'tpl-v1',
      recipientRef: 'recipient-ref-hash-unit',
      scheduledAt: '2026-10-22T06:00:00.000Z',
      renderedBody: '방문 전 안내예요.',
      startsAt: '2026-10-23T06:00:00.000Z',
      leadMinutes: 1440,
    })
    if (planned.kind !== 'PLANNED') throw new Error('fixture failed')

    const port = createNoticeLedgerSyncPort({
      ledger,
      templateVersion: 'tpl-v1',
      recipientRefHash: 'recipient-ref-hash-unit',
      renderedBodyFor: () => '방문 전 안내예요.',
    })

    const result = await port.invalidateForBooking(syncInput())

    expect(result).toEqual({ invalidated: 1, inFlightOrSent: 0 })
    expect(ledger.get(WS, planned.job.jobId)?.reason).toBe('BOOKING_CHANGED_BEFORE_DISPATCH')
  })

  it('무효화는 원장 결과를 건수로 돌려준다', async () => {
    const ledger = new TestNoticeJobLedger()
    const port = createNoticeLedgerSyncPort({
      ledger,
      templateVersion: 'tpl-v1',
      recipientRefHash: 'recipient-ref-hash-unit',
      renderedBodyFor: () => '방문 전 안내예요.',
    })

    const result = await port.invalidateForBooking(syncInput())

    expect(result).toEqual({ invalidated: 0, inFlightOrSent: 0 })
  })

  it('production에서는 어댑터를 만들 수 없다', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() =>
      createNoticeLedgerSyncPort({
        ledger: new TestNoticeJobLedger(),
        templateVersion: 'tpl-v1',
        recipientRefHash: 'recipient-ref-hash-unit',
        renderedBodyFor: () => '방문 전 안내예요.',
      })
    ).toThrow(/PRODUCTION_FORBIDDEN/)
  })
})
