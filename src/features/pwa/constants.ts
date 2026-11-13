/** PWA 공용 상수. manifest/sw 와 값이 어긋나면 src/features/pwa/__tests__/pwa-contract.test.ts 가 실패한다. */
export const PWA_SW_URL = '/sw.js'
export const PWA_SW_SCOPE = '/'
export const PWA_LIGHT_THEME_COLOR = '#6656e8'
export const PWA_DARK_THEME_COLOR = '#0c0d10'
export const PWA_BACKGROUND_COLOR = '#f7f6f2'

/**
 * 서비스 워커가 절대 캐시하면 안 되는 경로 접두사(ANI-1727).
 * 워크스페이스·고객·대화·예약·결제·승인 결과가 흐르는 표면이다.
 * public/sw.js 의 PRIVATE_PATH_PREFIXES 와 값이 같아야 하며 테스트가 이를 강제한다.
 */
export const SW_PRIVATE_PATH_PREFIXES = [
  '/api/',
  '/app/',
  '/admin/',
  '/auth/',
  '/operator/',
  '/dev/',
  '/_next/data/',
] as const

export const PWA_STORAGE_KEYS = {
  installDismissedAt: 'sohee-pwa-install-dismissed-at',
  installDismissCount: 'sohee-pwa-install-dismiss-count',
  installed: 'sohee-pwa-installed',
  firstValueReached: 'sohee-pwa-first-value-reached',
  installPermanentlyDismissed: 'sohee-pwa-install-permanently-dismissed',
  pushPromptDismissedAt: 'sohee-pwa-push-dismissed-at',
  pushPromptDismissCount: 'sohee-pwa-push-dismiss-count',
} as const

/** '나중에' 이후 설치 안내를 다시 보이기 전 대기 시간. 거절이 누적될수록 길어진다. */
export const INSTALL_SNOOZE_DAYS = [7, 30, 90] as const
