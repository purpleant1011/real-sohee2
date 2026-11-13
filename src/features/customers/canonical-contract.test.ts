import { describe, expect, it } from 'vitest'
import {
  maskPhoneE164,
  type CanonicalCustomerItem,
  type CanonicalCustomersResponse,
} from './canonical-contract'

describe('canonical-contract', () => {
  describe('maskPhoneE164', () => {
    it('+821027104855 형식을 010-****-4855 형식으로 마스킹한다', () => {
      expect(maskPhoneE164('+821027104855')).toBe('010-****-4855')
    })

    it('앞뒤 공백이 있어도 정상 마스킹한다', () => {
      expect(maskPhoneE164('  +821012345678  ')).toBe('010-****-5678')
    })

    it('null, undefined, 빈 문자열이면 null을 반환한다', () => {
      expect(maskPhoneE164(null)).toBeNull()
      expect(maskPhoneE164(undefined)).toBeNull()
      expect(maskPhoneE164('')).toBeNull()
      expect(maskPhoneE164('   ')).toBeNull()
    })

    it('형식이 맞지 않는 잘못된 문자열이면 null을 반환한다', () => {
      expect(maskPhoneE164('invalid-phone')).toBeNull()
      expect(maskPhoneE164('01012345678')).toBeNull()
    })
  })

  describe('type shape verification', () => {
    it('CanonicalCustomerItem 및 CanonicalCustomersResponse 인터페이스 형태 검증', () => {
      const item: CanonicalCustomerItem = {
        id: 'cust-uuid-1',
        displayName: '홍길동',
        phoneMasked: '010-****-4855',
        reservationCount: 3,
        lastBookingStartsAt: '2026-11-10T14:00:00+09:00',
      }

      const response: CanonicalCustomersResponse = {
        ok: true,
        items: [item],
      }

      expect(response.ok).toBe(true)
      expect(response.items).toHaveLength(1)
      expect(response.items[0].phoneMasked).toBe('010-****-4855')
    })
  })
})
