import { describe, it, expect } from 'vitest'
import { PiiMaskingService } from './pii-masking'

describe('PiiMaskingService [ANI-467/J05]', () => {
  it('masks phone numbers in Korean format', () => {
    const text = '예약 문의 고객 전화번호: 010-1234-5678 및 010-9876-5432 입니다.'
    const masked = PiiMaskingService.maskText(text)

    expect(masked).toContain('010-****-5678')
    expect(masked).toContain('010-****-5432')
    expect(masked).not.toContain('1234')
    expect(masked).not.toContain('9876')
  })

  it('masks Korean resident registration numbers (RRN)', () => {
    const text = '사업자 대표 주민등록번호: 920512-1029384 확인'
    const masked = PiiMaskingService.maskText(text)

    expect(masked).toBe('사업자 대표 주민등록번호: 920512-******* 확인')
  })

  it('masks email addresses preserving domain', () => {
    const text = '고객 알림 이메일: owner_beauty@gmail.com'
    const masked = PiiMaskingService.maskText(text)

    expect(masked).toContain('@gmail.com')
    expect(masked).not.toContain('owner_beauty')
  })

  it('sanitizes log payload stripping secret keys and masking PII in nested objects', () => {
    const logData = {
      action: 'publish_feed',
      authToken: 'secret_bearer_token_12345',
      user: {
        name: '홍길동',
        phone: '010-5555-6666',
        passwordHash: 'argon2_hash_value'
      }
    }

    const sanitized = PiiMaskingService.sanitizeLogPayload(logData)

    expect(sanitized.authToken).toBe('[REDACTED_SECRET]')
    expect(sanitized.user.passwordHash).toBe('[REDACTED_SECRET]')
    expect(sanitized.user.phone).toBe('010-****-6666')
    expect(sanitized.user.name).toBe('홍길동')
  })
})
