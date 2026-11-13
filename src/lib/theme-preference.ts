export type ThemeChoice = 'dark' | 'light' | 'system'

/**
 * iOS 홈 화면 앱(standalone)의 상태바는 앱 안 테마가 아니라 기기 설정을 따른다(statusBarStyle 'default').
 * 앱 테마만 다르면 상태바가 흰 띠로 남으므로, 이 환경에서는 저장된 수동 선택을 무시하고 시스템 테마를 쓴다.
 */
export function resolveStoredTheme({ saved, defaultTheme, iosStandalone }: { saved: string | null; defaultTheme: ThemeChoice; iosStandalone: boolean }): ThemeChoice {
  if (iosStandalone) return 'system'
  return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : defaultTheme
}

export function isIosStandalone(): boolean {
  if (typeof navigator === 'undefined') return false
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}
