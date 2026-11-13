/**
 * 심사 전용 테스트 계정 판정.
 *
 * env.REVIEW_ACCOUNT_USER_IDS 에 쉼표로 구분된 uuid 목록 중
 * 전달받은 userId 가 정확히 포함되어 있는지 확인한다.
 *
 * - 대소문자 무시 비교
 * - 목록 항목 및 userId 의 앞뒤 공백 제거
 * - 미설정/빈 문자열인 경우 false (fail-closed)
 * - userId 가 빈 값인 경우 false
 */
export function isReviewAccountUser(
  userId: string | null | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (!userId || typeof userId !== 'string') return false
  const normalizedUserId = userId.trim().toLowerCase()
  if (!normalizedUserId) return false

  const rawList = env.REVIEW_ACCOUNT_USER_IDS
  if (!rawList || typeof rawList !== 'string') return false

  const allowedIds = rawList
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  return allowedIds.includes(normalizedUserId)
}
