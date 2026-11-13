import { describe, expect, it } from 'vitest'
import { isValidCompactDate, parseVerificationInput } from '../input'

describe('isValidCompactDate', () => {
  it('유효한 과거 날짜는 true', () => {
    expect(isValidCompactDate('20240101')).toBe(true)
    expect(isValidCompactDate('20200229')).toBe(true) // 윤년
  })

  it('2월 30일은 false', () => {
    expect(isValidCompactDate('20240230')).toBe(false)
  })

  it('1900년 이전(1899년)은 false', () => {
    expect(isValidCompactDate('18991231')).toBe(false)
  })

  it('미래 날짜는 false', () => {
    const fixedNow = new Date('2025-01-01T00:00:00Z')
    expect(isValidCompactDate('20250102', fixedNow)).toBe(false)
    expect(isValidCompactDate('20250101', fixedNow)).toBe(true)
  })

  it('형식이 8자리 숫자가 아니면 false', () => {
    expect(isValidCompactDate('2024-01-01')).toBe(false)
    expect(isValidCompactDate('2024010')).toBe(false)
    expect(isValidCompactDate('202401011')).toBe(false)
    expect(isValidCompactDate('abcdefgh')).toBe(false)
  })
})

describe('parseVerificationInput', () => {
  const valid = {
    businessNumber: '123-45-67890',
    companyName: '  모모 카페  ',
    representativeName: ' 김소희 ',
    startDate: '2024-01-01',
  }

  it('정상 입력을 정규화하여 반환한다', () => {
    const res = parseVerificationInput(valid)
    expect(res).toEqual({
      ok: true,
      value: {
        businessNumber: '1234567890',
        companyName: '모모 카페',
        representativeName: '김소희',
        startDate: '20240101',
      },
    })
  })

  it('필수 필드가 누락되었거나 문자열이 아니거나 빈 문자열이면 에러', () => {
    expect(parseVerificationInput({ ...valid, businessNumber: '' })).toEqual({
      ok: false,
      message: '사업자등록번호, 상호명, 대표자명은 필수 입력 항목입니다.',
    })
    expect(parseVerificationInput({ ...valid, companyName: '   ' })).toEqual({
      ok: false,
      message: '사업자등록번호, 상호명, 대표자명은 필수 입력 항목입니다.',
    })
    expect(parseVerificationInput({ ...valid, representativeName: null })).toEqual({
      ok: false,
      message: '사업자등록번호, 상호명, 대표자명은 필수 입력 항목입니다.',
    })
  })

  it('사업자등록번호가 숫자 10자리가 아니면 에러', () => {
    expect(parseVerificationInput({ ...valid, businessNumber: '12345' })).toEqual({
      ok: false,
      message: '사업자등록번호는 숫자 10자리로 입력해 주세요.',
    })
    expect(parseVerificationInput({ ...valid, businessNumber: 'abcdefghij' })).toEqual({
      ok: false,
      message: '사업자등록번호는 숫자 10자리로 입력해 주세요.',
    })
  })

  it('상호명이 2~60자가 아니면 에러 (1자 또는 61자)', () => {
    expect(parseVerificationInput({ ...valid, companyName: '모' })).toEqual({
      ok: false,
      message: '상호는 2~60자로 입력해 주세요.',
    })
    expect(parseVerificationInput({ ...valid, companyName: 'a'.repeat(61) })).toEqual({
      ok: false,
      message: '상호는 2~60자로 입력해 주세요.',
    })
  })

  it('대표자명이 2~30자가 아니면 에러 (1자 또는 31자)', () => {
    expect(parseVerificationInput({ ...valid, representativeName: '김' })).toEqual({
      ok: false,
      message: '대표자명은 2~30자로 입력해 주세요.',
    })
    expect(parseVerificationInput({ ...valid, representativeName: '가'.repeat(31) })).toEqual({
      ok: false,
      message: '대표자명은 2~30자로 입력해 주세요.',
    })
  })

  it('개업일자가 올바르지 않으면 에러 (2월 30일)', () => {
    expect(parseVerificationInput({ ...valid, startDate: '2024-02-30' })).toEqual({
      ok: false,
      message: '개업일자를 8자리 숫자로 입력해 주세요. (예: 20240101)',
    })
  })
})
