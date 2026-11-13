import { describe, expect, it } from 'vitest'
import {
  containsAdvertisingContent,
  validateTemplateVariables,
} from './alimtalk-contract'
import {
  mapBookingEventToNotifications,
  type BookingCancelledEvent,
  type BookingChangedEvent,
  type BookingConfirmedEvent,
  type PaymentConfirmedEvent,
  type Reminder24hEvent,
  type Reminder2hEvent,
} from './booking-notification-mapper'
import {
  ALIMTALK_TEMPLATE_CODES,
  ALIMTALK_TEMPLATES,
  ALIMTALK_TEMPLATE_LIST,
  getAlimtalkTemplate,
  SOHEE_BOOKING_CANCELLED,
  SOHEE_BOOKING_CHANGED,
  SOHEE_BOOKING_CONFIRMED,
  SOHEE_PAYMENT_CONFIRMED,
  SOHEE_REMINDER_24H,
  SOHEE_REMINDER_2H,
  ALIMTALK_EXTRA_INFO,
  extraInfo,
  type AlimtalkTemplate,
} from './templates'

describe('KAPI-05/12 알림톡 템플릿 카탈로그 (templates.ts)', () => {
  const EMOJI_REGEX = /\p{Extended_Pictographic}/u

  describe('1. 템플릿 코드 상수 및 목록 구성', () => {
    it('정확히 6종의 정보성 템플릿 코드를 정의한다', () => {
      expect(Object.keys(ALIMTALK_TEMPLATE_CODES)).toEqual([
        'BOOKING_CONFIRMED',
        'BOOKING_CHANGED',
        'BOOKING_CANCELLED',
        'PAYMENT_CONFIRMED',
        'REMINDER_24H',
        'REMINDER_2H',
      ])
      expect(ALIMTALK_TEMPLATE_LIST).toHaveLength(6)
    })

    it('개별 export 상수가 ALIMTALK_TEMPLATE_CODES 값과 일치한다', () => {
      expect(SOHEE_BOOKING_CONFIRMED).toBe(ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED)
      expect(SOHEE_BOOKING_CHANGED).toBe(ALIMTALK_TEMPLATE_CODES.BOOKING_CHANGED)
      expect(SOHEE_BOOKING_CANCELLED).toBe(ALIMTALK_TEMPLATE_CODES.BOOKING_CANCELLED)
      expect(SOHEE_PAYMENT_CONFIRMED).toBe(ALIMTALK_TEMPLATE_CODES.PAYMENT_CONFIRMED)
      expect(SOHEE_REMINDER_24H).toBe(ALIMTALK_TEMPLATE_CODES.REMINDER_24H)
      expect(SOHEE_REMINDER_2H).toBe(ALIMTALK_TEMPLATE_CODES.REMINDER_2H)
    })

    it('템플릿 코드는 _V1 접미사를 포함하여 정의된다', () => {
      for (const tmpl of ALIMTALK_TEMPLATE_LIST) {
        expect(tmpl.code).toMatch(/^SOHEE_[A-Z0-9_]+_V1$/)
      }
    })

    it('getAlimtalkTemplate 헬퍼가 코드로 템플릿을 올바르게 조회한다', () => {
      const found = getAlimtalkTemplate(ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED)
      expect(found).toBeDefined()
      expect(found?.name).toBe('예약 확정 안내')

      expect(getAlimtalkTemplate('NON_EXISTENT_CODE')).toBeUndefined()
    })
  })

  describe('2. 카카오 알림톡 심사 규격 준수 검증 (길이, 이모지, 광고성 배제, 버튼)', () => {
    it.each(ALIMTALK_TEMPLATE_LIST)('$name ($code) 규격 준수 검증', (tmpl: AlimtalkTemplate) => {
      // 1. 글자 수 1,000자 이내
      expect(tmpl.templateBody.length).toBeLessThanOrEqual(1000)
      expect(tmpl.templateBody.length).toBeGreaterThan(30)

      // 2. 광고성 문구 철저 배제
      expect(containsAdvertisingContent(tmpl.templateBody)).toBe(false)
      const forbiddenAdWords = [
        '광고',
        '(광고)',
        '[광고]',
        '할인쿠폰',
        '특가',
        '이벤트할인',
        '무료수신거부',
        '세일',
        '프로모션',
      ]
      for (const word of forbiddenAdWords) {
        expect(tmpl.templateBody).not.toContain(word)
      }

      // 3. 유니코드 이모지 배제 (카카오 심사 기준 특수문자 ■, - 는 허용, 그림문자 이모지 금지)
      expect(EMOJI_REGEX.test(tmpl.templateBody)).toBe(false)

      // 4. 버튼 규격 검증 (버튼 0개: 링크 도메인 고정 요구 및 미실존 페이지 배제를 위해 버튼 제거)
      expect(tmpl.buttons).toHaveLength(0)

      // 5. 본문 및 변수에서 예약패스링크 및 예약 정보 확인 제거 검증
      expect(tmpl.templateBody).not.toContain('예약패스링크')
      expect(tmpl.templateBody).not.toContain('■ 예약 정보 확인')
      expect(tmpl.variables).not.toContain('예약패스링크')

      // 6. 메시지 유형은 기본형 'BA'
      expect(tmpl.messageType).toBe('BA')
    })
  })

  describe('3. 템플릿 변수 정합성 및 validateTemplateVariables 검증', () => {
    const sampleVariablesByCode: Record<string, Record<string, string>> = {
      [ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED]: {
        매장명: '바이름 헤어 청라점',
        고객명: '홍길동',
        서비스명: '헤어 컷 & 스타일링',
        예약일시: '2026-11-07 14:00',
        매장위치: '인천 서구 청라라임로 123',
        결제안내: '예약금 30,000원 결제 완료',
      },
      [ALIMTALK_TEMPLATE_CODES.BOOKING_CHANGED]: {
        매장명: '바이름 헤어 청라점',
        고객명: '홍길동',
        서비스명: '헤어 컷 & 스타일링',
        이전예약일시: '2026-11-07 14:00',
        변경예약일시: '2026-11-08 16:00',
        매장위치: '인천 서구 청라라임로 123',
      },
      [ALIMTALK_TEMPLATE_CODES.BOOKING_CANCELLED]: {
        매장명: '바이름 헤어 청라점',
        고객명: '홍길동',
        서비스명: '헤어 컷 & 스타일링',
        예약일시: '2026-11-07 14:00',
        취소사유: '고객 개인 사정',
        환불안내: '예약금 30,000원 환불 절차 진행',
      },
      [ALIMTALK_TEMPLATE_CODES.PAYMENT_CONFIRMED]: {
        매장명: '바이름 헤어 청라점',
        고객명: '홍길동',
        서비스명: '헤어 컷 & 스타일링',
        예약일시: '2026-11-07 14:00',
        결제금액: '30,000원',
      },
      [ALIMTALK_TEMPLATE_CODES.REMINDER_24H]: {
        매장명: '바이름 헤어 청라점',
        고객명: '홍길동',
        안내시점: '내일',
        서비스명: '헤어 컷 & 스타일링',
        예약일시: '2026-11-07 14:00',
        매장위치: '인천 서구 청라라임로 123',
      },
      [ALIMTALK_TEMPLATE_CODES.REMINDER_2H]: {
        매장명: '바이름 헤어 청라점',
        고객명: '홍길동',
        안내시점: '곧 (2시간 전)',
        서비스명: '헤어 컷 & 스타일링',
        예약일시: '2026-11-07 14:00',
        매장위치: '인천 서구 청라라임로 123',
      },
    }

    it('각 템플릿의 variables 메타데이터가 본문의 #{변수} 추출 목록과 일치한다', () => {
      for (const tmpl of ALIMTALK_TEMPLATE_LIST) {
        const matches = tmpl.templateBody.match(/#\{([^}]+)\}/g) || []
        const extractedVars = Array.from(new Set(matches.map((m) => m.slice(2, -1).trim())))
        expect(tmpl.variables).toEqual(extractedVars)
      }
    })

    it('샘플 변수 주입 시 모든 템플릿이 validateTemplateVariables 를 통과한다', () => {
      for (const tmpl of ALIMTALK_TEMPLATE_LIST) {
        const sampleVars = sampleVariablesByCode[tmpl.code]
        expect(sampleVars).toBeDefined()

        const result = validateTemplateVariables(tmpl.templateBody, sampleVars)
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
        expect(result.missing).toHaveLength(0)
        expect(result.unused).toHaveLength(0)
        expect(result.resolvedText).toBeDefined()
        expect(result.resolvedText).not.toContain('#{')
      }
    })

    it('필수 변수가 누락되거나 빈 문자열일 경우 validateTemplateVariables 가 실패한다', () => {
      const confirmedTmpl = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED
      const incompleteVars = {
        고객명: '홍길동',
        // 매장명, 서비스명 등 누락
      }
      const res = validateTemplateVariables(confirmedTmpl.templateBody, incompleteVars)
      expect(res.valid).toBe(false)
      expect(res.missing).toContain('매장명')
      expect(res.errors.length).toBeGreaterThan(0)
    })
  })

  describe('4. booking-notification-mapper 교차 검증 (Cross-Validation) 및 불일치 점검', () => {
    const baseDeps = {
      passTokenSecret: 'test-pass-secret-key-must-be-long-enough-32bytes',
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

    it('예약 확정 (BOOKING_CONFIRMED) 템플릿 코드 및 본문이 mapper 결과와 일치한다', async () => {
      const event: BookingConfirmedEvent = {
        ...baseEvent,
        type: 'BOOKING_CONFIRMED',
        payment: { status: 'CONFIRMED', amountKrw: 30000, paidAt: '2026-11-06 09:30' },
      }
      const mapping = await mapBookingEventToNotifications(event, baseDeps)

      expect(mapping.customerAlimtalk.templateCode).toBe(
        ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED,
      )
      const tmpl = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED
      expect(mapping.customerAlimtalk.templateBody).toBe(tmpl.templateBody)

      // mapper 생성 변수로 validateTemplateVariables 통과
      const valRes = validateTemplateVariables(
        tmpl.templateBody,
        mapping.customerAlimtalk.variables,
      )
      expect(valRes.valid).toBe(true)
    })

    it('예약 변경 (BOOKING_CHANGED) 템플릿 코드 및 본문이 mapper 결과와 일치한다', async () => {
      const event: BookingChangedEvent = {
        ...baseEvent,
        type: 'BOOKING_CHANGED',
        previousStartsAt: '2026-11-07 14:00',
        newStartsAt: '2026-11-08 16:00',
      }
      const mapping = await mapBookingEventToNotifications(event, baseDeps)

      expect(mapping.customerAlimtalk.templateCode).toBe(
        ALIMTALK_TEMPLATE_CODES.BOOKING_CHANGED,
      )
      const tmpl = ALIMTALK_TEMPLATES.BOOKING_CHANGED
      expect(mapping.customerAlimtalk.templateBody).toBe(tmpl.templateBody)

      const valRes = validateTemplateVariables(
        tmpl.templateBody,
        mapping.customerAlimtalk.variables,
      )
      expect(valRes.valid).toBe(true)
    })

    it('결제 완료 (PAYMENT_CONFIRMED) 템플릿 코드 및 본문이 mapper 결과와 일치한다', async () => {
      const event: PaymentConfirmedEvent = {
        ...baseEvent,
        type: 'PAYMENT_CONFIRMED',
        payment: { status: 'CONFIRMED', amountKrw: 30000, paidAt: '2026-11-06 11:20' },
      }
      const mapping = await mapBookingEventToNotifications(event, baseDeps)

      expect(mapping.customerAlimtalk.templateCode).toBe(
        ALIMTALK_TEMPLATE_CODES.PAYMENT_CONFIRMED,
      )
      const tmpl = ALIMTALK_TEMPLATES.PAYMENT_CONFIRMED
      expect(mapping.customerAlimtalk.templateBody).toBe(tmpl.templateBody)

      const valRes = validateTemplateVariables(
        tmpl.templateBody,
        mapping.customerAlimtalk.variables,
      )
      expect(valRes.valid).toBe(true)
    })

    it('리마인더 24H (REMINDER_24H) 템플릿 코드 및 본문이 mapper 결과와 일치한다', async () => {
      const event: Reminder24hEvent = {
        ...baseEvent,
        type: 'REMINDER_24H',
      }
      const mapping = await mapBookingEventToNotifications(event, baseDeps)

      expect(mapping.customerAlimtalk.templateCode).toBe(
        ALIMTALK_TEMPLATE_CODES.REMINDER_24H,
      )
      const tmpl = ALIMTALK_TEMPLATES.REMINDER_24H
      expect(mapping.customerAlimtalk.templateBody).toBe(tmpl.templateBody)

      const valRes = validateTemplateVariables(
        tmpl.templateBody,
        mapping.customerAlimtalk.variables,
      )
      expect(valRes.valid).toBe(true)
    })

    it('리마인더 2H (REMINDER_2H) 템플릿 코드 및 본문이 mapper 결과와 일치한다', async () => {
      const event: Reminder2hEvent = {
        ...baseEvent,
        type: 'REMINDER_2H',
      }
      const mapping = await mapBookingEventToNotifications(event, baseDeps)

      expect(mapping.customerAlimtalk.templateCode).toBe(
        ALIMTALK_TEMPLATE_CODES.REMINDER_2H,
      )
      const tmpl = ALIMTALK_TEMPLATES.REMINDER_2H
      expect(mapping.customerAlimtalk.templateBody).toBe(tmpl.templateBody)

      const valRes = validateTemplateVariables(
        tmpl.templateBody,
        mapping.customerAlimtalk.variables,
      )
      expect(valRes.valid).toBe(true)
    })

    it('예약 취소 (BOOKING_CANCELLED) 템플릿 코드 및 본문 일치 및 [불일치 점검]', async () => {
      const event: BookingCancelledEvent = {
        ...baseEvent,
        type: 'BOOKING_CANCELLED',
        cancelReason: '고객 요청',
        payment: { status: 'CONFIRMED', amountKrw: 30000 },
      }
      const mapping = await mapBookingEventToNotifications(event, baseDeps)

      expect(mapping.customerAlimtalk.templateCode).toBe(
        ALIMTALK_TEMPLATE_CODES.BOOKING_CANCELLED,
      )
      const tmpl = ALIMTALK_TEMPLATES.BOOKING_CANCELLED
      expect(mapping.customerAlimtalk.templateBody).toBe(tmpl.templateBody)

      // 본문 자체는 mapper의 변수로 validate 통과
      const valRes = validateTemplateVariables(
        tmpl.templateBody,
        mapping.customerAlimtalk.variables,
      )
      expect(valRes.valid).toBe(true)

      // 버튼이 제거되어 0개이고 변수 목록에도 예약패스링크 없음
      expect(tmpl.buttons).toHaveLength(0)
      expect(mapping.customerAlimtalk.variables['예약패스링크']).toBeUndefined()

      // [불일치 점검 2] 요구사항의 예시 변수 #{예약번호}는 mapper 변수 목록에 구현되어 있지 않음 (bookingId 미주입)
      expect(mapping.customerAlimtalk.variables['예약번호']).toBeUndefined()
    })
  })

  describe('5. 카카오 승인(수정 불가) 본문 정본 문자 단위 일치 및 부가정보(extraInfo) 검증', () => {
    const KAKAO_APPROVED_BODIES = {
      BOOKING_CONFIRMED:
        '[#{매장명}] 예약 확정 안내\n\n안녕하세요, #{고객명}님!\n예약이 정상적으로 확정되었습니다.\n\n■ 예약 상세\n- 서비스: #{서비스명}\n- 예약일시: #{예약일시}\n- 장소: #{매장위치}\n- 결제상태: #{결제안내}',
      BOOKING_CHANGED:
        '[#{매장명}] 예약 변경 안내\n\n안녕하세요, #{고객명}님!\n예약 일정이 아래와 같이 변경되었습니다.\n\n■ 변경 상세\n- 서비스: #{서비스명}\n- 이전일시: #{이전예약일시}\n- 변경일시: #{변경예약일시}\n- 장소: #{매장위치}',
      BOOKING_CANCELLED:
        '[#{매장명}] 예약 취소 안내\n\n안녕하세요, #{고객명}님!\n예약이 정상적으로 취소 처리되었습니다.\n\n■ 취소 상세\n- 서비스: #{서비스명}\n- 기존일시: #{예약일시}\n- 취소사유: #{취소사유}\n- 환불안내: #{환불안내}\n\n이용해 주셔서 감사합니다.',
      PAYMENT_CONFIRMED:
        '[#{매장명}] 결제 완료 안내\n\n안녕하세요, #{고객명}님!\n예약금 결제가 정상적으로 확인되었습니다.\n\n■ 결제 상세\n- 서비스: #{서비스명}\n- 예약일시: #{예약일시}\n- 결제금액: #{결제금액}',
      REMINDER_24H:
        '[#{매장명}] 방문 일정 리마인더\n\n안녕하세요, #{고객명}님!\n#{안내시점} 방문 예정인 예약 일정을 안내해 드립니다.\n\n■ 예약 상세\n- 서비스: #{서비스명}\n- 방문일시: #{예약일시}\n- 장소: #{매장위치}',
      REMINDER_2H:
        '[#{매장명}] 방문 일정 리마인더\n\n안녕하세요, #{고객명}님!\n#{안내시점} 방문 예정인 예약 일정을 안내해 드립니다.\n\n■ 예약 상세\n- 서비스: #{서비스명}\n- 방문일시: #{예약일시}\n- 장소: #{매장위치}',
    } as const

    const EXPECTED_EXTRA_INFO =
      '예약을 완료한 고객 본인에게만 발송하는 정보성 안내 메시지입니다. 광고·프로모션 내용은 포함하지 않습니다.'

    it('카카오 승인 부가정보 문구 상수(ALIMTALK_EXTRA_INFO, extraInfo)가 올바르게 정의되어 있다', () => {
      expect(ALIMTALK_EXTRA_INFO).toBe(EXPECTED_EXTRA_INFO)
      expect(extraInfo).toBe(EXPECTED_EXTRA_INFO)
    })

    it('6종 템플릿의 templateBody가 카카오 승인 본문과 문자 단위(공백, 줄바꿈 포함)로 정확히 일치한다', () => {
      for (const [key, approvedBody] of Object.entries(KAKAO_APPROVED_BODIES)) {
        const tmpl = ALIMTALK_TEMPLATES[key as keyof typeof ALIMTALK_TEMPLATES]
        expect(tmpl).toBeDefined()
        expect(tmpl.templateBody).toBe(approvedBody)
      }
    })

    it('BOOKING_CHANGED 및 BOOKING_CANCELLED 템플릿에 extraInfo가 기록되어 있다', () => {
      expect(ALIMTALK_TEMPLATES.BOOKING_CHANGED.extraInfo).toBe(EXPECTED_EXTRA_INFO)
      expect(ALIMTALK_TEMPLATES.BOOKING_CANCELLED.extraInfo).toBe(EXPECTED_EXTRA_INFO)

      expect(ALIMTALK_TEMPLATES.BOOKING_CONFIRMED.extraInfo).toBeUndefined()
      expect(ALIMTALK_TEMPLATES.PAYMENT_CONFIRMED.extraInfo).toBeUndefined()
      expect(ALIMTALK_TEMPLATES.REMINDER_24H.extraInfo).toBeUndefined()
      expect(ALIMTALK_TEMPLATES.REMINDER_2H.extraInfo).toBeUndefined()
    })

    it('outbox-sender.ts가 사용하는 필수 변수가 템플릿의 variables와 완벽히 호환된다', () => {
      // 1. BOOKING_CONFIRMED 변수
      const confirmedVars = ['매장명', '고객명', '서비스명', '예약일시', '매장위치', '결제안내']
      expect(ALIMTALK_TEMPLATES.BOOKING_CONFIRMED.variables).toEqual(confirmedVars)

      // 2. BOOKING_CHANGED 변수
      const changedVars = ['매장명', '고객명', '서비스명', '이전예약일시', '변경예약일시', '매장위치']
      expect(ALIMTALK_TEMPLATES.BOOKING_CHANGED.variables).toEqual(changedVars)

      // 3. BOOKING_CANCELLED 변수
      const cancelledVars = ['매장명', '고객명', '서비스명', '예약일시', '취소사유', '환불안내']
      expect(ALIMTALK_TEMPLATES.BOOKING_CANCELLED.variables).toEqual(cancelledVars)
    })
  })
})
