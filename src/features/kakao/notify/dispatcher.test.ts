import { describe, expect, it, vi } from 'vitest'
import {
  dispatchBookingNotification,
  type DispatchBookingNotificationDeps,
} from './dispatcher'
import { InMemoryLedger } from './ledger-port'
import type { BookingConfirmedEvent } from './booking-notification-mapper'
import type { ConfiguredAlimtalkAdapter } from './solapi-factory'
import type { AlimtalkSendRequest, AlimtalkSendResult } from './alimtalk-contract'

describe('dispatchBookingNotification', () => {
  const secret = 'test-pass-secret-key-must-be-long-enough-32bytes'
  const fixedNow = new Date('2026-11-06T12:00:00.000Z')

  const baseEvent: BookingConfirmedEvent = {
    type: 'BOOKING_CONFIRMED',
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
    consent: 'informational',
    payment: {
      status: 'CONFIRMED',
      amountKrw: 20000,
      paidAt: '2026-11-06T11:00:00Z',
    },
  }

  function createMockAdapter(
    overrides?: Partial<ConfiguredAlimtalkAdapter>,
  ): ConfiguredAlimtalkAdapter {
    return {
      enabled: true,
      send: vi.fn(async (req: AlimtalkSendRequest): Promise<AlimtalkSendResult> => {
        return {
          success: true,
          status: 'SENT',
          idempotencyKey: req.idempotencyKey,
          normalizedPhone: '+821012345678',
          sentAt: fixedNow.toISOString(),
        }
      }),
      readbackStatus: vi.fn(async () => ({ found: false, status: 'NOT_FOUND' as const })),
      ...overrides,
    }
  }

  function setupDeps(options?: {
    adapter?: ConfiguredAlimtalkAdapter
    ledger?: InMemoryLedger
  }): DispatchBookingNotificationDeps & { ledger: InMemoryLedger; adapter: ConfiguredAlimtalkAdapter } {
    const ledger = options?.ledger ?? new InMemoryLedger()
    const adapter = options?.adapter ?? createMockAdapter()
    return {
      adapter,
      ledger,
      mapperDeps: {
        passTokenSecret: secret,
        passBaseUrl: 'https://app.sohee.ai/booking-pass',
        now: fixedNow,
      },
      now: () => fixedNow,
    }
  }

  describe('1. 성공 전이 (SENT)', () => {
    it('dispatches notification, updates ledger to SENT, and returns ownerNotification', async () => {
      const deps = setupDeps()
      const result = await dispatchBookingNotification(baseEvent, deps)

      expect(result.outcome).toBe('SENT')
      expect(result.ownerNotification).toBeDefined()
      expect(result.ownerNotification?.title).toBe('새로운 예약 확정')
      expect(result.ownerNotification?.data.customerNameMasked).toBe('홍*동')
      expect(deps.adapter.send).toHaveBeenCalledTimes(1)

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const ledgerRecord = await deps.ledger.get(idempotencyKey)
      expect(ledgerRecord).not.toBeNull()
      expect(ledgerRecord?.status).toBe('SENT')
      expect(ledgerRecord?.phoneLast4).toBe('5678')
    })
  })

  describe('2. 중복 클레이밍 방지 (DUPLICATE)', () => {
    it('returns DUPLICATE on second call and does not call adapter.send again', async () => {
      const deps = setupDeps()

      // First call -> SENT
      const res1 = await dispatchBookingNotification(baseEvent, deps)
      expect(res1.outcome).toBe('SENT')
      expect(deps.adapter.send).toHaveBeenCalledTimes(1)

      // Second call -> DUPLICATE
      const res2 = await dispatchBookingNotification(baseEvent, deps)
      expect(res2.outcome).toBe('DUPLICATE')
      // Adapter send should NOT be called again
      expect(deps.adapter.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('3. 킬스위치 격리 (DRY_RUN)', () => {
    it('returns DRY_RUN without calling send or claiming live ledger when adapter.enabled is false', async () => {
      const disabledAdapter = createMockAdapter({ enabled: false })
      const deps = setupDeps({ adapter: disabledAdapter })

      const result = await dispatchBookingNotification(baseEvent, deps)

      expect(result.outcome).toBe('DRY_RUN')
      expect(disabledAdapter.send).not.toHaveBeenCalled()

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await deps.ledger.get(idempotencyKey)
      expect(record).toBeNull()
    })

    it('allows 1 live send when enabled adapter retries with the same ledger and event after DRY_RUN', async () => {
      const sharedLedger = new InMemoryLedger()
      const disabledAdapter = createMockAdapter({ enabled: false })
      const disabledDeps = setupDeps({ adapter: disabledAdapter, ledger: sharedLedger })

      // 1) 비활성 adapter로 먼저 전송 시도 -> DRY_RUN
      const dryResult = await dispatchBookingNotification(baseEvent, disabledDeps)
      expect(dryResult.outcome).toBe('DRY_RUN')
      expect(disabledAdapter.send).not.toHaveBeenCalled()

      // 2) 동일 원장/이벤트에 대해 활성 adapter로 전송 시도 -> 1회 실발송 성공해야 함 (키 미점유)
      const enabledAdapter = createMockAdapter({ enabled: true })
      const enabledDeps = setupDeps({ adapter: enabledAdapter, ledger: sharedLedger })

      const liveResult = await dispatchBookingNotification(baseEvent, enabledDeps)
      expect(liveResult.outcome).toBe('SENT')
      expect(enabledAdapter.send).toHaveBeenCalledTimes(1)

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await sharedLedger.get(idempotencyKey)
      expect(record?.status).toBe('SENT')

      // 3) 그 이후 동일 키로 다시 시도하면 실제 중복으로 차단되어야 함
      const duplicateResult = await dispatchBookingNotification(baseEvent, enabledDeps)
      expect(duplicateResult.outcome).toBe('DUPLICATE')
      expect(enabledAdapter.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('4. 동의 검증 (REJECTED)', () => {
    it('rejects without claiming live ledger when consent is not informational', async () => {
      const deps = setupDeps()
      const eventWithoutConsent: BookingConfirmedEvent = {
        ...baseEvent,
        consent: 'none',
      }

      const result = await dispatchBookingNotification(eventWithoutConsent, deps)

      expect(result.outcome).toBe('REJECTED')
      expect(deps.adapter.send).not.toHaveBeenCalled()
      expect(result.error).toMatch(/동의|consent/i)

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await deps.ledger.get(idempotencyKey)
      expect(record).toBeNull()
    })

    it('does not permanently block request when consent is later granted for the same booking', async () => {
      const sharedLedger = new InMemoryLedger()
      const adapter = createMockAdapter({ enabled: true })
      const deps = setupDeps({ adapter, ledger: sharedLedger })

      const eventWithoutConsent: BookingConfirmedEvent = {
        ...baseEvent,
        consent: 'none',
      }

      // 1) 동의 없는 요청 -> REJECTED, 키 미점유
      const rejectedResult = await dispatchBookingNotification(eventWithoutConsent, deps)
      expect(rejectedResult.outcome).toBe('REJECTED')
      expect(adapter.send).not.toHaveBeenCalled()

      // 2) 나중에 동의가 확인된 동일 키 요청 -> SENT 성공
      const approvedResult = await dispatchBookingNotification(baseEvent, deps)
      expect(approvedResult.outcome).toBe('SENT')
      expect(adapter.send).toHaveBeenCalledTimes(1)

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await sharedLedger.get(idempotencyKey)
      expect(record?.status).toBe('SENT')
    })
  })

  describe('5. 어댑터 예외 처리 (FAILED)', () => {
    it('does not throw when adapter throws, transitions ledger to FAILED, and masks sensitive info', async () => {
      const throwingAdapter = createMockAdapter({
        send: vi.fn(async () => {
          throw new Error('Connection reset by peer with phone 010-1234-5678 and token secret_abc123')
        }),
      })
      const deps = setupDeps({ adapter: throwingAdapter })

      const result = await dispatchBookingNotification(baseEvent, deps)

      expect(result.outcome).toBe('FAILED')
      expect(result.error).toBeDefined()
      // 전체 전화번호 및 시크릿이 마스킹되어야 함
      expect(result.error).not.toContain('010-1234-5678')
      expect(result.error).not.toContain('01012345678')

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await deps.ledger.get(idempotencyKey)
      expect(record?.status).toBe('FAILED')
      expect(record?.error).not.toContain('010-1234-5678')
    })
  })

  describe('6. 어댑터 실패 및 거부 상태 반환 처리', () => {
    it('records FAILED in ledger when adapter returns FAILED', async () => {
      const failingAdapter = createMockAdapter({
        send: vi.fn(async (req) => ({
          success: false,
          status: 'FAILED' as const,
          idempotencyKey: req.idempotencyKey,
          error: 'Solapi network error for recipient 01012345678',
          sentAt: fixedNow.toISOString(),
        })),
      })
      const deps = setupDeps({ adapter: failingAdapter })

      const result = await dispatchBookingNotification(baseEvent, deps)

      expect(result.outcome).toBe('FAILED')
      expect(result.error).not.toContain('01012345678')

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await deps.ledger.get(idempotencyKey)
      expect(record?.status).toBe('FAILED')
      expect(record?.error).not.toContain('01012345678')
    })

    it('records REJECTED in ledger when adapter returns REJECTED', async () => {
      const rejectingAdapter = createMockAdapter({
        send: vi.fn(async (req) => ({
          success: false,
          status: 'REJECTED' as const,
          idempotencyKey: req.idempotencyKey,
          error: '광고성 문구 포함 거부',
          sentAt: fixedNow.toISOString(),
        })),
      })
      const deps = setupDeps({ adapter: rejectingAdapter })

      const result = await dispatchBookingNotification(baseEvent, deps)

      expect(result.outcome).toBe('REJECTED')

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await deps.ledger.get(idempotencyKey)
      expect(record?.status).toBe('REJECTED')
    })
  })

  describe('7. 전화번호 원문 미저장 불변식 (PII 최소화)', () => {
    it('only stores last 4 digits in ledger and never exposes full phone number', async () => {
      const deps = setupDeps()
      await dispatchBookingNotification(baseEvent, deps)

      const idempotencyKey = 'alimtalk:ws-shop-123:book-999:booking_confirmed'
      const record = await deps.ledger.get(idempotencyKey)

      expect(record?.phoneLast4).toBe('5678')
      const recordJson = JSON.stringify(record)
      expect(recordJson).not.toContain('010-1234-5678')
      expect(recordJson).not.toContain('01012345678')
      expect(recordJson).not.toContain('+821012345678')
    })
  })
})
