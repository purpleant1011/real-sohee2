import { describe, expect, it } from 'vitest'
import { consentStatusFor, consentViewFor, normalizeConsentInput } from './consent-model'

describe('consentStatusFor', () => {
  describe('Given 수신 동의가 확인된 고객일 때', () => {
    it('Then 확인된 사실과 확인 날짜를 함께 보여 준다', () => {
      const consent = consentStatusFor({ status: 'granted', checkedAt: '2026-10-20T05:00:00.000Z' })
      expect(consent.status).toBe('granted')
      expect(consent.label).toBe('수신 동의 확인됨')
      expect(consent.canContact).toBe(true)
      expect(consent.dated).toBe(true)
      expect(consent.checkedOn).toBe('2026-10-20')
    })
  })

  describe('Given 수신 동의를 철회한 고객일 때', () => {
    it('Then 철회 사실과 출처를 보여 주고 연락을 막는다', () => {
      const consent = consentStatusFor({ status: 'withdrawn', checkedAt: '2026-10-20T00:00:00Z', source: '고객 요청' })
      expect(consent.label).toBe('수신 동의 철회')
      expect(consent.canContact).toBe(false)
      expect(consent.sourceLabel).toBe('고객 요청')
      expect(consent.detail).toContain('다시 동의를 받기 전')
    })
  })

  describe('Given 동의 여부를 모를 때', () => {
    it('Then 철회와 구분되는 미확인 문구를 쓰고 연락을 막는다', () => {
      for (const status of [undefined, null, '', 'UNKNOWN', 'yes', 'active']) {
        const consent = consentStatusFor({ status })
        expect(consent.status).toBe('unknown')
        expect(consent.label).toBe('수신 동의 미확인')
        expect(consent.label).not.toBe('수신 동의 철회')
        expect(consent.canContact).toBe(false)
      }
    })

    it('Then 모르는 상태값을 동의로 승격하지 않는다', () => {
      expect(consentStatusFor({ status: 'GRANTED' }).status).toBe('granted')
      expect(consentStatusFor({ status: '  granted  ' }).status).toBe('granted')
      expect(consentStatusFor({ status: 'grant' }).status).toBe('unknown')
      expect(consentStatusFor({ status: 'granted_' }).status).toBe('unknown')
    })
  })

  describe('Given 확인 시각을 읽을 수 없을 때', () => {
    it('Then 날짜를 꾸며내지 않고 dated=false 로 둔다', () => {
      for (const checkedAt of [null, undefined, '', '어제쯤', '2026-13-40']) {
        const consent = consentStatusFor({ status: 'granted', checkedAt })
        expect(consent.checkedOn).toBeNull()
        expect(consent.dated).toBe(false)
      }
    })
  })

  describe('Given 출처가 내부 코드일 때', () => {
    it('Then 화이트리스트 밖 값은 화면에 내보내지 않는다', () => {
      for (const source of ['customer_request', 'provider_webhook', 'SUPABASE_TABLE', 'internal']) {
        expect(consentStatusFor({ status: 'withdrawn', source }).sourceLabel).toBeNull()
      }
    })
  })

  describe('Given 어떤 동의 상태든', () => {
    it('Then 철회·미확인 문구에 "확인됨" 성공 어휘를 쓰지 않는다', () => {
      for (const status of ['withdrawn', 'unknown', 'nope'] as const) {
        const consent = consentStatusFor({ status })
        expect(consent.label).not.toContain('확인됨')
        expect(consent.label).not.toContain('성공')
        expect(consent.detail).not.toContain('보낼 수 있는 동의가 확인됐어요')
      }
    })
  })

  describe('Given 서버가 동의 기록을 확인했다고 밝히지 않았을 때', () => {
    it('Then granted 여도 서버 확인으로 표시하지 않는다', () => {
      // 서버는 아직 granted 를 만들지 않는다(customer-semantics.ts:15-18). 표시와 근거를 분리한다.
      const consent = consentStatusFor({ status: 'granted', checkedAt: '2026-10-20T05:00:00.000Z' })
      expect(consent.status).toBe('granted')
      expect(consent.verifiedByServer).toBe(false)
    })

    it('Then 철회·미확인은 어떤 경우에도 서버 확인이 되지 않는다', () => {
      for (const status of ['withdrawn', 'unknown', 'garbage']) {
        expect(consentStatusFor({ status, verifiedByServer: true }).verifiedByServer).toBe(false)
      }
    })
  })

  describe('Given 서버가 동의 기록을 확인했다고 명시했을 때', () => {
    it('Then 그때만 서버 확인으로 표시한다', () => {
      expect(consentStatusFor({ status: 'granted', verifiedByServer: true }).verifiedByServer).toBe(true)
    })
  })
})

describe('normalizeConsentInput', () => {
  describe('Given 화면이 consent 를 문자열 하나로 내려줄 때', () => {
    it('Then 미확인 문자열도 예외 없이 미확인으로 받는다', () => {
      expect(normalizeConsentInput('unknown')).toEqual({ status: 'unknown' })
      expect(consentViewFor('unknown').label).toBe('수신 동의 미확인')
      expect(consentViewFor('withdrawn').canContact).toBe(false)
    })
  })

  describe('Given consent 가 객체일 때', () => {
    it('Then status·checkedAt·source 를 읽는다', () => {
      const view = consentViewFor({ status: 'withdrawn', checkedAt: '2026-10-20T00:00:00Z', source: '고객 요청' })
      expect(view.status).toBe('withdrawn')
      expect(view.sourceLabel).toBe('고객 요청')
      expect(view.checkedOn).toBe('2026-10-20')
    })

    it('Then 중첩된 consent 문자열도 읽는다', () => {
      expect(normalizeConsentInput({ consent: 'withdrawn' }).status).toBe('withdrawn')
    })
  })

  describe('Given 모양을 알 수 없거나 동의와 무관한 값일 때', () => {
    it('Then 동의로 승격하지 않고 미확인으로 둔다', () => {
      for (const value of [null, undefined, 42, [], {}, { agreed: true }, { marketing: { agreed: true } }]) {
        const view = consentViewFor(value)
        expect(view.status).toBe('unknown')
        expect(view.canContact).toBe(false)
      }
    })
  })
})
