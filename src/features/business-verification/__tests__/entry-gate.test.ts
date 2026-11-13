import { describe, expect, it } from 'vitest'
import { isApplicationSubmitted, resolveAppEntryRedirect } from '../entry-gate'

describe('isApplicationSubmitted', () => {
  it('VERIFIED는 서류 유무와 상관없이 true', () => {
    expect(isApplicationSubmitted({ status: 'VERIFIED' })).toBe(true)
    expect(isApplicationSubmitted({ status: 'VERIFIED', hasDocument: false })).toBe(true)
    expect(isApplicationSubmitted({ status: 'VERIFIED', hasDocument: true })).toBe(true)
  })

  it('PENDING은 서류가 첨부되어 있어야 true', () => {
    expect(isApplicationSubmitted({ status: 'PENDING', hasDocument: true })).toBe(true)
    expect(isApplicationSubmitted({ status: 'PENDING', hasDocument: false })).toBe(false)
    expect(isApplicationSubmitted({ status: 'PENDING' })).toBe(false)
  })

  it('기타 상태나 빈 값은 false', () => {
    expect(isApplicationSubmitted({ status: 'REJECTED', hasDocument: true })).toBe(false)
    expect(isApplicationSubmitted({ status: 'DOCUMENT_REQUIRED', hasDocument: true })).toBe(false)
    expect(isApplicationSubmitted({ status: 'MISMATCH', hasDocument: true })).toBe(false)
    expect(isApplicationSubmitted({ status: 'UNVERIFIED', hasDocument: true })).toBe(false)
    expect(isApplicationSubmitted(null)).toBe(false)
    expect(isApplicationSubmitted(undefined)).toBe(false)
    expect(isApplicationSubmitted({})).toBe(false)
  })
})

describe('resolveAppEntryRedirect', () => {
  it('신청 미완료면 /start', () => {
    expect(resolveAppEntryRedirect({ applicationSubmitted: false, prepared: true, educationShell: false })).toBe('/start')
    expect(resolveAppEntryRedirect({ applicationSubmitted: false, prepared: false, educationShell: true })).toBe('/start')
  })

  it('신청 완료되었지만 교육 셸이고 미준비면 /start', () => {
    expect(resolveAppEntryRedirect({ applicationSubmitted: true, prepared: false, educationShell: true })).toBe('/start')
  })

  it('신청 완료 및 준비 완료 시 통과', () => {
    expect(resolveAppEntryRedirect({ applicationSubmitted: true, prepared: true, educationShell: true })).toBeNull()
    expect(resolveAppEntryRedirect({ applicationSubmitted: true, prepared: false, educationShell: false })).toBeNull()
  })

  it('심사 전용 계정(reviewAccount=true)은 미신청/미준비 상태여도 /app 진입 허용(null 반환)', () => {
    expect(resolveAppEntryRedirect({ applicationSubmitted: false, prepared: false, educationShell: true, reviewAccount: true })).toBeNull()
    expect(resolveAppEntryRedirect({ applicationSubmitted: false, prepared: false, educationShell: false, reviewAccount: true })).toBeNull()
    expect(resolveAppEntryRedirect({ applicationSubmitted: true, prepared: false, educationShell: true, reviewAccount: true })).toBeNull()
  })

  it('reviewAccount가 false이거나 미지정일 때는 기존 규칙 유지', () => {
    expect(resolveAppEntryRedirect({ applicationSubmitted: false, prepared: false, educationShell: false, reviewAccount: false })).toBe('/start')
    expect(resolveAppEntryRedirect({ applicationSubmitted: false, prepared: false, educationShell: false })).toBe('/start')
  })
})

