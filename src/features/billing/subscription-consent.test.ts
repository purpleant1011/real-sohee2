import { describe, expect, it } from 'vitest'
import {
  ConsentValidationError,
  buildConsentRecords,
  safeBuildConsentRecords,
} from './subscription-consent'

describe('subscription-consent: buildConsentRecords', () => {
  const validAcceptedAt = '2026-11-06T12:00:00.000Z'
  const validPolicyVersion = '2026-11-01'

  it('필수 동의 3종(terms, privacy, refund_auto_renewal)이 true이면 3개의 동의 레코드를 생성한다', () => {
    const records = buildConsentRecords({
      accepted: {
        terms: true,
        privacy: true,
        refund_auto_renewal: true,
      },
      policyVersion: validPolicyVersion,
      acceptedAt: validAcceptedAt,
      locale: 'ko',
    })

    expect(records).toHaveLength(3)

    const kinds = records.map((r) => r.kind)
    expect(kinds).toEqual(['terms', 'privacy', 'refund_auto_renewal'])

    for (const record of records) {
      expect(record.policyVersion).toBe(validPolicyVersion)
      expect(record.acceptedAt).toBe(validAcceptedAt)
      expect(record.locale).toBe('ko')
      expect(Object.isFrozen(record)).toBe(true)
    }
    expect(Object.isFrozen(records)).toBe(true)
  })

  it('locale 미지정 시 기본값 ko를 사용한다', () => {
    const records = buildConsentRecords({
      accepted: {
        terms: true,
        privacy: true,
        refund_auto_renewal: true,
      },
      policyVersion: validPolicyVersion,
      acceptedAt: validAcceptedAt,
    })

    expect(records.every((r) => r.locale === 'ko')).toBe(true)
  })

  it('marketing이 true이면 4번째 레코드로 marketing 동의를 별도 생성한다', () => {
    const records = buildConsentRecords({
      accepted: {
        terms: true,
        privacy: true,
        refund_auto_renewal: true,
        marketing: true,
      },
      policyVersion: validPolicyVersion,
      acceptedAt: validAcceptedAt,
      locale: 'ko',
    })

    expect(records).toHaveLength(4)
    expect(records[3]).toEqual({
      kind: 'marketing',
      policyVersion: validPolicyVersion,
      acceptedAt: validAcceptedAt,
      locale: 'ko',
    })
  })

  it('marketing이 false이거나 undefined이면 marketing 레코드를 생성하지 않는다', () => {
    const recordsWithFalse = buildConsentRecords({
      accepted: {
        terms: true,
        privacy: true,
        refund_auto_renewal: true,
        marketing: false,
      },
      policyVersion: validPolicyVersion,
      acceptedAt: validAcceptedAt,
    })

    expect(recordsWithFalse).toHaveLength(3)
    expect(recordsWithFalse.some((r) => r.kind === 'marketing')).toBe(false)
  })

  it('acceptedAt으로 Date 객체가 주어지면 ISO 문자열로 변환하여 기록한다', () => {
    const date = new Date('2026-11-06T15:30:00.000Z')
    const records = buildConsentRecords({
      accepted: {
        terms: true,
        privacy: true,
        refund_auto_renewal: true,
      },
      policyVersion: validPolicyVersion,
      acceptedAt: date,
    })

    expect(records[0].acceptedAt).toBe('2026-11-06T15:30:00.000Z')
  })

  describe('필수 동의 누락 및 false 거부', () => {
    it('terms가 누락되었거나 false이면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            privacy: true,
            refund_auto_renewal: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)

      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: false,
            privacy: true,
            refund_auto_renewal: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })

    it('privacy가 누락되었거나 false이면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            refund_auto_renewal: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)

      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: false,
            refund_auto_renewal: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })

    it('refund_auto_renewal이 누락되었거나 false이면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)

      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: false,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })
  })

  describe('strict 스키마: 번들 키 및 미정의 필드 거부', () => {
    it('accepted 내에 allAgreed 같은 번들 키가 포함되면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
            allAgreed: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })

    it('accepted 내에 agreeAll 키가 포함되면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
            agreeAll: true,
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })

    it('루트 레벨에 allAgreed 같은 번들 키가 포함되면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
          },
          allAgreed: true,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        } as any)
      ).toThrow(ConsentValidationError)
    })

    it('개인정보나 IP 주소 등 허용되지 않은 필드가 주어지면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
          },
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
          ipAddress: '127.0.0.1',
        } as any)
      ).toThrow(ConsentValidationError)

      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
            userIp: '192.168.1.1',
          } as any,
          policyVersion: validPolicyVersion,
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })
  })

  describe('policyVersion 및 acceptedAt 유효성 검증', () => {
    it('policyVersion이 빈 문자열이거나 공백이면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
          },
          policyVersion: '',
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)

      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
          },
          policyVersion: '   ',
          acceptedAt: validAcceptedAt,
        })
      ).toThrow(ConsentValidationError)
    })

    it('acceptedAt이 유효하지 않은 날짜 형식이면 거부한다', () => {
      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
          },
          policyVersion: validPolicyVersion,
          acceptedAt: 'invalid-date',
        })
      ).toThrow(ConsentValidationError)

      expect(() =>
        buildConsentRecords({
          accepted: {
            terms: true,
            privacy: true,
            refund_auto_renewal: true,
          },
          policyVersion: validPolicyVersion,
          acceptedAt: new Date('invalid'),
        })
      ).toThrow(ConsentValidationError)
    })
  })

  describe('safeBuildConsentRecords', () => {
    it('성공 시 success: true와 records를 반환한다', () => {
      const result = safeBuildConsentRecords({
        accepted: {
          terms: true,
          privacy: true,
          refund_auto_renewal: true,
          marketing: true,
        },
        policyVersion: validPolicyVersion,
        acceptedAt: validAcceptedAt,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(4)
      }
    })

    it('실패 시 success: false와 error를 반환한다', () => {
      const result = safeBuildConsentRecords({
        accepted: {
          terms: true,
          privacy: false,
          refund_auto_renewal: true,
        } as any,
        policyVersion: validPolicyVersion,
        acceptedAt: validAcceptedAt,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ConsentValidationError)
      }
    })
  })
})
