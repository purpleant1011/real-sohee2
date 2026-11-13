import { describe, expect, it, vi } from 'vitest'
import {
  parseKakaoSyncPhone,
  extractKakaoSyncCustomer,
  processKakaoSyncBookingPipeline,
} from './kakao-sync'
import type { KakaoUserProfile } from './token'

describe('Kakao Sync Pipeline (ANI-2083 / KAPI-17)', () => {
  describe('parseKakaoSyncPhone', () => {
    it('카카오 표준 형식(+82 10-xxxx-xxxx)을 010 11자리 및 E.164로 정확히 변환한다', () => {
      const result = parseKakaoSyncPhone('+82 10-1234-5678')
      expect(result).toEqual({
        phone010: '01012345678',
        phoneE164: '+821012345678',
      })
    })

    it('공백 형식(+82 10 xxxx xxxx)을 올바르게 파싱한다', () => {
      const result = parseKakaoSyncPhone('+82 10 9876 5432')
      expect(result).toEqual({
        phone010: '01098765432',
        phoneE164: '+821098765432',
      })
    })

    it('하이픈 없는 E.164(+821012345678)을 올바르게 파싱한다', () => {
      const result = parseKakaoSyncPhone('+821012345678')
      expect(result).toEqual({
        phone010: '01012345678',
        phoneE164: '+821012345678',
      })
    })

    it('+82 010-xxxx-xxxx 형식을 올바르게 파싱한다', () => {
      const result = parseKakaoSyncPhone('+82 010-1234-5678')
      expect(result).toEqual({
        phone010: '01012345678',
        phoneE164: '+821012345678',
      })
    })

    it('국내 표준 하이픈 형식(010-1234-5678)을 올바르게 변환한다', () => {
      const result = parseKakaoSyncPhone('010-1234-5678')
      expect(result).toEqual({
        phone010: '01012345678',
        phoneE164: '+821012345678',
      })
    })

    it('국내 11자리 연속 숫자(01012345678)를 올바르게 변환한다', () => {
      const result = parseKakaoSyncPhone('01012345678')
      expect(result).toEqual({
        phone010: '01012345678',
        phoneE164: '+821012345678',
      })
    })

    it('공백 포함 입력도 앞뒤 공백을 제거하고 안전하게 파싱한다', () => {
      const result = parseKakaoSyncPhone('  +82 10-5555-6666  ')
      expect(result).toEqual({
        phone010: '01055556666',
        phoneE164: '+821055556666',
      })
    })

    it('null, undefined, 빈 문자열 등 유효하지 않은 입력은 null을 반환한다 (Fail-Closed)', () => {
      expect(parseKakaoSyncPhone(null)).toBeNull()
      expect(parseKakaoSyncPhone(undefined)).toBeNull()
      expect(parseKakaoSyncPhone('')).toBeNull()
      expect(parseKakaoSyncPhone('   ')).toBeNull()
    })

    it('유선전화(02, 031 등)는 거부하고 null을 반환한다', () => {
      expect(parseKakaoSyncPhone('02-1234-5678')).toBeNull()
      expect(parseKakaoSyncPhone('+82 2-1234-5678')).toBeNull()
      expect(parseKakaoSyncPhone('031-987-6543')).toBeNull()
    })

    it('인터넷전화(070)는 거부하고 null을 반환한다', () => {
      expect(parseKakaoSyncPhone('070-1234-5678')).toBeNull()
      expect(parseKakaoSyncPhone('+82 70-1234-5678')).toBeNull()
    })

    it('구형 이동전화(011, 016, 019 등)는 거부하고 null을 반환한다', () => {
      expect(parseKakaoSyncPhone('011-123-4567')).toBeNull()
      expect(parseKakaoSyncPhone('016-1234-5678')).toBeNull()
    })

    it('해외 국가 번호(+1, +81 등)는 거부하고 null을 반환한다', () => {
      expect(parseKakaoSyncPhone('+1 202-555-0123')).toBeNull()
      expect(parseKakaoSyncPhone('+81 90-1234-5678')).toBeNull()
    })

    it('자릿수가 모자라거나 넘치는 번호는 거부하고 null을 반환한다', () => {
      expect(parseKakaoSyncPhone('010-123-456')).toBeNull()
      expect(parseKakaoSyncPhone('010-1234-56789')).toBeNull()
    })

    it('문자나 특수기호가 포함된 잘못된 번호는 null을 반환한다', () => {
      expect(parseKakaoSyncPhone('010-ABCD-EFGH')).toBeNull()
    })
  })

  describe('extractKakaoSyncCustomer', () => {
    it('카카오 프로필에 실명(name)과 전화번호가 있으면 우선적으로 추출한다', () => {
      const profile: KakaoUserProfile = {
        id: 987654321,
        kakao_account: {
          name: '홍길동',
          phone_number: '+82 10-1234-5678',
          profile: {
            nickname: '길동이',
          },
        },
      }

      const extracted = extractKakaoSyncCustomer(profile)
      expect(extracted).toEqual({
        kakaoUserId: '987654321',
        name: '홍길동',
        phone010: '01012345678',
        phoneE164: '+821012345678',
      })
    })

    it('실명(name)이 없으면 닉네임(nickname)으로 대체 추출한다', () => {
      const profile: KakaoUserProfile = {
        id: 11223344,
        kakao_account: {
          phone_number: '010-9999-8888',
          profile: {
            nickname: '단골손님',
          },
        },
      }

      const extracted = extractKakaoSyncCustomer(profile)
      expect(extracted).toEqual({
        kakaoUserId: '11223344',
        name: '단골손님',
        phone010: '01099998888',
        phoneE164: '+821099998888',
      })
    })

    it('카카오 ID가 없거나 유효하지 않으면 null을 반환한다 (Fail-Closed)', () => {
      const invalidProfile = {
        id: 0,
        kakao_account: {
          name: '홍길동',
          phone_number: '010-1234-5678',
        },
      } as unknown as KakaoUserProfile

      expect(extractKakaoSyncCustomer(invalidProfile)).toBeNull()
    })

    it('이름과 닉네임이 모두 없으면 null을 반환한다', () => {
      const profile: KakaoUserProfile = {
        id: 123456,
        kakao_account: {
          phone_number: '010-1234-5678',
          profile: {},
        },
      }

      expect(extractKakaoSyncCustomer(profile)).toBeNull()
    })

    it('전화번호가 없거나 잘못된 형식이면 null을 반환한다', () => {
      const profileNoPhone: KakaoUserProfile = {
        id: 123456,
        kakao_account: {
          name: '홍길동',
        },
      }
      expect(extractKakaoSyncCustomer(profileNoPhone)).toBeNull()

      const profileInvalidPhone: KakaoUserProfile = {
        id: 123456,
        kakao_account: {
          name: '홍길동',
          phone_number: '02-123-4567',
        },
      }
      expect(extractKakaoSyncCustomer(profileInvalidPhone)).toBeNull()
    })

    it('kakao_account 자체가 누락되면 null을 반환한다', () => {
      const profileNoAccount: KakaoUserProfile = {
        id: 123456,
      }
      expect(extractKakaoSyncCustomer(profileNoAccount)).toBeNull()
    })
  })

  describe('processKakaoSyncBookingPipeline', () => {
    it('프로필 정보로부터 정본 고객을 생성/조회하고 카카오 식별자 연결 및 예약을 접수한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: 'cust-uuid-1234-5678',
        error: null,
      })

      const mockIdentitiesUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockReservationsInsert = vi.fn().mockResolvedValue({ error: null })

      const mockAdmin = {
        rpc: mockRpc,
        from: vi.fn((table: string) => {
          if (table === 'customer_identities') {
            return {
              upsert: mockIdentitiesUpsert,
            }
          }
          if (table === 'reservations') {
            return {
              insert: mockReservationsInsert,
            }
          }
          return {}
        }),
      }

      const profile: KakaoUserProfile = {
        id: 887766,
        kakao_account: {
          name: '예약고객',
          phone_number: '+82 10-1234-5678',
        },
      }

      const result = await processKakaoSyncBookingPipeline({
        admin: mockAdmin,
        workspaceId: 'ws-test-uuid',
        profile,
        serviceName: '헤어 컷 & 스타일링',
        desiredStartsAt: '2026-11-15T14:00:00+09:00',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.customerUuid).toBe('cust-uuid-1234-5678')
      expect(result.reservationId).toMatch(/^res_/)

      // 1. upsert_customer_by_phone RPC 호출 검증
      expect(mockRpc).toHaveBeenCalledWith('upsert_customer_by_phone', {
        p_workspace_id: 'ws-test-uuid',
        p_display_name: '예약고객',
        p_phone_e164: '+821012345678',
        p_phone_sha256: expect.any(String),
      })

      // 2. customer_identities 연결 검증
      expect(mockIdentitiesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-test-uuid',
          customer_id: 'cust-uuid-1234-5678',
          channel: 'KAKAO',
          subject_ref: '887766',
        }),
        expect.any(Object),
      )

      // 3. reservations 접수 검증
      expect(mockReservationsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-test-uuid',
          customer_uuid: 'cust-uuid-1234-5678',
          customer_name: '예약고객',
          customer_phone: '01012345678',
          service_name: '헤어 컷 & 스타일링',
          channel_source: 'KAKAO_SYNC',
          status: 'AWAITING_CONFIRMATION',
        }),
      )
    })

    it('프로필에서 고객 정보를 추출하지 못하면 파이프라인이 즉시 실패한다 (Fail-Closed)', async () => {
      const mockAdmin = {
        rpc: vi.fn(),
        from: vi.fn(),
      }

      const invalidProfile: KakaoUserProfile = {
        id: 0,
      }

      const result = await processKakaoSyncBookingPipeline({
        admin: mockAdmin,
        workspaceId: 'ws-test-uuid',
        profile: invalidProfile,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe('invalid_kakao_profile')
      expect(mockAdmin.rpc).not.toHaveBeenCalled()
    })

    it('예약 저장 실패 시 에러를 반환한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: 'cust-uuid-1234-5678',
        error: null,
      })
      const mockIdentitiesUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockReservationsInsert = vi.fn().mockResolvedValue({
        error: { message: 'Database lock timeout' },
      })

      const mockAdmin = {
        rpc: mockRpc,
        from: vi.fn((table: string) => {
          if (table === 'customer_identities') {
            return { upsert: mockIdentitiesUpsert }
          }
          if (table === 'reservations') {
            return { insert: mockReservationsInsert }
          }
          return {}
        }),
      }

      const profile: KakaoUserProfile = {
        id: 887766,
        kakao_account: {
          name: '예약고객',
          phone_number: '010-1234-5678',
        },
      }

      const result = await processKakaoSyncBookingPipeline({
        admin: mockAdmin,
        workspaceId: 'ws-test-uuid',
        profile,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe('reservation_creation_failed')
    })
  })
})
