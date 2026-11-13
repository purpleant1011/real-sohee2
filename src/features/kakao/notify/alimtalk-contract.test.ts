import { describe, expect, it } from 'vitest'
import {
  AlimtalkContractError,
  buildIdempotencyKey,
  containsAdvertisingContent,
  DryRunAlimtalkAdapter,
  normalizeKrPhone,
  validateTemplateVariables,
  type AlimtalkSendRequest,
} from './alimtalk-contract'

describe('alimtalk-contract', () => {
  describe('validateTemplateVariables', () => {
    const template = '안녕하세요 #{고객명}님, #{예약일시} 예약이 확정되었습니다.'

    it('returns valid: true and resolvedText when all variables are provided', () => {
      const result = validateTemplateVariables(template, {
        고객명: '홍길동',
        예약일시: '2026-11-06 14:00',
      })

      expect(result.valid).toBe(true)
      expect(result.missing).toEqual([])
      expect(result.unused).toEqual([])
      expect(result.empty).toEqual([])
      expect(result.exceeded).toEqual([])
      expect(result.resolvedText).toBe(
        '안녕하세요 홍길동님, 2026-11-06 14:00 예약이 확정되었습니다.',
      )
    })

    it('detects missing variables required by template', () => {
      const result = validateTemplateVariables(template, {
        고객명: '홍길동',
      })

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('예약일시')
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('detects unused variables not defined in template', () => {
      const result = validateTemplateVariables(template, {
        고객명: '홍길동',
        예약일시: '2026-11-06 14:00',
        불필요변수: '테스트',
      })

      expect(result.valid).toBe(false)
      expect(result.unused).toContain('불필요변수')
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('detects empty or whitespace-only variables', () => {
      const result = validateTemplateVariables(template, {
        고객명: '   ',
        예약일시: '',
      })

      expect(result.valid).toBe(false)
      expect(result.empty).toContain('고객명')
      expect(result.empty).toContain('예약일시')
    })

    it('detects variable length exceeding limit', () => {
      const tooLongName = '가'.repeat(501)
      const result = validateTemplateVariables(
        template,
        {
          고객명: tooLongName,
          예약일시: '2026-11-06 14:00',
        },
        { maxVariableLength: 500 },
      )

      expect(result.valid).toBe(false)
      expect(result.exceeded).toContain('고객명')
    })

    it('handles multiple occurrences of the same variable', () => {
      const duplicateVarTemplate = '#{고객명}님 환영합니다. #{고객명}님의 예약이 완료되었습니다.'
      const result = validateTemplateVariables(duplicateVarTemplate, {
        고객명: '이순신',
      })

      expect(result.valid).toBe(true)
      expect(result.resolvedText).toBe('이순신님 환영합니다. 이순신님의 예약이 완료되었습니다.')
    })
  })

  describe('normalizeKrPhone', () => {
    it('normalizes valid 010 mobile numbers to E.164 (+8210...) format', () => {
      expect(normalizeKrPhone('010-1234-5678')).toBe('+821012345678')
      expect(normalizeKrPhone('01012345678')).toBe('+821012345678')
      expect(normalizeKrPhone('010 9876 5432')).toBe('+821098765432')
      expect(normalizeKrPhone('+82-10-1234-5678')).toBe('+821012345678')
      expect(normalizeKrPhone('+82 10 1234 5678')).toBe('+821012345678')
      expect(normalizeKrPhone('+821012345678')).toBe('+821012345678')
    })

    it('rejects landline numbers (02, 031, etc.)', () => {
      expect(() => normalizeKrPhone('02-1234-5678')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('031-123-4567')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('051-987-6543')).toThrow(AlimtalkContractError)
    })

    it('rejects VoIP numbers (070)', () => {
      expect(() => normalizeKrPhone('070-1234-5678')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('07012345678')).toThrow(AlimtalkContractError)
    })

    it('rejects non-010 cellular numbers (011, 016, 017, 018, 019)', () => {
      expect(() => normalizeKrPhone('011-123-4567')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('016-123-4567')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('019-123-4567')).toThrow(AlimtalkContractError)
    })

    it('rejects international non-KR numbers', () => {
      expect(() => normalizeKrPhone('+1-202-555-0123')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('+81-90-1234-5678')).toThrow(AlimtalkContractError)
    })

    it('rejects malformed numbers or wrong digit counts', () => {
      expect(() => normalizeKrPhone('010-123-456')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('010-1234-56789')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('')).toThrow(AlimtalkContractError)
      expect(() => normalizeKrPhone('not-a-phone')).toThrow(AlimtalkContractError)
    })
  })

  describe('buildIdempotencyKey', () => {
    it('creates deterministic idempotency key from workspaceId, bookingId, event', () => {
      const key = buildIdempotencyKey({
        workspaceId: 'ws_abc123',
        bookingId: 'bk_xyz789',
        event: 'booking_confirmed',
      })
      expect(key).toBe('alimtalk:ws_abc123:bk_xyz789:booking_confirmed')
    })

    it('throws when required fields are missing or empty', () => {
      expect(() =>
        buildIdempotencyKey({
          workspaceId: '',
          bookingId: 'bk_1',
          event: 'test',
        }),
      ).toThrow(AlimtalkContractError)

      expect(() =>
        buildIdempotencyKey({
          workspaceId: 'ws_1',
          bookingId: '',
          event: 'test',
        }),
      ).toThrow(AlimtalkContractError)

      expect(() =>
        buildIdempotencyKey({
          workspaceId: 'ws_1',
          bookingId: 'bk_1',
          event: '',
        }),
      ).toThrow(AlimtalkContractError)
    })
  })

  describe('containsAdvertisingContent', () => {
    it('detects advertising keywords in text', () => {
      expect(containsAdvertisingContent('(광고) 지금 방문하시면 50% 할인')).toBe(true)
      expect(containsAdvertisingContent('[광고] 특가 이벤트 안내')).toBe(true)
      expect(containsAdvertisingContent('무료수신거부 080-123-4567')).toBe(true)
      expect(containsAdvertisingContent('지금 예약 시 특별 할인쿠폰 지급')).toBe(true)
      expect(containsAdvertisingContent('광고성 정보입니다.')).toBe(true)
    })

    it('passes clean informational content', () => {
      expect(containsAdvertisingContent('소희헤어 예약이 2026-11-06 14:00로 확정되었습니다.')).toBe(
        false,
      )
      expect(containsAdvertisingContent('예약 취소 안내: 고객님의 요청으로 취소되었습니다.')).toBe(
        false,
      )
    })
  })

  describe('DryRunAlimtalkAdapter', () => {
    const validRequest: AlimtalkSendRequest = {
      idempotencyKey: 'alimtalk:ws_1:bk_1:confirmed',
      recipientPhone: '010-1234-5678',
      templateCode: 'BOOKING_CONFIRM_V1',
      templateBody: '안녕하세요 #{고객명}님, #{예약일시} 예약이 확정되었습니다.',
      variables: {
        고객명: '김철수',
        예약일시: '2026-11-06 15:30',
      },
      consent: 'informational',
    }

    it('validates input and returns status: DRY_RUN with no fake messageId and no network calls', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const result = await adapter.send(validRequest)

      expect(result.success).toBe(true)
      expect(result.status).toBe('DRY_RUN')
      expect(result.messageId).toBeUndefined()
      expect(result.idempotencyKey).toBe('alimtalk:ws_1:bk_1:confirmed')
      expect(result.normalizedPhone).toBe('+821012345678')
      expect(result.resolvedMessage).toBe(
        '안녕하세요 김철수님, 2026-11-06 15:30 예약이 확정되었습니다.',
      )
    })

    it('can read back status for previously dry-run sent messages', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      await adapter.send(validRequest)

      const status = await adapter.readbackStatus('alimtalk:ws_1:bk_1:confirmed')
      expect(status.status).toBe('DRY_RUN')
      expect(status.found).toBe(true)
    })

    it('returns found: false when reading back unknown key', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const status = await adapter.readbackStatus('unknown_key')
      expect(status.status).toBe('NOT_FOUND')
      expect(status.found).toBe(false)
    })

    it('rejects sending when consent is none', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const result = await adapter.send({
        ...validRequest,
        consent: 'none',
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toMatch(/동의|consent/i)
    })

    it('rejects sending when advertising wording is present in template body', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const result = await adapter.send({
        ...validRequest,
        templateBody: '(광고) 안녕하세요 #{고객명}님, #{예약일시} 할인쿠폰 증정',
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toMatch(/광고/i)
    })

    it('rejects sending when advertising wording is present in variables', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const result = await adapter.send({
        ...validRequest,
        variables: {
          고객명: '김철수',
          예약일시: '2026-11-06 [광고] 특가이벤트',
        },
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toMatch(/광고/i)
    })

    it('rejects sending when recipient phone is invalid', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const result = await adapter.send({
        ...validRequest,
        recipientPhone: '02-1234-5678',
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toMatch(/전화번호|phone|010/i)
    })

    it('rejects sending when template variables are invalid (missing)', async () => {
      const adapter = new DryRunAlimtalkAdapter()
      const result = await adapter.send({
        ...validRequest,
        variables: {
          고객명: '김철수',
        },
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toMatch(/변수|variable|누락/i)
    })
  })
})
