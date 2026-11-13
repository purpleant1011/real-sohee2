import { describe, expect, it } from 'vitest'
import {
  detectInstallPlatform,
  installSnoozeDays,
  isStandaloneDisplay,
  readInstallSignals,
  recordFirstValueReached,
  recordInstallDismissed,
  recordInstallPermanentlyDismissed,
  recordInstalled,
  shouldOfferInstall,
  type InstallOfferInput,
} from '../install-prompt'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 22, 3, 0, 0)

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

function offer(overrides: Partial<InstallOfferInput> = {}): InstallOfferInput {
  return {
    pathname: '/app',
    standalone: false,
    platform: 'android-chromium',
    canPrompt: true,
    signals: {
      dismissedAt: null,
      dismissCount: 0,
      installed: false,
      firstValueReached: true,
      permanentlyDismissed: false,
    },
    now: NOW,
    hasFirstValue: true,
    ...overrides,
  }
}

describe('install prompt policy', () => {
  it('classifies Android, iPhone and other browsers without guessing', () => {
    expect(detectInstallPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', hasBeforeInstallPrompt: true })).toBe('android-chromium')
    expect(detectInstallPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', hasBeforeInstallPrompt: false })).toBe('ios-safari')
    expect(detectInstallPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', hasBeforeInstallPrompt: false })).toBe('ios-safari')
    expect(detectInstallPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5, hasBeforeInstallPrompt: false })).toBe('ios-safari')
    expect(detectInstallPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', hasBeforeInstallPrompt: false })).toBe('other')
  })

  it('treats installed display modes as standalone', () => {
    expect(isStandaloneDisplay({ displayModeStandalone: true, displayModeFullscreen: false, displayModeMinimalUi: false })).toBe(true)
    expect(isStandaloneDisplay({ displayModeStandalone: false, displayModeFullscreen: false, displayModeMinimalUi: false, navigatorStandalone: true })).toBe(true)
    expect(isStandaloneDisplay({ displayModeStandalone: false, displayModeFullscreen: false, displayModeMinimalUi: false })).toBe(false)
  })

  it('offers install only inside the app and when a real install action exists', () => {
    expect(shouldOfferInstall(offer())).toBe(true)
    expect(shouldOfferInstall(offer({ pathname: '/login' }))).toBe(false)
    expect(shouldOfferInstall(offer({ pathname: null }))).toBe(false)
    expect(shouldOfferInstall(offer({ standalone: true }))).toBe(false)
    expect(shouldOfferInstall(offer({ signals: { dismissedAt: null, dismissCount: 0, installed: true, firstValueReached: true } }))).toBe(false)
    // Android 는 beforeinstallprompt 를 받았을 때만 네이티브 설치 창을 띄울 수 있다.
    expect(shouldOfferInstall(offer({ canPrompt: false }))).toBe(false)
    // iOS Safari 는 설치 API 가 없어도 안내 자체는 보여 준다.
    expect(shouldOfferInstall(offer({ platform: 'ios-safari', canPrompt: false }))).toBe(true)
    expect(shouldOfferInstall(offer({ platform: 'other' }))).toBe(false)
  })

  it('blocks install offer before first value is reached (ANI-1721 결함 복구)', () => {
    // 첫 가치를 아직 경험하지 않았으면 설치 제안을 차단한다.
    expect(shouldOfferInstall(offer({ hasFirstValue: false }))).toBe(false)
    // 첫 가치 신호가 확인된 경우 설치 제안 허용
    expect(shouldOfferInstall(offer({ hasFirstValue: true }))).toBe(true)
  })

  it('신호가 없거나 해석할 수 없으면 설치 제안하지 않는다 (fail-closed)', () => {
    // hasFirstValue 를 넘기지 않는 기존 caller: 첫 가치 미확인이므로 차단해야 한다.
    expect(
      shouldOfferInstall(
        offer({
          hasFirstValue: undefined,
          signals: { dismissedAt: null, dismissCount: 0, installed: false },
        }),
      ),
    ).toBe(false)

    // signals.firstValueReached 가 명시적으로 false 인 경우도 차단한다.
    expect(
      shouldOfferInstall(
        offer({
          hasFirstValue: undefined,
          signals: { dismissedAt: null, dismissCount: 0, installed: false, firstValueReached: false },
        }),
      ),
    ).toBe(false)

    // 명시적으로 확인된 신호(signals.firstValueReached === true)만 허용한다.
    expect(
      shouldOfferInstall(
        offer({
          hasFirstValue: undefined,
          signals: { dismissedAt: null, dismissCount: 0, installed: false, firstValueReached: true },
        }),
      ),
    ).toBe(true)
  })

  it('suppresses install offer on active input/onboarding flows (/app/onboarding, /app/work/new)', () => {
    // 작업에 집중해야 하는 화면에서는 설치 유도를 억제한다.
    expect(shouldOfferInstall(offer({ pathname: '/app/onboarding' }))).toBe(false)
    expect(shouldOfferInstall(offer({ pathname: '/app/onboarding/store' }))).toBe(false)
    expect(shouldOfferInstall(offer({ pathname: '/app/work/new' }))).toBe(false)

    // 일반 탐색 화면에서는 허용
    expect(shouldOfferInstall(offer({ pathname: '/app' }))).toBe(true)
    expect(shouldOfferInstall(offer({ pathname: '/app/channels' }))).toBe(true)
    expect(shouldOfferInstall(offer({ pathname: '/app/inbox' }))).toBe(true)
  })

  it('respects permanent dismissal signals completely', () => {
    expect(
      shouldOfferInstall(
        offer({
          signals: {
            dismissedAt: null,
            dismissCount: 0,
            installed: false,
            permanentlyDismissed: true,
          },
        }),
      ),
    ).toBe(false)
  })

  it('backs off longer after each dismissal', () => {
    expect(installSnoozeDays(0)).toBe(7)
    expect(installSnoozeDays(1)).toBe(7)
    expect(installSnoozeDays(2)).toBe(30)
    expect(installSnoozeDays(3)).toBe(90)
    expect(installSnoozeDays(9)).toBe(90)

    const signals = { dismissedAt: NOW - 6 * DAY, dismissCount: 1, installed: false, firstValueReached: true }
    expect(shouldOfferInstall(offer({ signals }))).toBe(false)
    expect(shouldOfferInstall(offer({ signals: { ...signals, dismissedAt: NOW - 8 * DAY } }))).toBe(true)

    const twice = { dismissedAt: NOW - 8 * DAY, dismissCount: 2, installed: false, firstValueReached: true }
    expect(shouldOfferInstall(offer({ signals: twice }))).toBe(false)
    expect(shouldOfferInstall(offer({ signals: { ...twice, dismissedAt: NOW - 31 * DAY } }))).toBe(true)
  })

  it('records dismissals and installation without storing anything else', () => {
    const storage = new MemoryStorage()
    expect(readInstallSignals(storage)).toEqual({
      dismissedAt: null,
      dismissCount: 0,
      installed: false,
      firstValueReached: false,
      permanentlyDismissed: false,
    })

    recordInstallDismissed(storage, NOW)
    expect(readInstallSignals(storage)).toEqual({
      dismissedAt: NOW,
      dismissCount: 1,
      installed: false,
      firstValueReached: false,
      permanentlyDismissed: false,
    })
    recordInstallDismissed(storage, NOW + DAY)
    expect(readInstallSignals(storage)).toEqual({
      dismissedAt: NOW + DAY,
      dismissCount: 2,
      installed: false,
      firstValueReached: false,
      permanentlyDismissed: false,
    })

    recordFirstValueReached(storage)
    expect(readInstallSignals(storage).firstValueReached).toBe(true)

    recordInstallPermanentlyDismissed(storage)
    expect(readInstallSignals(storage).permanentlyDismissed).toBe(true)

    recordInstalled(storage)
    expect(readInstallSignals(storage).installed).toBe(true)
    expect(readInstallSignals(storage).dismissedAt).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    expect(readInstallSignals(null)).toEqual({
      dismissedAt: null,
      dismissCount: 0,
      installed: false,
      firstValueReached: false,
      permanentlyDismissed: false,
    })
    expect(() => recordInstallDismissed(undefined, NOW)).not.toThrow()
    expect(() => recordInstalled(null)).not.toThrow()
    expect(() => recordFirstValueReached(null)).not.toThrow()
    expect(() => recordInstallPermanentlyDismissed(null)).not.toThrow()

    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readInstallSignals(broken)).toEqual({
      dismissedAt: null,
      dismissCount: 0,
      installed: false,
      firstValueReached: false,
      permanentlyDismissed: false,
    })
    expect(() => recordInstallDismissed(broken, NOW)).not.toThrow()
  })
})
