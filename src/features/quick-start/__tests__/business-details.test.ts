import { describe, expect, it } from 'vitest'
import { businessDetailsSchema, businessDetailsFromRow, hasAnyBusinessDetail, EMPTY_BUSINESS_DETAILS } from '../business-details'

describe('businessDetailsSchema', () => {
  it('빈 입력은 통과한다 — 모든 항목이 선택이기 때문이다', () => {
    const parsed = businessDetailsSchema.parse({})
    expect(parsed.businessNumber).toBe('')
    expect(parsed.businessHours).toBe('')
    expect(parsed.intakeSource).toBe('manual')
  })

  it('유효한 사업자등록번호는 숫자만 남겨 통과시킨다', () => {
    // 000-00-00000 는 실제 검증 통과 번호
    const parsed = businessDetailsSchema.parse({ businessNumber: '000-00-00000' })
    expect(parsed.businessNumber).toBe('0000000000')
  })

  it('체크섬이 틀린 사업자등록번호는 거부한다', () => {
    const result = businessDetailsSchema.safeParse({ businessNumber: '1234567890' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['businessNumber'])
      expect(result.error.issues[0]?.message).toContain('사업자등록번호 형식')
    }
  })

  it('10자리가 아닌 사업자등록번호는 거부한다', () => {
    const result = businessDetailsSchema.safeParse({ businessNumber: '12345' })
    expect(result.success).toBe(false)
  })

  it('개업일자 8자리를 통과시키고 범위를 벗어난 날짜는 거부한다', () => {
    expect(businessDetailsSchema.parse({ businessStartDate: '20240101' }).businessStartDate).toBe('20240101')
    expect(businessDetailsSchema.safeParse({ businessStartDate: '20241399' }).success).toBe(false)
    expect(businessDetailsSchema.safeParse({ businessStartDate: '2024' }).success).toBe(false)
  })

  it('URL 은 http(s) 형식만 허용한다', () => {
    expect(businessDetailsSchema.parse({ websiteUrl: 'https://blog.naver.com/x' }).websiteUrl).toBe('https://blog.naver.com/x')
    expect(businessDetailsSchema.safeParse({ websiteUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(businessDetailsSchema.safeParse({ websiteUrl: 'naver.me/abc' }).success).toBe(false)
  })

  it('제어문자를 제거하고 공백을 정리한다', () => {
    const parsed = businessDetailsSchema.parse({ businessHours: '  평일 10:00\u0000~19:00  ' })
    expect(parsed.businessHours).toBe('평일 10:00 ~19:00')
  })

  it('길이 제한을 넘으면 거부한다', () => {
    expect(businessDetailsSchema.safeParse({ businessHours: 'x'.repeat(121) }).success).toBe(false)
    expect(businessDetailsSchema.safeParse({ representativeName: 'x'.repeat(61) }).success).toBe(false)
  })
})

describe('businessDetailsFromRow', () => {
  it('null 행은 빈 폼으로 돌려준다', () => {
    expect(businessDetailsFromRow(null)).toEqual(EMPTY_BUSINESS_DETAILS)
  })

  it('DB 행을 폼 상태로 복원한다', () => {
    const restored = businessDetailsFromRow({
      businessNumber: '0000000000',
      businessHours: '평일 10:00~19:00',
      intakeSource: 'naver_sync',
    })
    expect(restored.businessNumber).toBe('0000000000')
    expect(restored.businessHours).toBe('평일 10:00~19:00')
    expect(restored.intakeSource).toBe('naver_sync')
    expect(restored.parkingInfo).toBe('')
  })
})

describe('hasAnyBusinessDetail', () => {
  it('아무 값도 없으면 false', () => {
    expect(hasAnyBusinessDetail(EMPTY_BUSINESS_DETAILS)).toBe(false)
    expect(hasAnyBusinessDetail(null)).toBe(false)
  })

  it('한 항목이라도 채워지면 true (intakeSource 는 값으로 치지 않는다)', () => {
    expect(hasAnyBusinessDetail({ ...EMPTY_BUSINESS_DETAILS, intakeSource: 'naver_sync' })).toBe(false)
    expect(hasAnyBusinessDetail({ ...EMPTY_BUSINESS_DETAILS, parkingInfo: '매장 앞 2대' })).toBe(true)
  })
})
