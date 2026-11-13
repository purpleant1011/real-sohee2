import { describe, expect, it, vi } from 'vitest'
import { createSolapiOutboxSender } from './outbox-sender'
import type { Job, ReservationSnapshot } from './outbox-processor'
import type { SolapiEnv } from './solapi-factory'

describe('createSolapiOutboxSender', () => {
  const validJobId = '550e8400-e29b-41d4-a716-446655440000'
  const validWorkspaceId = 'ws-test-123'
  const validReservationId = 'res-test-456'

  const sampleJob: Job = {
    id: validJobId,
    workspaceId: validWorkspaceId,
    reservationId: validReservationId,
    reservationUpdatedAt: '2026-11-06T10:00:00.123456+00:00',
    event: 'BOOKING_CONFIRMED',
    dueAt: '2026-11-06T10:00:00.000Z',
  }

  const sampleSnapshot: ReservationSnapshot = {
    workspaceId: validWorkspaceId,
    reservationId: validReservationId,
    version: '2026-11-06T10:00:00.123456+00:00',
    status: 'CONFIRMED',
    customerId: 'cust-1',
    phone: '01012345678',
    payload: {
      customerName: '홍길동',
      serviceName: '속눈썹 펌',
      shopName: '소희 뷰티랩',
      locationText: '서울 강남구 역삼동 123-45',
      bookingStartsAt: '2026-11-07T14:00:00+09:00',
    },
  }

  const validEnv: SolapiEnv = {
    SOLAPI_ENABLED: 'true',
    SOLAPI_API_KEY: 'test-api-key',
    SOLAPI_API_SECRET: 'test-api-secret',
    SOLAPI_PF_ID: 'test-pf-id',
    SOLAPI_BASE_URL: 'https://api.solapi.com',
    SOLAPI_TEMPLATE_IDS: JSON.stringify({
      SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP_CONFIRMED_APPROVED',
      SOHEE_BOOKING_CHANGED_V1: 'KA01TP_CHANGED_APPROVED',
      SOHEE_BOOKING_CANCELLED_V1: 'KA01TP_CANCELLED_APPROVED',
      SOHEE_REMINDER_24H_V1: 'KA01TP_REMINDER_24H_APPROVED',
      SOHEE_REMINDER_2H_V1: 'KA01TP_REMINDER_2H_APPROVED',
      SOHEE_PAYMENT_CONFIRMED_V1: 'KA01TP_PAYMENT_CONFIRMED_APPROVED',
    }),
  }

  const approvedTemplateId = 'KA01TP_CONFIRMED_APPROVED'

  it('adapter disabled이면 외부 네트워크 호출 0건 및 { accepted: false, notSent: true }를 반환한다', async () => {
    const fakeFetch = vi.fn()
    const disabledEnv: SolapiEnv = {
      ...validEnv,
      SOLAPI_ENABLED: 'false',
    }

    const send = createSolapiOutboxSender(disabledEnv, { fetchImpl: fakeFetch })
    const result = await send(sampleSnapshot, sampleJob, approvedTemplateId)

    expect(result).toEqual({ accepted: false, notSent: true })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('잘못된 UUID 형태의 job.id는 throw 대신 { accepted: false, notSent: true }를 반환하고 외부 호출 0건을 유지한다', async () => {
    const fakeFetch = vi.fn()
    const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

    const invalidJob: Job = {
      ...sampleJob,
      id: 'invalid-job-id-not-uuid',
    }

    const result = await send(sampleSnapshot, invalidJob, approvedTemplateId)
    expect(result).toEqual({ accepted: false, notSent: true })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('workspaceId 불일치 시 throw 대신 { accepted: false, notSent: true }를 반환하고 외부 호출 0건을 유지한다', async () => {
    const fakeFetch = vi.fn()
    const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

    const mismatchSnapshot: ReservationSnapshot = {
      ...sampleSnapshot,
      workspaceId: 'other-workspace',
    }

    const result = await send(mismatchSnapshot, sampleJob, approvedTemplateId)
    expect(result).toEqual({ accepted: false, notSent: true })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('reservationId 불일치 시 throw 대신 { accepted: false, notSent: true }를 반환하고 외부 호출 0건을 유지한다', async () => {
    const fakeFetch = vi.fn()
    const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

    const mismatchSnapshot: ReservationSnapshot = {
      ...sampleSnapshot,
      reservationId: 'other-res-id',
    }

    const result = await send(mismatchSnapshot, sampleJob, approvedTemplateId)
    expect(result).toEqual({ accepted: false, notSent: true })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('SOLAPI_TEMPLATE_IDS에 이벤트 코드가 미매핑되어 있으면 throw 대신 { accepted: false, notSent: true }를 반환하고 외부 호출 0건을 유지한다', async () => {
    const fakeFetch = vi.fn()
    const unmappedEnv: SolapiEnv = {
      ...validEnv,
      SOLAPI_TEMPLATE_IDS: JSON.stringify({}),
    }

    const send = createSolapiOutboxSender(unmappedEnv, { fetchImpl: fakeFetch })
    const result = await send(sampleSnapshot, sampleJob, approvedTemplateId)
    expect(result).toEqual({ accepted: false, notSent: true })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('processor의 approved templateId가 env 매핑 값과 불일치하면 throw 대신 { accepted: false, notSent: true }를 반환하고 외부 호출 0건을 유지한다', async () => {
    const fakeFetch = vi.fn()
    const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

    const mismatchedTplId = 'KA01TP_DIFFERENT_UNAPPROVED'
    const result = await send(sampleSnapshot, sampleJob, mismatchedTplId)
    expect(result).toEqual({ accepted: false, notSent: true })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  describe('변수 빌드 및 필수값 누락 검증', () => {
    it('customerName 누락 시 가짜 default(고객님) 사용을 금지하고 throw 대신 { accepted: false, notSent: true }를 반환한다 (외부 호출 0건)', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const noCustomerSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          customerName: undefined,
        },
      }

      const result = await send(noCustomerSnapshot, sampleJob, approvedTemplateId)
      expect(result).toEqual({ accepted: false, notSent: true })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('매장명 또는 서비스명 또는 위치 누락 시 throw 대신 { accepted: false, notSent: true }를 반환한다 (외부 호출 0건)', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const noShopSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          shopName: '',
        },
      }
      expect(await send(noShopSnapshot, sampleJob, approvedTemplateId)).toEqual({
        accepted: false,
        notSent: true,
      })

      const noServiceSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          serviceName: '   ',
        },
      }
      expect(await send(noServiceSnapshot, sampleJob, approvedTemplateId)).toEqual({
        accepted: false,
        notSent: true,
      })

      const noLocationSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          locationText: undefined,
        },
      }
      expect(await send(noLocationSnapshot, sampleJob, approvedTemplateId)).toEqual({
        accepted: false,
        notSent: true,
      })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('BOOKING_CONFIRMED: 결제 안내 미확정 시 금액 있어도 PAID 추정 없이 "결제 확인 전" 명시', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const snapshotWithAmountOnly: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          amount: 50000,
          paymentInfo: undefined, // 미확정
        },
      }

      const res = await send(snapshotWithAmountOnly, sampleJob, approvedTemplateId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{결제안내}']).toBe('결제 확인 전')
    })

    it('BOOKING_CHANGED: previousStartsAt 또는 new date(bookingStartsAt) 없으면 throw 대신 { accepted: false, notSent: true }를 반환한다 (외부 호출 0건)', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const changeJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CHANGED',
      }
      const changeTplId = 'KA01TP_CHANGED_APPROVED'

      // 이전일시 누락
      const noPrevSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: '2026-11-08T15:00:00+09:00',
          previousStartsAt: undefined,
        },
      }
      const res1 = await send(noPrevSnapshot, changeJob, changeTplId)
      expect(res1).toEqual({ accepted: false, notSent: true })

      // 변경일시 누락
      const noNewSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: undefined,
          previousStartsAt: '2026-11-07T14:00:00+09:00',
        },
      }
      const res2 = await send(noNewSnapshot, changeJob, changeTplId)
      expect(res2).toEqual({ accepted: false, notSent: true })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('BOOKING_CHANGED: previousStartsAt와 bookingStartsAt가 trim 비교 시 동일하면 { accepted: false, notSent: true }로 사전 차단한다 (외부 호출 0건)', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const changeJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CHANGED',
      }
      const changeTplId = 'KA01TP_CHANGED_APPROVED'

      const sameDateSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          previousStartsAt: ' 2026-11-07T14:00:00+09:00 ',
          bookingStartsAt: '2026-11-07T14:00:00+09:00',
        },
      }

      const result = await send(sameDateSnapshot, changeJob, changeTplId)
      expect(result).toEqual({ accepted: false, notSent: true })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('BOOKING_CANCELLED: cancelReason 또는 bookingStartsAt 누락 시 throw 대신 { accepted: false, notSent: true }를 반환한다 (외부 호출 0건)', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const cancelJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CANCELLED',
      }
      const cancelTplId = 'KA01TP_CANCELLED_APPROVED'

      // cancelReason 누락
      const noReasonSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        status: 'CANCELLED',
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: '2026-11-07T14:00:00+09:00',
          cancelReason: '   ',
        },
      }
      expect(await send(noReasonSnapshot, cancelJob, cancelTplId)).toEqual({
        accepted: false,
        notSent: true,
      })

      // bookingStartsAt 누락
      const noDateSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        status: 'CANCELLED',
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: undefined,
          cancelReason: '고객 취소 요청',
        },
      }
      expect(await send(noDateSnapshot, cancelJob, cancelTplId)).toEqual({
        accepted: false,
        notSent: true,
      })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('BOOKING_CANCELLED: refund 안내 없으면 "매장에 확인해 주세요" 불확실성 표현 (완료 단정 금지)', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const cancelJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CANCELLED',
      }
      const cancelTplId = 'KA01TP_CANCELLED_APPROVED'

      const cancelSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        status: 'CANCELLED',
        payload: {
          ...sampleSnapshot.payload,
          cancelReason: '고객 일정 변경 요청',
          refundInfo: undefined, // 누락
        },
      }

      const res = await send(cancelSnapshot, cancelJob, cancelTplId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{환불안내}']).toBe('매장에 확인해 주세요')
      expect(variables['#{취소사유}']).toBe('고객 일정 변경 요청')
    })

    it('BOOKING_CANCELLED: payload.requestDeclined가 true인 경우 취소 안내 알림톡을 발송하지 않고 notSent: true를 반환한다 (외부 호출 0건)', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const cancelJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CANCELLED',
      }
      const cancelTplId = 'KA01TP_CANCELLED_APPROVED'

      const declinedSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        status: 'CANCELLED',
        payload: {
          ...sampleSnapshot.payload,
          cancelReason: '시간 마감으로 인한 거절',
          requestDeclined: true,
        },
      }

      const res = await send(declinedSnapshot, cancelJob, cancelTplId)
      expect(res).toEqual({
        accepted: false,
        notSent: true,
      })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('BOOKING_CONFIRMED: paymentInfo 명시적 문자열이 있으면 해당 값을 결제안내로 사용한다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const snapshotWithPaymentInfo: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          paymentInfo: '예약금 10,000원 결제 완료 (현장 잔금 결제)',
        },
      }

      const res = await send(snapshotWithPaymentInfo, sampleJob, approvedTemplateId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{결제안내}']).toBe('예약금 10,000원 결제 완료 (현장 잔금 결제)')
    })

    it('BOOKING_CHANGED: 모든 필수 변수가 정상이면 솔라피에 정상 발송된다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const changeJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CHANGED',
      }
      const changeTplId = 'KA01TP_CHANGED_APPROVED'

      const changeSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          previousStartsAt: '2026-11-07T14:00:00+09:00',
          bookingStartsAt: '2026-11-08T15:00:00+09:00',
        },
      }

      const res = await send(changeSnapshot, changeJob, changeTplId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{이전예약일시}']).toBe('2026년 11월 7일(토) 오후 2:00')
      expect(variables['#{변경예약일시}']).toBe('2026년 11월 8일(일) 오후 3:00')
      expect(variables['#{매장위치}']).toBe('서울 강남구 역삼동 123-45')
    })

    it('BOOKING_CANCELLED: 명시적 refundInfo가 제공되면 해당 값을 사용한다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const cancelJob: Job = {
        ...sampleJob,
        event: 'BOOKING_CANCELLED',
      }
      const cancelTplId = 'KA01TP_CANCELLED_APPROVED'

      const cancelSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        status: 'CANCELLED',
        payload: {
          ...sampleSnapshot.payload,
          cancelReason: '매장 사정',
          refundInfo: '전액 환불 완료 (영업일 기준 2~3일 소요)',
        },
      }

      const res = await send(cancelSnapshot, cancelJob, cancelTplId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{환불안내}']).toBe('전액 환불 완료 (영업일 기준 2~3일 소요)')
      expect(variables['#{취소사유}']).toBe('매장 사정')
    })

    it('REMINDER_24H: 안내시점 "내일", 예약일시, 매장위치가 템플릿 변수에 정상 매핑되어 전송된다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const reminderJob: Job = {
        ...sampleJob,
        event: 'REMINDER_24H',
      }
      const reminderTplId = 'KA01TP_REMINDER_24H_APPROVED'

      const res = await send(sampleSnapshot, reminderJob, reminderTplId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{안내시점}']).toBe('내일')
      expect(variables['#{예약일시}']).toBe('2026년 11월 7일(토) 오후 2:00')
      expect(variables['#{매장명}']).toBe('소희 뷰티랩')
      expect(variables['#{고객명}']).toBe('홍길동')
      expect(variables['#{서비스명}']).toBe('속눈썹 펌')
      expect(variables['#{매장위치}']).toBe('서울 강남구 역삼동 123-45')
    })

    it('REMINDER_2H: 안내시점 "2시간 뒤", 예약일시, 매장위치가 템플릿 변수에 정상 매핑되어 전송된다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const reminderJob: Job = {
        ...sampleJob,
        event: 'REMINDER_2H',
      }
      const reminderTplId = 'KA01TP_REMINDER_2H_APPROVED'

      const res = await send(sampleSnapshot, reminderJob, reminderTplId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{안내시점}']).toBe('2시간 뒤')
      expect(variables['#{예약일시}']).toBe('2026년 11월 7일(토) 오후 2:00')
      expect(variables['#{매장명}']).toBe('소희 뷰티랩')
      expect(variables['#{고객명}']).toBe('홍길동')
      expect(variables['#{서비스명}']).toBe('속눈썹 펌')
      expect(variables['#{매장위치}']).toBe('서울 강남구 역삼동 123-45')
    })

    it('REMINDER_24H 및 REMINDER_2H: bookingStartsAt 또는 locationText 누락 시 차단된다', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const r24Job: Job = { ...sampleJob, event: 'REMINDER_24H' }
      const r2Job: Job = { ...sampleJob, event: 'REMINDER_2H' }

      // bookingStartsAt 누락
      const noDateSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: undefined,
        },
      }
      expect(await send(noDateSnapshot, r24Job, 'KA01TP_REMINDER_24H_APPROVED')).toEqual({
        accepted: false,
        notSent: true,
      })

      // locationText 누락
      const noLocationSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          locationText: '',
        },
      }
      expect(await send(noLocationSnapshot, r2Job, 'KA01TP_REMINDER_2H_APPROVED')).toEqual({
        accepted: false,
        notSent: true,
      })

      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('예약일시 포맷이 잘못되어 KST 변환 실패(null) 시 notSent: true 로 사전 차단하고 원문을 노출하지 않는다', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      // 1. BOOKING_CONFIRMED: 오프셋 없는 일시
      const invalidConfirmed: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: '2026-11-09 15:16:00', // no offset
        },
      }
      expect(await send(invalidConfirmed, sampleJob, approvedTemplateId)).toEqual({
        accepted: false,
        notSent: true,
      })

      // 2. BOOKING_CHANGED: 유효하지 않은 일시
      const changeJob: Job = { ...sampleJob, event: 'BOOKING_CHANGED' }
      const invalidChanged: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          previousStartsAt: '2026-11-07T14:00:00+09:00',
          bookingStartsAt: 'invalid-iso-date',
        },
      }
      expect(
        await send(invalidChanged, changeJob, 'KA01TP_CHANGED_APPROVED'),
      ).toEqual({
        accepted: false,
        notSent: true,
      })

      // 3. BOOKING_CANCELLED: 잘못된 일시
      const cancelJob: Job = { ...sampleJob, event: 'BOOKING_CANCELLED' }
      const invalidCancelled: ReservationSnapshot = {
        ...sampleSnapshot,
        status: 'CANCELLED',
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: '2026-02-30T14:00:00Z',
          cancelReason: '취소',
        },
      }
      expect(
        await send(invalidCancelled, cancelJob, 'KA01TP_CANCELLED_APPROVED'),
      ).toEqual({
        accepted: false,
        notSent: true,
      })

      // 4. REMINDER_24H: 잘못된 일시
      const reminderJob: Job = { ...sampleJob, event: 'REMINDER_24H' }
      const invalidReminder: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: 'not-a-date',
        },
      }
      expect(
        await send(invalidReminder, reminderJob, 'KA01TP_REMINDER_24H_APPROVED'),
      ).toEqual({
        accepted: false,
        notSent: true,
      })

      expect(fakeFetch).not.toHaveBeenCalled()
    })

    it('BOOKING_CONFIRMED: Z 타임존(UTC) 날짜를 KST로 정확히 변환하여 예약일시 템플릿 변수에 넣는다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const utcSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          bookingStartsAt: '2026-11-09T06:16:37Z', // KST 15:16
        },
      }

      const res = await send(utcSnapshot, sampleJob, approvedTemplateId)
      expect(res.accepted).toBe(true)

      const parsed = JSON.parse(capturedBody || '{}')
      const variables = parsed.messages[0].kakaoOptions.variables
      expect(variables['#{예약일시}']).toBe('2026년 11월 9일(월) 오후 3:16')
    })
  })

  describe('정상 발송 및 페이로드 / 멱등키 / 보안 규약 검증', () => {
    it('idempotencyKey는 "kakao-outbox:" + job.id 규약을 사용하며 솔라피 payload에 정확히 반영된다', async () => {
      let capturedBody: string | undefined
      const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = opts?.body as string
        return {
          ok: true,
          json: async () => ({
            messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
          }),
        }
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const result = await send(sampleSnapshot, sampleJob, approvedTemplateId)

      expect(result).toEqual({ accepted: true })
      expect(fakeFetch).toHaveBeenCalledTimes(1)

      const parsed = JSON.parse(capturedBody || '{}')
      const message = parsed.messages[0]

      expect(message.customFields?.idempotencyKey).toBe(`kakao-outbox:${validJobId}`)
      expect(message.kakaoOptions?.templateId).toBe('KA01TP_CONFIRMED_APPROVED')
      expect(message.to).toBe('01012345678')
      expect(message.country).toBe('82')
      expect(message.kakaoOptions?.variables['#{고객명}']).toBe('홍길동')
      expect(message.kakaoOptions?.variables['#{서비스명}']).toBe('속눈썹 펌')
    })

    it('솔라피 실패 응답(status != SENT 또는 failedMessageList) 시 accepted: false 및 failureCode 반환', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          failedMessageList: [{ statusCode: '3008', reason: '전화번호 형식 오류' }],
        }),
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
      const result = await send(sampleSnapshot, sampleJob, approvedTemplateId)

      expect(result).toEqual({ accepted: false, failureCode: 'SOLAPI_3008' })
    })

    it('에러 및 리턴 객체에 전화번호, 본문, 프로바이더 텍스트 노출이 일절 없다', async () => {
      const fakeFetch = vi.fn().mockRejectedValue(
        new Error('Network error with phone 01012345678 and body [소희 뷰티랩] and secret xyz')
      )

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      try {
        const res = await send(sampleSnapshot, sampleJob, approvedTemplateId)
        // accepted: false를 반환하거나 에러를 throw하더라도 PII가 없어야 함
        expect(res).toEqual({ accepted: false, failureCode: 'NETWORK_EXCEPTION' })
      } catch (err: unknown) {
        const msg = String((err as Error).message)
        expect(msg).not.toContain('01012345678')
        expect(msg).not.toContain('소희 뷰티랩')
        expect(msg).not.toContain('xyz')
      }
    })

    it('OutboxProcessor와 함께 실행 시 사전검증 실패는 BLOCKED (SEND_PRECHECK_FAILED)로 종결되고 외부 호출은 0건이다', async () => {
      const { processNotificationJob, OUTBOX_REASON } = await import('./outbox-processor')
      const fakeFetch = vi.fn()

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const mockStore = {
        claim: vi.fn().mockResolvedValue('lease-token-1'),
        markSending: vi.fn().mockResolvedValue(true),
        finish: vi.fn().mockResolvedValue(true),
      }

      // customerName이 누락된 스냅샷
      const invalidSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        payload: {
          ...sampleSnapshot.payload,
          customerName: '',
        },
      }

      const mockRepo = {
        getCurrentReservation: vi.fn().mockResolvedValue(invalidSnapshot),
        getInformationalEvidence: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: invalidSnapshot.phone,
          workspaceId: invalidSnapshot.workspaceId,
          reservationId: invalidSnapshot.reservationId,
        }),
        getTemplateApproval: vi.fn().mockResolvedValue({
          approved: true,
          templateId: approvedTemplateId,
        }),
      }

      const outcome = await processNotificationJob(sampleJob, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: mockRepo,
        store: mockStore,
        send,
      })

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SEND_PRECHECK_FAILED)
      expect(fakeFetch).not.toHaveBeenCalled()
      expect(mockStore.finish).toHaveBeenCalledWith(
        sampleJob.id,
        'lease-token-1',
        'BLOCKED',
        OUTBOX_REASON.SEND_PRECHECK_FAILED,
      )
    })

    it('OutboxProcessor와 함께 실행 시 어댑터 호출 후 rejected 실패는 UNKNOWN (SEND_REJECTED)으로 종결된다', async () => {
      const { processNotificationJob } = await import('./outbox-processor')
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          failedMessageList: [{ statusCode: '3008', reason: '전화번호 형식 오류' }],
        }),
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const mockStore = {
        claim: vi.fn().mockResolvedValue('lease-token-1'),
        markSending: vi.fn().mockResolvedValue(true),
        finish: vi.fn().mockResolvedValue(true),
      }

      const mockRepo = {
        getCurrentReservation: vi.fn().mockResolvedValue(sampleSnapshot),
        getInformationalEvidence: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: sampleSnapshot.phone,
          workspaceId: sampleSnapshot.workspaceId,
          reservationId: sampleSnapshot.reservationId,
        }),
        getTemplateApproval: vi.fn().mockResolvedValue({
          approved: true,
          templateId: approvedTemplateId,
        }),
      }

      const outcome = await processNotificationJob(sampleJob, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: mockRepo,
        store: mockStore,
        send,
      })

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe('SEND_REJECTED_SOLAPI_3008')
      expect(fakeFetch).toHaveBeenCalledTimes(1)
      expect(mockStore.finish).toHaveBeenCalledWith(
        sampleJob.id,
        'lease-token-1',
        'UNKNOWN',
        'SEND_REJECTED_SOLAPI_3008',
      )
    })

    it('OutboxProcessor와 함께 실행 시 HTTP 401 오류는 SEND_REJECTED_HTTP_401_INVALID_API_KEY 로 종결된다', async () => {
      const { processNotificationJob } = await import('./outbox-processor')
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({ errorCode: 'InvalidApiKey', message: 'secret=my-secret' }),
      })

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const mockStore = {
        claim: vi.fn().mockResolvedValue('lease-token-1'),
        markSending: vi.fn().mockResolvedValue(true),
        finish: vi.fn().mockResolvedValue(true),
      }

      const mockRepo = {
        getCurrentReservation: vi.fn().mockResolvedValue(sampleSnapshot),
        getInformationalEvidence: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: sampleSnapshot.phone,
          workspaceId: sampleSnapshot.workspaceId,
          reservationId: sampleSnapshot.reservationId,
        }),
        getTemplateApproval: vi.fn().mockResolvedValue({
          approved: true,
          templateId: approvedTemplateId,
        }),
      }

      const outcome = await processNotificationJob(sampleJob, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: mockRepo,
        store: mockStore,
        send,
      })

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe('SEND_REJECTED_HTTP_401_INVALID_API_KEY')
      expect(outcome.reasonCode).not.toContain('my-secret')
      expect(outcome.reasonCode).toMatch(/^[A-Z0-9_]{1,64}$/)
      expect(mockStore.finish).toHaveBeenCalledWith(
        sampleJob.id,
        'lease-token-1',
        'UNKNOWN',
        'SEND_REJECTED_HTTP_401_INVALID_API_KEY',
      )
    })

    it('로컬 번호 거부(유선번호)는 SEND_REJECTED_LOCAL_PHONE failureCode를 반환한다', async () => {
      const fakeFetch = vi.fn()
      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const landlineSnapshot: ReservationSnapshot = {
        ...sampleSnapshot,
        phone: '02-1234-5678',
      }
      const sendResult = await send(landlineSnapshot, sampleJob, approvedTemplateId)
      expect(sendResult).toEqual({ accepted: false, failureCode: 'LOCAL_PHONE' })
      expect(fakeFetch).not.toHaveBeenCalled()
    })

    describe('PAYMENT_CONFIRMED 결제 완료 안내 템플릿 검증', () => {
      const paymentJob: Job = {
        ...sampleJob,
        event: 'PAYMENT_CONFIRMED',
      }
      const paymentTplId = 'KA01TP_PAYMENT_CONFIRMED_APPROVED'

      it('정상 발송 시 매장명, 고객명, 서비스명, 예약일시, 결제금액(천단위 콤마)이 정확히 매핑된다', async () => {
        let capturedBody: string | undefined
        const fakeFetch = vi.fn().mockImplementation(async (_url, opts) => {
          capturedBody = opts?.body as string
          return {
            ok: true,
            json: async () => ({
              messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
            }),
          }
        })

        const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })
        const paymentSnapshot: ReservationSnapshot = {
          ...sampleSnapshot,
          payload: {
            ...sampleSnapshot.payload,
            bookingStartsAt: '2026-11-10T14:00:00+09:00',
            paymentAmountKrw: 50000,
          },
        }

        const res = await send(paymentSnapshot, paymentJob, paymentTplId)
        expect(res.accepted).toBe(true)

        const parsed = JSON.parse(capturedBody || '{}')
        const variables = parsed.messages[0].kakaoOptions.variables
        expect(variables['#{매장명}']).toBe('소희 뷰티랩')
        expect(variables['#{고객명}']).toBe('홍길동')
        expect(variables['#{서비스명}']).toBe('속눈썹 펌')
        expect(variables['#{예약일시}']).toBe('2026년 11월 10일(화) 오후 2:00')
        expect(variables['#{결제금액}']).toBe('50,000원')
      })

      it('결제금액(paymentAmountKrw)이 없거나 0 이하이면 notSent: true 로 차단하고 외부 호출 0건을 유지한다', async () => {
        const fakeFetch = vi.fn()
        const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

        // 1. undefined (누락)
        const noAmountSnapshot: ReservationSnapshot = {
          ...sampleSnapshot,
          payload: {
            ...sampleSnapshot.payload,
            bookingStartsAt: '2026-11-10T14:00:00+09:00',
            paymentAmountKrw: undefined,
          },
        }
        expect(await send(noAmountSnapshot, paymentJob, paymentTplId)).toEqual({
          accepted: false,
          notSent: true,
        })

        // 2. 0원
        const zeroAmountSnapshot: ReservationSnapshot = {
          ...sampleSnapshot,
          payload: {
            ...sampleSnapshot.payload,
            bookingStartsAt: '2026-11-10T14:00:00+09:00',
            paymentAmountKrw: 0,
          },
        }
        expect(await send(zeroAmountSnapshot, paymentJob, paymentTplId)).toEqual({
          accepted: false,
          notSent: true,
        })

        // 3. 음수 금액
        const negativeAmountSnapshot: ReservationSnapshot = {
          ...sampleSnapshot,
          payload: {
            ...sampleSnapshot.payload,
            bookingStartsAt: '2026-11-10T14:00:00+09:00',
            paymentAmountKrw: -10000,
          },
        }
        expect(await send(negativeAmountSnapshot, paymentJob, paymentTplId)).toEqual({
          accepted: false,
          notSent: true,
        })

        expect(fakeFetch).not.toHaveBeenCalled()
      })

      it('bookingStartsAt 누락 또는 포맷 실패 시 notSent: true 로 차단된다', async () => {
        const fakeFetch = vi.fn()
        const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

        const noDateSnapshot: ReservationSnapshot = {
          ...sampleSnapshot,
          payload: {
            ...sampleSnapshot.payload,
            paymentAmountKrw: 30000,
            bookingStartsAt: undefined,
          },
        }
        expect(await send(noDateSnapshot, paymentJob, paymentTplId)).toEqual({
          accepted: false,
          notSent: true,
        })

        const invalidDateSnapshot: ReservationSnapshot = {
          ...sampleSnapshot,
          payload: {
            ...sampleSnapshot.payload,
            paymentAmountKrw: 30000,
            bookingStartsAt: 'not-a-date',
          },
        }
        expect(await send(invalidDateSnapshot, paymentJob, paymentTplId)).toEqual({
          accepted: false,
          notSent: true,
        })

        expect(fakeFetch).not.toHaveBeenCalled()
      })
    })

    it('OutboxProcessor와 함께 실행 시 processNotificationJob이 SENT_SUCCESS로 종결된다', async () => {
      const { processNotificationJob, OUTBOX_REASON } = await import('./outbox-processor')
      const fakeFetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          messageList: { msg1: { messageId: 'm1', status: 'COMPLETE' } },
        }),
      }))

      const send = createSolapiOutboxSender(validEnv, { fetchImpl: fakeFetch })

      const mockStore = {
        claim: vi.fn().mockResolvedValue('lease-token-1'),
        markSending: vi.fn().mockResolvedValue(true),
        finish: vi.fn().mockResolvedValue(true),
      }

      const mockRepo = {
        getCurrentReservation: vi.fn().mockResolvedValue(sampleSnapshot),
        getInformationalEvidence: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: sampleSnapshot.phone,
          workspaceId: sampleSnapshot.workspaceId,
          reservationId: sampleSnapshot.reservationId,
        }),
        getTemplateApproval: vi.fn().mockResolvedValue({
          approved: true,
          templateId: approvedTemplateId,
        }),
      }

      const outcome = await processNotificationJob(sampleJob, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: mockRepo,
        store: mockStore,
        send,
      })

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      expect(fakeFetch).toHaveBeenCalledTimes(1)
    })
  })
})
