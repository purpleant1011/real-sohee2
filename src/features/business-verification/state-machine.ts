import type { BusinessVerificationStatus, ServiceEligibility, BusinessRegistrationInput } from './types'

/**
 * 한국 사업자등록번호 유효성 검사 (10자리 숫자 및 가중치 체크섬)
 */
export function validateBusinessRegistrationNumber(regNumber: string): { isValid: boolean; normalized: string; error?: string } {
  const normalized = regNumber.replace(/[^0-9]/g, '')
  if (normalized.length !== 10) {
    return { isValid: false, normalized, error: '사업자등록번호는 10자리 숫자여야 합니다.' }
  }

  // 기본 가중치 체크섬 검증
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += parseInt(normalized[i], 10) * weights[i]
  }
  sum += Math.floor((parseInt(normalized[8], 10) * 5) / 10)
  const remainder = (10 - (sum % 10)) % 10
  const checkDigit = parseInt(normalized[9], 10)

  // 개발/테스트용 특수 번호 허용 (000-00-00000 등)
  const isTestNumber = normalized === '0000000000' || normalized.startsWith('999')

  if (!isTestNumber && remainder !== checkDigit) {
    return { isValid: false, normalized, error: '유효하지 않은 사업자등록번호 형식입니다.' }
  }

  return { isValid: true, normalized }
}

/**
 * 상태에 따른 서비스 자격(ServiceEligibility) 계산
 */
export function computeServiceEligibility(status: BusinessVerificationStatus): ServiceEligibility {
  switch (status) {
    case 'VERIFIED':
      return 'ELIGIBLE'
    case 'INCOMPLETE':
    case 'PENDING_REVIEW':
      return 'LIMITED'
    case 'REJECTED':
      return 'BLOCKED'
    default:
      return 'LIMITED'
  }
}

/**
 * 사업자 프로필 제출 시 상태 전이
 */
export function transitionOnSubmit(
  currentStatus: BusinessVerificationStatus,
  input: BusinessRegistrationInput,
  options?: { autoVerifySafe?: boolean }
): { nextStatus: BusinessVerificationStatus; eligibility: ServiceEligibility; normalizedNumber: string } {
  const { isValid, normalized, error } = validateBusinessRegistrationNumber(input.registrationNumber)
  if (!isValid) {
    throw new Error(error || '사업자등록번호 검증 실패')
  }

  // 안전 기준 충족 및 자동 승인 정책 시 즉시 VERIFIED, 아닐 경우 PENDING_REVIEW
  const nextStatus: BusinessVerificationStatus = options?.autoVerifySafe ? 'VERIFIED' : 'PENDING_REVIEW'
  const eligibility = computeServiceEligibility(nextStatus)

  return { nextStatus, eligibility, normalizedNumber: normalized }
}

/**
 * 관리자/시스템에 의한 검증 승인 전이
 */
export function transitionOnVerify(): { nextStatus: BusinessVerificationStatus; eligibility: ServiceEligibility } {
  return { nextStatus: 'VERIFIED', eligibility: 'ELIGIBLE' }
}

/**
 * 관리자/시스템에 의한 검증 반려 전이
 */
export function transitionOnReject(): { nextStatus: BusinessVerificationStatus; eligibility: ServiceEligibility } {
  return { nextStatus: 'REJECTED', eligibility: 'BLOCKED' }
}
