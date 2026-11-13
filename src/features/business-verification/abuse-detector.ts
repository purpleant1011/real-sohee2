import type { BusinessProfile } from './types'

export interface AbuseDetectionResult {
  isDuplicate: boolean
  isAbuseSuspicious: boolean
  flags: string[]
  reason?: string
}

/**
 * 동일 사업자등록번호 및 재가입 트라이얼 어뷰징 탐지
 */
export function detectTrialAbuse(
  registrationNumber: string,
  existingProfiles: Array<{ workspaceId: string; registrationNumber: string; verificationStatus: string; createdAt: string }>,
  currentWorkspaceId: string
): AbuseDetectionResult {
  const flags: string[] = []
  const normalized = registrationNumber.replace(/[^0-9]/g, '')

  // 1. 동일 사업자등록번호로 기존 워크스페이스가 존재하는지 검사
  const duplicates = existingProfiles.filter(
    (p) => p.workspaceId !== currentWorkspaceId && p.registrationNumber.replace(/[^0-9]/g, '') === normalized
  )

  if (duplicates.length > 0) {
    flags.push('DUPLICATE_REGISTRATION_NUMBER')
  }

  // 2. 단기간 다중 생성 의심 검사
  const recentDuplicates = duplicates.filter((p) => {
    const diffHours = (Date.now() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60)
    return diffHours < 72 // 3일 이내
  })

  if (recentDuplicates.length > 0) {
    flags.push('RAPID_RECREATION_ABUSE')
  }

  const isDuplicate = duplicates.length > 0
  const isAbuseSuspicious = flags.length > 0

  return {
    isDuplicate,
    isAbuseSuspicious,
    flags,
    reason: isAbuseSuspicious
      ? `이미 등록된 사업자 번호이거나 단기간 재가입 어뷰징이 의심됩니다. (플래그: ${flags.join(', ')})`
      : undefined,
  }
}
