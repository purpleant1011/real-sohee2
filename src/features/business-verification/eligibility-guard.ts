import type { BusinessProfile } from './types'

export class BusinessVerificationRequiredError extends Error {
  constructor(message = '실제 외부 채널 게시 및 마케팅 실행을 위해 사업자 인증(VERIFIED)이 필요합니다.') {
    super(message)
    this.name = 'BusinessVerificationRequiredError'
  }
}

/**
 * 외부 액션(SNS 게시, 블로그 발행, CRM 발송 등) 실행 전 사업자 자격 사전 검증
 */
export function assertExternalActionAllowed(
  profile: Pick<BusinessProfile, 'verificationStatus' | 'serviceEligibility'> | null | undefined
): void {
  if (!profile) {
    throw new BusinessVerificationRequiredError('사업자 정보가 등록되지 않았습니다. 온보딩에서 사업자 정보를 입력해 주세요.')
  }

  if (profile.verificationStatus !== 'VERIFIED' || profile.serviceEligibility !== 'ELIGIBLE') {
    throw new BusinessVerificationRequiredError(
      `현재 사업자 인증 상태는 [${profile.verificationStatus}]입니다. 외부 채널 실게시를 위해 사업자 인증 완료(VERIFIED)가 필요합니다.`
    )
  }
}

/**
 * 외부 액션 가능 여부 boolean 확인
 */
export function isExternalActionAllowed(
  profile: Pick<BusinessProfile, 'verificationStatus' | 'serviceEligibility'> | null | undefined
): boolean {
  if (!profile) return false
  return profile.verificationStatus === 'VERIFIED' && profile.serviceEligibility === 'ELIGIBLE'
}
