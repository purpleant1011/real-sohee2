const photoEmphasisPattern = /(?:사진\s*(?:위주|중심|많이|위주의|위주로)|포토\s*스토리|포토|15\s*(?:장|컷))/iu
const brevityPattern = /(?:짧게|짧은|짧고|2\s*[-~]\s*3\s*줄|두\s*세\s*줄|간단히|간결히|간결하게)/iu

/**
 * 사용자 입력 메시지에서 사진 중심의 짧은 글(포토스토리) 요청 의도를 감지한다.
 * "사진 위주/포토/15장" 계열의 사진 강조와 "짧게/2~3줄" 계열의 간결성 요구가 함께 있을 때 활성화된다.
 */
export function detectPhotoStoryRequest(message: string): boolean {
  const normalized = message.trim()
  if (!normalized) return false

  return photoEmphasisPattern.test(normalized) && brevityPattern.test(normalized)
}
