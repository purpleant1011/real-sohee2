import { describe, it, expect } from 'vitest'
import {
  validateBusinessRegistrationNumber,
  computeServiceEligibility,
  transitionOnSubmit,
  transitionOnVerify,
  transitionOnReject,
} from '../state-machine'
import { detectTrialAbuse } from '../abuse-detector'
import { assertExternalActionAllowed, isExternalActionAllowed, BusinessVerificationRequiredError } from '../eligibility-guard'

describe('Business Verification State Machine & Validation', () => {
  it('validates 10-digit business registration numbers correctly', () => {
    // 유효한 형식 (10자리 숫자)
    expect(validateBusinessRegistrationNumber('000-00-00000').isValid).toBe(true)
    expect(validateBusinessRegistrationNumber('999-99-99999').isValid).toBe(true)

    // 유효하지 않은 형식
    expect(validateBusinessRegistrationNumber('12345').isValid).toBe(false)
    expect(validateBusinessRegistrationNumber('abcdefghij').isValid).toBe(false)
  })

  it('computes correct service eligibility by verification status', () => {
    expect(computeServiceEligibility('VERIFIED')).toBe('ELIGIBLE')
    expect(computeServiceEligibility('INCOMPLETE')).toBe('LIMITED')
    expect(computeServiceEligibility('PENDING_REVIEW')).toBe('LIMITED')
    expect(computeServiceEligibility('REJECTED')).toBe('BLOCKED')
  })

  it('handles state transitions on submit, verify, and reject', () => {
    const input = {
      businessName: '소희 뷰티살롱',
      registrationNumber: '000-00-00000',
      representativeName: '김소희',
      category: '미용업',
      contactPhone: '010-1234-5678',
    }

    // 기본 제출: PENDING_REVIEW
    const submitResult = transitionOnSubmit('INCOMPLETE', input)
    expect(submitResult.nextStatus).toBe('PENDING_REVIEW')
    expect(submitResult.eligibility).toBe('LIMITED')

    // 자동 승인 옵션 제출: VERIFIED
    const autoVerifyResult = transitionOnSubmit('INCOMPLETE', input, { autoVerifySafe: true })
    expect(autoVerifyResult.nextStatus).toBe('VERIFIED')
    expect(autoVerifyResult.eligibility).toBe('ELIGIBLE')

    // 관리자 승인
    const verified = transitionOnVerify()
    expect(verified.nextStatus).toBe('VERIFIED')
    expect(verified.eligibility).toBe('ELIGIBLE')

    // 관리자 반려
    const rejected = transitionOnReject()
    expect(rejected.nextStatus).toBe('REJECTED')
    expect(rejected.eligibility).toBe('BLOCKED')
  })
})

describe('Trial Abuse Detection', () => {
  it('detects duplicate business registration numbers across workspaces', () => {
    const existing = [
      {
        workspaceId: 'ws-1',
        registrationNumber: '123-45-67890',
        verificationStatus: 'VERIFIED',
        createdAt: new Date().toISOString(),
      },
    ]

    const result = detectTrialAbuse('123-45-67890', existing, 'ws-2')
    expect(result.isDuplicate).toBe(true)
    expect(result.isAbuseSuspicious).toBe(true)
    expect(result.flags).toContain('DUPLICATE_REGISTRATION_NUMBER')
  })

  it('allows same workspace re-verification without duplicate abuse flag', () => {
    const existing = [
      {
        workspaceId: 'ws-1',
        registrationNumber: '123-45-67890',
        verificationStatus: 'INCOMPLETE',
        createdAt: new Date().toISOString(),
      },
    ]

    const result = detectTrialAbuse('123-45-67890', existing, 'ws-1')
    expect(result.isDuplicate).toBe(false)
    expect(result.isAbuseSuspicious).toBe(false)
  })
})

describe('Business Eligibility Guard', () => {
  it('blocks external action when business status is INCOMPLETE or PENDING_REVIEW', () => {
    expect(() =>
      assertExternalActionAllowed({ verificationStatus: 'INCOMPLETE', serviceEligibility: 'LIMITED' })
    ).toThrow(BusinessVerificationRequiredError)

    expect(() =>
      assertExternalActionAllowed({ verificationStatus: 'PENDING_REVIEW', serviceEligibility: 'LIMITED' })
    ).toThrow(BusinessVerificationRequiredError)

    expect(() =>
      assertExternalActionAllowed({ verificationStatus: 'REJECTED', serviceEligibility: 'BLOCKED' })
    ).toThrow(BusinessVerificationRequiredError)

    expect(isExternalActionAllowed({ verificationStatus: 'INCOMPLETE', serviceEligibility: 'LIMITED' })).toBe(false)
  })

  it('allows external action when business status is VERIFIED and ELIGIBLE', () => {
    expect(() =>
      assertExternalActionAllowed({ verificationStatus: 'VERIFIED', serviceEligibility: 'ELIGIBLE' })
    ).not.toThrow()

    expect(isExternalActionAllowed({ verificationStatus: 'VERIFIED', serviceEligibility: 'ELIGIBLE' })).toBe(true)
  })
})
