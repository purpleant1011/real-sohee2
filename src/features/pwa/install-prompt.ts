import { INSTALL_SNOOZE_DAYS, PWA_STORAGE_KEYS } from './constants'

/**
 * 설치 유도 정책 (ANI-1721).
 * - 설치 유도는 `/app` 안에서만, 그리고 사용자가 거절하면 점점 더 길게 쉰다.
 * - Android 는 beforeinstallprompt 를 실제로 받았을 때만 네이티브 설치 창을 띄운다.
 * - iOS Safari 는 설치 API 가 없으므로 '공유 → 홈 화면에 추가' 안내만 보여준다.
 *   (iOS web push 는 홈 화면에 설치된 상태에서만 동작한다.)
 */

export type InstallPlatform = 'android-chromium' | 'ios-safari' | 'other'

export type InstallSignals = {
  dismissedAt: number | null
  dismissCount: number
  installed: boolean
  firstValueReached?: boolean
  permanentlyDismissed?: boolean
}

export type InstallOfferInput = {
  pathname: string | null
  standalone: boolean
  platform: InstallPlatform
  canPrompt: boolean
  signals: InstallSignals
  now: number
  /** 첫 가치(첫 게시물/첫 승인/첫 채널 연결 등)를 경험했는지 여부. false이면 섣부른 설치 제안을 차단한다. */
  hasFirstValue?: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 사용자 작업 몰입을 보호하기 위해 설치 제안을 억제하는 경로 */
const SUPPRESSED_PATHS = ['/app/onboarding', '/app/work/new']

export function detectInstallPlatform(input: {
  userAgent: string
  maxTouchPoints?: number
  hasBeforeInstallPrompt: boolean
}): InstallPlatform {
  if (input.hasBeforeInstallPrompt) return 'android-chromium'
  const ua = input.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios-safari'
  // iPadOS 13+ 는 데스크톱 UA 를 쓰므로 터치 포인트로 구분한다.
  if (/macintosh/i.test(ua) && (input.maxTouchPoints ?? 0) > 1) return 'ios-safari'
  return 'other'
}

export function isStandaloneDisplay(input: {
  displayModeStandalone: boolean
  displayModeFullscreen: boolean
  displayModeMinimalUi: boolean
  navigatorStandalone?: boolean
}): boolean {
  return Boolean(
    input.displayModeStandalone ||
      input.displayModeFullscreen ||
      input.displayModeMinimalUi ||
      input.navigatorStandalone,
  )
}

/** 거절 횟수에 따른 재안내 대기 일수. 1회 7일 → 2회 30일 → 3회 이상 90일. */
export function installSnoozeDays(dismissCount: number): number {
  const index = Math.min(Math.max(Math.trunc(dismissCount), 1), INSTALL_SNOOZE_DAYS.length) - 1
  return INSTALL_SNOOZE_DAYS[index]
}

export function shouldOfferInstall(input: InstallOfferInput): boolean {
  if (!input.pathname || !input.pathname.startsWith('/app')) return false
  // 1. 작업 몰입 보호: 온보딩 및 신규 작업 입력 경로에서는 설치 제안 억제
  if (SUPPRESSED_PATHS.some((p) => input.pathname === p || input.pathname?.startsWith(`${p}/`))) {
    return false
  }
  // 2. 첫 가치 신호 전 섣부른 설치 제안 차단 (ANI-1721)
  // 명시적으로 '경험하지 않음'이라면 신호가 엇갈려도 제안하지 않는다(fail-closed).
  if (input.hasFirstValue === false || input.signals.firstValueReached === false) return false
  // 명시적으로 확인된 첫 가치 신호가 있을 때만 제안한다. 신호가 없거나 해석할 수 없으면
  // '아직 경험하지 않음'으로 보고 차단한다(기존 caller 가 신호를 안 넘기는 경우 포함).
  const firstValueConfirmed = input.hasFirstValue === true || input.signals.firstValueReached === true
  if (!firstValueConfirmed) return false

  // 3. 이미 설치되었거나 스탠드얼론인 경우 차단
  if (input.standalone || input.signals.installed) return false

  // 4. 플랫폼 및 지원 여부
  if (input.platform === 'other') return false
  if (input.platform === 'android-chromium' && !input.canPrompt) return false

  // 5. 사용자 영구 거부 존중
  if (input.signals.permanentlyDismissed) return false

  // 6. 거부 후 지수 백오프 존중 (1회 7일, 2회 30일, 3회 이상 90일)
  if (input.signals.dismissedAt !== null) {
    const waitMs = installSnoozeDays(input.signals.dismissCount) * DAY_MS
    if (input.now - input.signals.dismissedAt < waitMs) return false
  }
  return true
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safeStorage(storage: StorageLike | null | undefined): StorageLike | null {
  return storage ?? null
}

export function readInstallSignals(storage: StorageLike | null | undefined): InstallSignals {
  const safe = safeStorage(storage)
  if (!safe) return { dismissedAt: null, dismissCount: 0, installed: false, firstValueReached: false, permanentlyDismissed: false }
  try {
    const dismissedAtRaw = safe.getItem(PWA_STORAGE_KEYS.installDismissedAt)
    const dismissCountRaw = safe.getItem(PWA_STORAGE_KEYS.installDismissCount)
    const dismissedAt = dismissedAtRaw ? Number(dismissedAtRaw) : null
    const dismissCount = dismissCountRaw ? Number(dismissCountRaw) : 0
    return {
      dismissedAt: Number.isFinite(dismissedAt) ? dismissedAt : null,
      dismissCount: Number.isFinite(dismissCount) && dismissCount > 0 ? Math.trunc(dismissCount) : 0,
      installed: safe.getItem(PWA_STORAGE_KEYS.installed) === '1',
      firstValueReached: safe.getItem(PWA_STORAGE_KEYS.firstValueReached) === '1',
      permanentlyDismissed: safe.getItem(PWA_STORAGE_KEYS.installPermanentlyDismissed) === '1',
    }
  } catch {
    return { dismissedAt: null, dismissCount: 0, installed: false, firstValueReached: false, permanentlyDismissed: false }
  }
}

export function recordFirstValueReached(storage: StorageLike | null | undefined): void {
  const safe = safeStorage(storage)
  if (!safe) return
  try {
    safe.setItem(PWA_STORAGE_KEYS.firstValueReached, '1')
  } catch {
    // no-op
  }
}

export function recordInstallPermanentlyDismissed(storage: StorageLike | null | undefined): void {
  const safe = safeStorage(storage)
  if (!safe) return
  try {
    safe.setItem(PWA_STORAGE_KEYS.installPermanentlyDismissed, '1')
  } catch {
    // no-op
  }
}

export function recordInstallDismissed(storage: StorageLike | null | undefined, now: number): InstallSignals {
  const current = readInstallSignals(storage)
  const next: InstallSignals = { ...current, dismissedAt: now, dismissCount: current.dismissCount + 1 }
  const safe = safeStorage(storage)
  if (safe) {
    try {
      safe.setItem(PWA_STORAGE_KEYS.installDismissedAt, String(next.dismissedAt))
      safe.setItem(PWA_STORAGE_KEYS.installDismissCount, String(next.dismissCount))
    } catch {
      // 저장 공간이 막혀 있으면 이번 세션에서만 억제한다.
    }
  }
  return next
}

export function recordInstalled(storage: StorageLike | null | undefined): void {
  const safe = safeStorage(storage)
  if (!safe) return
  try {
    safe.setItem(PWA_STORAGE_KEYS.installed, '1')
    safe.removeItem(PWA_STORAGE_KEYS.installDismissedAt)
    safe.removeItem(PWA_STORAGE_KEYS.installDismissCount)
  } catch {
    // no-op
  }
}

export const INSTALL_COPY = {
  android: {
    title: '홈 화면에 소희를 추가할까요?',
    description: '앱처럼 한 번에 열고, 알림도 받을 수 있어요.',
    accept: '설치하기',
    later: '나중에',
  },
  ios: {
    title: '홈 화면에 소희를 추가할까요?',
    description: 'Safari 공유 버튼을 누르고 ‘홈 화면에 추가’를 선택하면 앱처럼 열려요.',
    accept: '설치 방법 보기',
    later: '나중에',
  },
  iosSteps: ['Safari 아래쪽의 공유 버튼을 눌러 주세요.', '목록에서 ‘홈 화면에 추가’를 선택해 주세요.', '오른쪽 위 ‘추가’를 누르면 끝나요.'],
} as const
