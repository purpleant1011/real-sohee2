import { describe, expect, it } from 'vitest'
import { DryRunAlimtalkAdapter } from './alimtalk-contract'
import {
  mapBookingEventToNotifications,
  maskCustomerName,
  type BookingCancelledEvent,
  type BookingChangedEvent,
  type BookingConfirmedEvent,
  type PaymentConfirmedEvent,
  type Reminder24hEvent,
  type Reminder2hEvent,
} from './booking-notification-mapper'
import { ALIMTALK_TEMPLATES } from './templates'

describe('booking-notification-mapper', () => {
  const secret = 'test-pass-secret-key-must-be-long-enough-32bytes'
  const baseDeps = {
    passTokenSecret: secret,
    passBaseUrl: 'https://app.sohee.ai/booking-pass',
    now: new Date('2026-11-06T10:00:00Z'),
  }

  const baseEvent = {
    workspaceId: 'ws-shop-123',
    bookingId: 'book-999',
    bookingVersion: 1,
    customerId: 'cust-555',
    customerName: '홍길동',
    customerPhone: '010-1234-5678',
    serviceName: '헤어 컷 & 스타일링',
    startsAt: '2026-11-07 14:00',
    shopName: '바이름 헤어 청라점',
    locationText: '인천 서구 청라라임로 123',
    consent: 'informational' as const,
  }

  describe('maskCustomerName', () => {
    it('masks 2-character names', () => {
      expect(maskCustomerName('김민')).toBe('김*')
    })

    it('masks 3-character names', () => {
      expect(maskCustomerName('홍길동')).toBe('홍*동')
    })

    it('masks 4-character and longer names', () => {
      expect(maskCustomerName('남궁민수')).toBe('남**수')
      expect(maskCustomerName('알렉산더')).toBe('알**더')
    })

    it('handles single-character or empty strings safely', () => {
      expect(maskCustomerName('홍')).toBe('홍')
      expect(maskCustomerName('')).toBe('')
    })
  })

  describe('1. 예약 확정 (BOOKING_CONFIRMED)', () => {
    it('maps confirmed booking with confirmed deposit correctly', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
        payment: {
          status: 'CONFIRMED',
          amountKrw: 30000,
          paidAt: '2026-11-06 09:30',
        },
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      // (a) 고객용 알림톡 검증
      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_BOOKING_CONFIRMED_V1')
      expect(result.customerAlimtalk.idempotencyKey).toBe(
        'alimtalk:ws-shop-123:book-999:booking_confirmed',
      )
      expect(result.customerAlimtalk.recipientPhone).toBe('010-1234-5678')
      expect(result.customerAlimtalk.consent).toBe('informational')
      expect(result.customerAlimtalk.bookingNumber).toBe('book-999')
      expect(result.customerAlimtalk.buttonVariables?.['예약패스링크']).toBeUndefined()
      expect(result.customerAlimtalk.variables['결제안내']).toBe('예약금 30,000원 결제 완료')
      expect(result.customerAlimtalk.variables['예약패스링크']).toBeUndefined()

      // DryRun 어댑터 검증
      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)
      expect(dryRunRes.status).toBe('DRY_RUN')
      expect(dryRunRes.normalizedPhone).toBe('+821012345678')

      // (b) 사장님용 앱 알림 검증 (PII 최소화)
      expect(result.ownerNotification.eventType).toBe('BOOKING_CONFIRMED')
      expect(result.ownerNotification.data.customerNameMasked).toBe('홍*동')
      expect(result.ownerNotification.data.paymentSummary).toBe('예약금 30,000원 결제 완료')
      // 사장님 알림에 고객 원문 전화번호 노출 금지
      expect(JSON.stringify(result.ownerNotification)).not.toContain('010-1234-5678')
    })

    it('does NOT assert confirmed deposit when deposit is unconfirmed or pending', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
        payment: {
          status: 'PENDING',
          amountKrw: 30000,
        },
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      // 확정 전 금액 단정 금지! 확인된 내역만 표시
      expect(result.customerAlimtalk.variables['결제안내']).toBe('결제 확인 중 (현장 안내)')
      expect(result.ownerNotification.data.paymentSummary).toBe('결제 확인 중 (미확정)')

      // DryRun 어댑터 검증
      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)
    })

    it('handles booking without deposit correctly', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      expect(result.customerAlimtalk.variables['결제안내']).toBe('현장 결제 예정')
      expect(result.ownerNotification.data.paymentSummary).toBe('현장 결제')
    })
  })

  describe('2. 예약 변경 (BOOKING_CHANGED)', () => {
    it('maps changed booking event with previous and new time', async () => {
      const event: BookingChangedEvent = {
        ...baseEvent,
        type: 'BOOKING_CHANGED',
        previousStartsAt: '2026-11-07 14:00',
        newStartsAt: '2026-11-08 16:00',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_BOOKING_CHANGED_V1')
      expect(result.customerAlimtalk.idempotencyKey).toBe(
        'alimtalk:ws-shop-123:book-999:booking_changed',
      )
      expect(result.customerAlimtalk.variables['이전예약일시']).toBe('2026-11-07 14:00')
      expect(result.customerAlimtalk.variables['변경예약일시']).toBe('2026-11-08 16:00')

      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)

      expect(result.ownerNotification.eventType).toBe('BOOKING_CHANGED')
      expect(result.ownerNotification.data.startsAt).toBe('2026-11-08 16:00')
      expect(JSON.stringify(result.ownerNotification)).not.toContain('010-1234-5678')
    })
  })

  describe('3. 예약 취소 (BOOKING_CANCELLED)', () => {
    it('maps cancelled booking event with refund note when confirmed', async () => {
      const event: BookingCancelledEvent = {
        ...baseEvent,
        type: 'BOOKING_CANCELLED',
        cancelReason: '고객 개인 사정',
        payment: {
          status: 'CONFIRMED',
          amountKrw: 30000,
        },
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_BOOKING_CANCELLED_V1')
      expect(result.customerAlimtalk.idempotencyKey).toBe(
        'alimtalk:ws-shop-123:book-999:booking_cancelled',
      )
      expect(result.customerAlimtalk.bookingNumber).toBe('book-999')
      expect(result.customerAlimtalk.variables['취소사유']).toBe('고객 개인 사정')
      expect(result.customerAlimtalk.variables['환불안내']).toBe('예약금 30,000원 환불 절차 진행')
      // 본문 미사용 변수 검증(validateTemplateVariables)에서 제외되도록 variables에는 미포함
      expect(result.customerAlimtalk.variables['예약패스링크']).toBeUndefined()
      // 버튼 제거로 buttonVariables에도 예약패스링크 없음
      expect(result.customerAlimtalk.buttonVariables?.['예약패스링크']).toBeUndefined()

      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)

      expect(result.ownerNotification.eventType).toBe('BOOKING_CANCELLED')
      expect(result.ownerNotification.title).toContain('취소')
      expect(JSON.stringify(result.ownerNotification)).not.toContain('010-1234-5678')
    })

    it('injects custom bookingNumber when provided in event', async () => {
      const event: BookingCancelledEvent = {
        ...baseEvent,
        type: 'BOOKING_CANCELLED',
        bookingNumber: 'B-20261107-777',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)
      expect(result.customerAlimtalk.bookingNumber).toBe('B-20261107-777')
    })
  })

  describe('4. 결제 완료 (PAYMENT_CONFIRMED)', () => {
    it('maps payment confirmed event with exact amount', async () => {
      const event: PaymentConfirmedEvent = {
        ...baseEvent,
        type: 'PAYMENT_CONFIRMED',
        payment: {
          status: 'CONFIRMED',
          amountKrw: 30000,
          paidAt: '2026-11-06 11:20',
        },
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_PAYMENT_CONFIRMED_V1')
      expect(result.customerAlimtalk.idempotencyKey).toBe(
        'alimtalk:ws-shop-123:book-999:payment_confirmed',
      )
      expect(result.customerAlimtalk.variables['결제금액']).toBe('30,000원')

      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)

      expect(result.ownerNotification.eventType).toBe('PAYMENT_CONFIRMED')
      expect(result.ownerNotification.data.paymentSummary).toBe('30,000원 결제 완료')
    })
  })

  describe('5. 리마인더 (REMINDER_24H / REMINDER_2H)', () => {
    it('maps 24h reminder event', async () => {
      const event: Reminder24hEvent = {
        ...baseEvent,
        type: 'REMINDER_24H',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_REMINDER_24H_V1')
      expect(result.customerAlimtalk.templateBody).toBe(
        ALIMTALK_TEMPLATES.REMINDER_24H.templateBody,
      )
      expect(result.customerAlimtalk.idempotencyKey).toBe(
        'alimtalk:ws-shop-123:book-999:reminder_24h',
      )
      expect(result.customerAlimtalk.variables['안내시점']).toBe('내일')
      expect(result.customerAlimtalk.bookingNumber).toBe('book-999')
      expect(result.customerAlimtalk.buttonVariables?.['예약패스링크']).toBeUndefined()
      expect(result.customerAlimtalk.variables['예약패스링크']).toBeUndefined()

      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)

      expect(result.ownerNotification.eventType).toBe('REMINDER_24H')
    })

    it('maps 2h reminder event', async () => {
      const event: Reminder2hEvent = {
        ...baseEvent,
        type: 'REMINDER_2H',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)

      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_REMINDER_2H_V1')
      expect(result.customerAlimtalk.templateBody).toBe(
        ALIMTALK_TEMPLATES.REMINDER_2H.templateBody,
      )
      expect(result.customerAlimtalk.idempotencyKey).toBe(
        'alimtalk:ws-shop-123:book-999:reminder_2h',
      )
      expect(result.customerAlimtalk.variables['안내시점']).toBe('곧 (2시간 전)')
      expect(result.customerAlimtalk.bookingNumber).toBe('book-999')
      expect(result.customerAlimtalk.buttonVariables?.['예약패스링크']).toBeUndefined()
      expect(result.customerAlimtalk.variables['예약패스링크']).toBeUndefined()

      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(true)

      expect(result.ownerNotification.eventType).toBe('REMINDER_2H')
    })
  })

  describe('6. 동의 및 광고성 문구 방어', () => {
    it('passes consent: "none" when event consent is "none" and adapter rejects sending', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
        consent: 'none',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)
      expect(result.customerAlimtalk.consent).toBe('none')

      const adapter = new DryRunAlimtalkAdapter()
      const dryRunRes = await adapter.send(result.customerAlimtalk)
      expect(dryRunRes.success).toBe(false)
      expect(dryRunRes.status).toBe('REJECTED')
      expect(dryRunRes.error).toContain('동의')
    })

    it('ensures no promotional or advertising content exists in templates or variables', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
      }

      const result = await mapBookingEventToNotifications(event, baseDeps)
      const allText =
        result.customerAlimtalk.templateBody +
        JSON.stringify(result.customerAlimtalk.variables)

      const adKeywords = [
        '광고',
        '할인쿠폰',
        '특가',
        '이벤트할인',
        '무료수신거부',
      ]
      for (const kw of adKeywords) {
        expect(allText).not.toContain(kw)
      }
    })

    it('works safely even when passTokenSecret is omitted in deps (optional dependency)', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
      }

      // passTokenSecret 없는 빈 deps 객체
      const result = await mapBookingEventToNotifications(event, {})
      expect(result.customerAlimtalk.templateCode).toBe('SOHEE_BOOKING_CONFIRMED_V1')
      expect(result.customerAlimtalk.variables['예약패스링크']).toBeUndefined()
      expect(result.customerAlimtalk.buttonVariables?.['예약패스링크']).toBeUndefined()
      expect(result.ownerNotification.eventType).toBe('BOOKING_CONFIRMED')
    })
  })
})
