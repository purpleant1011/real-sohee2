import { describe, expect, it, vi } from 'vitest'
import { issuePassToken } from './pass-token'
import {
  maskCustomerPhone,
  resolveBookingPass,
  type BookingPassViewData,
} from './pass-view'

describe('pass-view (Booking Pass Resolver)', () => {
  const secret = 'super-secret-pass-key-12345'
  const workspaceId = 'ws_salon_cheongdam'
  const bookingId = 'bk_pass_001'

  describe('maskCustomerPhone', () => {
    it('masks 11-digit mobile numbers with hyphens: 010-1234-5678 -> 010-****-5678', () => {
      expect(maskCustomerPhone('010-1234-5678')).toBe('010-****-5678')
      expect(maskCustomerPhone('01012345678')).toBe('010-****-5678')
    })

    it('masks 10-digit phone numbers: 010-123-4567 -> 010-***-4567', () => {
      expect(maskCustomerPhone('010-123-4567')).toBe('010-***-4567')
      expect(maskCustomerPhone('0101234567')).toBe('010-***-4567')
    })

    it('masks landline phone numbers: 02-1234-5678 -> 02-****-5678', () => {
      expect(maskCustomerPhone('02-1234-5678')).toBe('02-****-5678')
      expect(maskCustomerPhone('0212345678')).toBe('02-****-5678')
    })

    it('handles empty or invalid inputs gracefully', () => {
      expect(maskCustomerPhone('')).toBe('')
      expect(maskCustomerPhone(null as unknown as string)).toBe('')
      expect(maskCustomerPhone('123')).toBe('***')
    })
  })

  describe('resolveBookingPass', () => {
    function createMockDbClient(options: {
      reservationRow?: Record<string, unknown> | null
      reservationError?: unknown
      businessProfileRow?: Record<string, unknown> | null
      businessProfileError?: unknown
    }) {
      return {
        from: vi.fn((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation(() => ({
                  eq: vi.fn().mockImplementation(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: options.reservationRow ?? null,
                      error: options.reservationError ?? null,
                    }),
                  })),
                })),
              }),
            }
          }
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: options.businessProfileRow ?? null,
                    error: options.businessProfileError ?? null,
                  }),
                })),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      }
    }

    it('returns minimal masked view when requiresReauth is true and not verified', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        ttlSeconds: 3600,
        requiresReauth: true,
      })

      const mockDb = createMockDbClient({
        reservationRow: {
          id: bookingId,
          workspace_id: workspaceId,
          customer_name: '홍길동',
          customer_phone: '010-9876-5432',
          service_name: '프리미엄 헤어컷 & 스파',
          status: 'CONFIRMED',
          deposit_krw: 20000,
          total_amount_krw: 70000,
          metadata: {
            startsAt: '2026년 11월 10일 (화) 14:00',
            bookingNumber: 'RES-20261110-01',
          },
        },
        businessProfileRow: {
          business_name: '청담 살롱 드 소희',
          address: '서울시 강남구 청담동 123-45',
        },
      })

      const result = await resolveBookingPass(token, secret, mockDb)

      expect(result.ok).toBe(true)
      if (result.ok) {
        const pass: BookingPassViewData = result.pass
        expect(pass.requiresReauth).toBe(true)
        expect(pass.shopName).toBe('청담 살롱 드 소희')
        expect(pass.startsAt).toBe('2026년 11월 10일 (화) 14:00')
        expect(pass.status).toBe('CONFIRMED')
        expect(pass.statusLabel).toBe('예약 확정')
        expect(pass.bookingId).toBe(bookingId)

        // Sensitive details MUST be hidden before reauth verification
        expect(pass.serviceName).toBeUndefined()
        expect(pass.paymentSummary).toBeUndefined()
        expect(pass.customerNameMasked).toBeUndefined()
        expect(pass.customerPhoneMasked).toBeUndefined()
        expect(pass.address).toBeUndefined()
        expect(pass.naverMapUrl).toBeUndefined()
      }
    })

    it('resolves full details when verified is true or token does not require reauth', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        ttlSeconds: 3600,
        requiresReauth: true,
      })

      const mockDb = createMockDbClient({
        reservationRow: {
          id: bookingId,
          workspace_id: workspaceId,
          customer_name: '홍길동',
          customer_phone: '010-9876-5432',
          service_name: '프리미엄 헤어컷 & 스파',
          status: 'CONFIRMED',
          deposit_krw: 20000,
          total_amount_krw: 70000,
          payment_status: 'PAID',
          confirmed_at: '2026-11-10T14:00:00.000Z',
          metadata: {
            startsAt: '2026년 11월 10일 (화) 14:00',
            bookingNumber: 'RES-20261110-01',
          },
        },
        businessProfileRow: {
          business_name: '청담 살롱 드 소희',
          address: '서울시 강남구 청담동 123-45',
          contact_phone: '02-555-1234',
        },
      })

      const result = await resolveBookingPass(token, secret, mockDb, { verified: true })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const pass: BookingPassViewData = result.pass
        expect(pass.requiresReauth).toBe(false)
        expect(pass.bookingId).toBe(bookingId)
        expect(pass.bookingNumber).toBe('RES-20261110-01')
        expect(pass.workspaceId).toBe(workspaceId)
        expect(pass.status).toBe('CONFIRMED')
        expect(pass.statusLabel).toBe('예약 확정')
        expect(pass.shopName).toBe('청담 살롱 드 소희')
        expect(pass.address).toBe('서울시 강남구 청담동 123-45')
        expect(pass.customerNameMasked).toBe('홍*동')
        expect(pass.customerPhoneMasked).toBe('010-****-5432')
        expect(pass.serviceName).toBe('프리미엄 헤어컷 & 스파')
        expect(pass.startsAt).toBe('2026년 11월 10일 (화) 14:00')
        expect(pass.paymentSummary).toContain('20,000원 결제 완료')
        expect(pass.naverMapUrl).toContain('map.naver.com')
        // Strict privacy check: No raw PII in output
        expect(JSON.stringify(pass)).not.toContain('홍길동')
        expect(JSON.stringify(pass)).not.toContain('9876')
      }
    })

    it('does not assert payment completed without payment_status: PAID', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        requiresReauth: false,
      })

      const mockDb = createMockDbClient({
        reservationRow: {
          id: bookingId,
          workspace_id: workspaceId,
          customer_name: '홍길동',
          customer_phone: '010-9876-5432',
          service_name: '헤어 컷',
          status: 'CONFIRMED',
          deposit_krw: 20000,
          total_amount_krw: 50000,
          // Notice: NO payment_status field
        },
      })

      const result = await resolveBookingPass(token, secret, mockDb)
      expect(result.ok).toBe(true)
      if (result.ok) {
        // Must NOT conclude '결제 완료' without payment_status column verification
        expect(result.pass.paymentSummary).not.toContain('결제 완료')
        expect(result.pass.paymentSummary).toContain('예약금 안내')
        expect(result.pass.paymentSummary).toContain('20,000원')
      }
    })

    it('rejects expired pass token with reason "expired"', async () => {
      const fixedNow = 1762300000
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        ttlSeconds: 60,
        now: fixedNow,
      })

      const mockDb = createMockDbClient({
        reservationRow: { id: bookingId, workspace_id: workspaceId },
      })

      const result = await resolveBookingPass(token, secret, mockDb, {
        now: fixedNow + 100,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('expired')
        expect(result.error).toMatch(/만료/i)
      }
    })

    it('rejects tampered token with reason "tampered"', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
      })

      const tampered = token.slice(0, -5) + 'AAAAA'
      const mockDb = createMockDbClient({})

      const result = await resolveBookingPass(tampered, secret, mockDb)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('tampered')
      }
    })

    it('returns not_found when reservation does not exist in DB', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId: 'bk_non_existent',
        secret,
      })

      const mockDb = createMockDbClient({
        reservationRow: null,
      })

      const result = await resolveBookingPass(token, secret, mockDb)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('not_found')
        expect(result.error).toMatch(/예약 정보를 찾을 수 없습니다/i)
      }
    })

    it('handles missing business profile with safe fallback', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        requiresReauth: false,
      })

      const mockDb = createMockDbClient({
        reservationRow: {
          id: bookingId,
          workspace_id: workspaceId,
          customer_name: '이순신',
          customer_phone: '01011112222',
          service_name: '스탠다드 케어',
          status: 'PENDING',
          deposit_krw: 0,
          total_amount_krw: 30000,
          metadata: { startsAt: '2026-11-15 11:00' },
        },
        businessProfileRow: null, // No profile
      })

      const result = await resolveBookingPass(token, secret, mockDb)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pass.shopName).toBe('매장 안내')
        expect(result.pass.statusLabel).toBe('예약 대기')
        expect(result.pass.customerNameMasked).toBe('이*신')
        expect(result.pass.customerPhoneMasked).toBe('010-****-2222')
        expect(result.pass.paymentSummary).toContain('30,000원')
      }
    })

    it('formats cancelled reservation with cancelReason and neutral status without payment_status', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        requiresReauth: false,
      })

      const mockDb = createMockDbClient({
        reservationRow: {
          id: bookingId,
          workspace_id: workspaceId,
          customer_name: '김철수',
          customer_phone: '010-3333-4444',
          service_name: '네일 아트',
          status: 'CANCELLED',
          deposit_krw: 10000,
          total_amount_krw: 50000,
          cancel_reason: '고객 개인 사정',
        },
      })

      const result = await resolveBookingPass(token, secret, mockDb)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pass.status).toBe('CANCELLED')
        expect(result.pass.statusLabel).toBe('예약 취소')
        expect(result.pass.cancelReason).toBe('고객 개인 사정')
        expect(result.pass.paymentSummary).not.toContain('환불 처리 진행')
        expect(result.pass.paymentSummary).toContain('결제 여부 매장 문의')
      }
    })

    it('formats cancelled reservation with refund status when payment_status: PAID', async () => {
      const token = await issuePassToken({
        workspaceId,
        bookingId,
        secret,
        requiresReauth: false,
      })

      const mockDb = createMockDbClient({
        reservationRow: {
          id: bookingId,
          workspace_id: workspaceId,
          customer_name: '김철수',
          customer_phone: '010-3333-4444',
          service_name: '네일 아트',
          status: 'CANCELLED',
          deposit_krw: 10000,
          total_amount_krw: 50000,
          payment_status: 'PAID',
          cancel_reason: '고객 개인 사정',
        },
      })

      const result = await resolveBookingPass(token, secret, mockDb)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pass.status).toBe('CANCELLED')
        expect(result.pass.statusLabel).toBe('예약 취소')
        expect(result.pass.cancelReason).toBe('고객 개인 사정')
        expect(result.pass.paymentSummary).toContain('환불 처리 진행')
      }
    })
  })
})
