/**
 * 예약 변경/취소 → TEST 안내 원장 sync 어댑터 · ANI-1620
 *
 * `TestNoticeJobLedger` + `planNotice`를 `BookingNoticeSyncPort`로 감싼 TEST 전용 어댑터다.
 * 운영 queue/outbox가 아니며 production에서는 생성 자체를 거부한다.
 *
 * 원칙:
 * - 재계획은 "변경 후 예약이 CONFIRMED"이고 `slotId`가 offset 있는 ISO instant일 때만 한다.
 *   `slotId`가 ISO가 아니면 시각을 지어내지 않고 SLOT_NOT_INSTANT로 건너뛴다.
 * - 본문은 `renderedBodyFor`가 주입한 문자열만 쓴다. 어댑터가 15:00/16:00 같은 시각을
 *   만들어내지 않는다.
 * - 수신 근거(consent)는 어댑터가 추정하지 않는다. `consentGrantedFor`가 없으면
 *   planNotice가 CONSENT_NOT_GRANTED로 거부하는 fail-closed 동작을 그대로 쓴다.
 */

import { TestNoticeJobLedger } from '../notice-job-ledger'
import { planNotice } from '../notice-schedule'
import type { BookingNoticeSyncInput, BookingNoticeSyncPort } from '../reservation-notice-sync'

const OFFSET_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

const DEFAULT_LEAD_MINUTES = 1440

export type NoticeLedgerSyncPortOptions = Readonly<{
  ledger: TestNoticeJobLedger
  templateVersion: string
  /** 원문 연락처가 아니라 비가역 참조(또는 해시)만 넣는다. 원장이 다시 해시해 저장한다. */
  recipientRefHash: string
  /** 변경 후 예약 기준으로 렌더된 본문. 어댑터는 이 문자열을 변형하지 않는다. */
  renderedBodyFor: (input: BookingNoticeSyncInput) => string
  leadMinutes?: number
  /** 테스트 clock 주입. 기본은 호출 시각. */
  now?: () => Date
  /** INFO 수신 근거. 주입하지 않으면 fail-closed로 계획하지 않는다. */
  consentGrantedFor?: (input: BookingNoticeSyncInput) => boolean
}>

export function createNoticeLedgerSyncPort(options: NoticeLedgerSyncPortOptions): BookingNoticeSyncPort {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PRODUCTION_FORBIDDEN: notice ledger sync port is TEST-only')
  }

  const { ledger, templateVersion, recipientRefHash, renderedBodyFor } = options
  const leadMinutes = options.leadMinutes ?? DEFAULT_LEAD_MINUTES
  const now = options.now ?? (() => new Date())
  const consentGrantedFor = options.consentGrantedFor ?? (() => false)

  return {
    async invalidateForBooking(input: BookingNoticeSyncInput) {
      const invalidated = ledger.invalidateForBooking({
        workspaceId: input.workspaceId,
        bookingId: input.bookingId,
        currentVersion: input.currentVersion,
        currentStatus: input.currentStatus,
        reason: input.reason ?? 'BOOKING_CHANGED_BEFORE_DISPATCH',
      })
      return {
        invalidated: invalidated.invalidated.length,
        inFlightOrSent: invalidated.inFlightOrSent.length,
      }
    },

    async replanForBooking(input: BookingNoticeSyncInput) {
      if (input.currentStatus !== 'CONFIRMED') {
        return { planned: 0, skippedReason: 'BOOKING_NOT_CONFIRMED' }
      }
      if (!OFFSET_ISO_PATTERN.test(input.slotId) || !Number.isFinite(Date.parse(input.slotId))) {
        return { planned: 0, skippedReason: 'SLOT_NOT_INSTANT' }
      }

      const planned = planNotice({
        ledger,
        fact: {
          workspaceId: input.workspaceId,
          bookingId: input.bookingId,
          bookingVersion: input.currentVersion,
          status: 'CONFIRMED',
          // 이 어댑터는 손님 식별자/서비스명/위치를 읽지 않는다. planNotice도 이 필드를 쓰지 않는다.
          customerId: '',
          startsAt: input.slotId,
          serviceName: '',
          locationText: '',
          datasetMode: 'TEST',
        },
        kind: 'REMINDER',
        leadMinutes,
        templateVersion,
        recipientRef: recipientRefHash,
        renderedBody: renderedBodyFor(input),
        consentGranted: consentGrantedFor(input),
        now: now(),
      })

      switch (planned.kind) {
        case 'PLANNED':
          return { planned: 1 }
        case 'REPLAY':
          return { planned: 0, skippedReason: 'REPLAY' }
        case 'CONFLICT':
          return { planned: 0, skippedReason: 'CONFLICT' }
        case 'REJECTED':
          return { planned: 0, skippedReason: `REJECTED:${planned.reason}` }
      }
    },
  }
}
