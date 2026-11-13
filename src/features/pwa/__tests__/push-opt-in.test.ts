import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_PUSH_CONSENT_SIGNALS,
  PUSH_CONSENT_COPY,
  PUSH_PROMPT_SNOOZE_DAYS,
  getPushCapability,
  pushSnoozeDays,
  readPushConsentSignals,
  readPushPromptDismissedAt,
  recordPushPromptDismissed,
  requestPushPermission,
  resolvePushConsentView,
  shouldOfferPush,
  type PushEnvironment,
} from '../push-opt-in'

const env = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  secureContext: true,
  hasNotificationApi: true,
  permission: 'default',
  isIos: false,
  standalone: false,
  ...overrides,
})

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 22)

describe('push capability', () => {
  it('reports unsupported, needs-install, denied and granted states distinctly', () => {
    expect(getPushCapability(env({ secureContext: false }))).toBe('unsupported')
    expect(getPushCapability(env({ hasNotificationApi: false }))).toBe('unsupported')
    expect(getPushCapability(env({ isIos: true, standalone: false }))).toBe('needs-install')
    expect(getPushCapability(env({ isIos: true, standalone: true }))).toBe('prompt')
    expect(getPushCapability(env({ permission: 'denied' }))).toBe('denied')
    expect(getPushCapability(env({ permission: 'granted' }))).toBe('granted')
    expect(getPushCapability(env())).toBe('prompt')
  })

  it('asks the browser only when the user explicitly opts in', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    await expect(requestPushPermission({ env: env(), requestPermission })).resolves.toBe('granted')
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('does not call the browser prompt when it cannot succeed', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    await expect(requestPushPermission({ env: env({ permission: 'granted' }), requestPermission })).resolves.toBe('granted')
    await expect(requestPushPermission({ env: env({ permission: 'denied' }), requestPermission })).resolves.toBe('denied')
    await expect(requestPushPermission({ env: env({ isIos: true }), requestPermission })).resolves.toBe('needs-install')
    await expect(requestPushPermission({ env: env({ hasNotificationApi: false }), requestPermission })).resolves.toBe('unsupported')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('treats a dismissed browser prompt as dismissed, not denied', async () => {
    await expect(
      requestPushPermission({ env: env(), requestPermission: vi.fn().mockResolvedValue('default') }),
    ).resolves.toBe('dismissed')
    await expect(
      requestPushPermission({
        env: env(),
        requestPermission: vi.fn().mockRejectedValue(new Error('blocked')),
      }),
    ).resolves.toBe('dismissed')
  })
})

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

describe('push prompt frequency', () => {
  it('offers only when permission can be asked and the snooze has passed', () => {
    const fresh = EMPTY_PUSH_CONSENT_SIGNALS
    expect(shouldOfferPush({ capability: 'prompt', signals: fresh, now: NOW })).toBe(true)
    expect(shouldOfferPush({ capability: 'denied', signals: fresh, now: NOW })).toBe(false)
    expect(shouldOfferPush({ capability: 'granted', signals: fresh, now: NOW })).toBe(false)
    expect(shouldOfferPush({ capability: 'needs-install', signals: fresh, now: NOW })).toBe(false)
    expect(shouldOfferPush({ capability: 'unsupported', signals: fresh, now: NOW })).toBe(false)

    const snoozeMs = PUSH_PROMPT_SNOOZE_DAYS[0] * DAY
    const dismissed = { dismissedAt: NOW - snoozeMs + DAY, dismissCount: 1 }
    expect(shouldOfferPush({ capability: 'prompt', signals: dismissed, now: NOW })).toBe(false)
    expect(shouldOfferPush({ capability: 'prompt', signals: { ...dismissed, dismissedAt: NOW - snoozeMs }, now: NOW })).toBe(true)
  })

  it('waits longer each time the user declines', () => {
    expect(pushSnoozeDays(1)).toBe(7)
    expect(pushSnoozeDays(2)).toBe(30)
    expect(pushSnoozeDays(3)).toBe(90)
    expect(pushSnoozeDays(99)).toBe(90)

    // 두 번째 거절 뒤에는 7일이 지나도 다시 묻지 않는다.
    const second = { dismissedAt: NOW - 8 * DAY, dismissCount: 2 }
    expect(shouldOfferPush({ capability: 'prompt', signals: second, now: NOW })).toBe(false)
    expect(shouldOfferPush({ capability: 'prompt', signals: { ...second, dismissedAt: NOW - 30 * DAY }, now: NOW })).toBe(true)
  })

  it('stores the dismissal timestamp and count', () => {
    const storage = memoryStorage()
    recordPushPromptDismissed(storage, NOW)
    expect(readPushPromptDismissedAt(storage)).toBe(NOW)
    expect(readPushConsentSignals(storage)).toEqual({ dismissedAt: NOW, dismissCount: 1 })
    expect([...storage.map.values()]).toEqual(expect.arrayContaining([String(NOW), '1']))

    recordPushPromptDismissed(storage, NOW + DAY)
    expect(readPushConsentSignals(storage)).toEqual({ dismissedAt: NOW + DAY, dismissCount: 2 })

    expect(readPushPromptDismissedAt(null)).toBeNull()
    expect(readPushConsentSignals(null)).toEqual(EMPTY_PUSH_CONSENT_SIGNALS)
  })

  it('treats unreadable storage as "never asked" instead of throwing', () => {
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readPushConsentSignals(broken)).toEqual(EMPTY_PUSH_CONSENT_SIGNALS)
    // 저장이 막혀도 이번 세션 억제값은 돌려준다.
    expect(recordPushPromptDismissed(broken, NOW)).toEqual({ dismissedAt: NOW, dismissCount: 1 })
  })

  it('ignores a corrupted dismissal timestamp', () => {
    const storage = memoryStorage()
    storage.setItem('sohee-pwa-push-dismissed-at', 'not-a-number')
    storage.setItem('sohee-pwa-push-dismiss-count', '-3')
    expect(readPushConsentSignals(storage)).toEqual({ dismissedAt: null, dismissCount: 0 })
  })

  it('explains the purpose and that personal content is excluded', () => {
    expect(PUSH_CONSENT_COPY.description).toContain('고객 이름과 메시지 내용은 알림에 담지 않아요')
    expect(PUSH_CONSENT_COPY.description).toContain('필요하거나')
  })
})

describe('consent view — 거부를 존중하고 수신을 단정하지 않는다', () => {
  const fresh = EMPTY_PUSH_CONSENT_SIGNALS

  it('asks only when the browser can still be asked', () => {
    expect(resolvePushConsentView({ capability: 'prompt', signals: fresh, now: NOW, serverConfirmed: false }))
      .toEqual({ kind: 'offer' })
    expect(resolvePushConsentView({ capability: 'prompt', signals: { dismissedAt: NOW - DAY, dismissCount: 1 }, now: NOW, serverConfirmed: false }))
      .toBeNull()
  })

  it('never re-prompts after the user denied in the browser', () => {
    expect(resolvePushConsentView({ capability: 'denied', signals: fresh, now: NOW, serverConfirmed: false }))
      .toEqual({ kind: 'denied' })
    // 거부는 시간이 지나도 되살아나지 않는다.
    expect(resolvePushConsentView({ capability: 'denied', signals: { dismissedAt: NOW - 365 * DAY, dismissCount: 5 }, now: NOW, serverConfirmed: false }))
      .toEqual({ kind: 'denied' })
  })

  it('keeps browser-granted separate from server-confirmed', () => {
    expect(resolvePushConsentView({ capability: 'granted', signals: fresh, now: NOW, serverConfirmed: false }))
      .toEqual({ kind: 'granted', serverConfirmed: false })
    expect(resolvePushConsentView({ capability: 'granted', signals: fresh, now: NOW, serverConfirmed: true }))
      .toBeNull()
  })

  it('explains install and unsupported cases instead of hiding them', () => {
    expect(resolvePushConsentView({ capability: 'needs-install', signals: fresh, now: NOW, serverConfirmed: false }))
      .toEqual({ kind: 'needs-install' })
    expect(resolvePushConsentView({ capability: 'unsupported', signals: fresh, now: NOW, serverConfirmed: false }))
      .toEqual({ kind: 'unsupported' })
  })
})

describe('consent view — 서버 토큰 상태와 어긋나지 않게 말한다 (ANI-1724)', () => {
  const fresh = EMPTY_PUSH_CONSENT_SIGNALS
  const view = (tokenStatus?: 'unknown' | 'not_registered' | 'active' | 'expiring' | 'expired' | 'revoked') =>
    resolvePushConsentView({ capability: 'granted', signals: fresh, now: NOW, serverConfirmed: false, tokenStatus })

  it('서버가 확인한 active 는 더 안내하지 않는다', () => {
    expect(view('active')).toBeNull()
  })

  it('서버가 만료·폐기·곧 만료를 확인했으면 "확인하지 못했어요"라고 말하지 않는다', () => {
    // 확인했는데 못했다고 말하면 거짓이다. 만료/폐기는 다시 연결로 안내한다.
    for (const stale of ['expiring', 'expired', 'revoked'] as const) {
      expect(view(stale)).toEqual({ kind: 'granted_token_stale', tokenStatus: stale })
    }
  })

  it('서버가 등록 없음을 확인했으면 등록 없음으로 말한다', () => {
    expect(view('not_registered')).toEqual({ kind: 'granted_not_registered' })
  })

  it('조회 실패(unknown)나 미조회(undefined)만 "확인하지 못했어요"로 남긴다', () => {
    expect(view('unknown')).toEqual({ kind: 'granted', serverConfirmed: false })
    expect(view(undefined)).toEqual({ kind: 'granted', serverConfirmed: false })
  })

  it('브라우저 권한이 granted 가 아니면 토큰 상태가 안내 문구를 바꾸지 않는다', () => {
    expect(resolvePushConsentView({ capability: 'denied', signals: fresh, now: NOW, serverConfirmed: false, tokenStatus: 'expired' }))
      .toEqual({ kind: 'denied' })
    expect(resolvePushConsentView({ capability: 'prompt', signals: fresh, now: NOW, serverConfirmed: false, tokenStatus: 'expired' }))
      .toEqual({ kind: 'offer' })
  })
})
