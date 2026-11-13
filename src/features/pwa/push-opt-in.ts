import { PWA_STORAGE_KEYS } from './constants'
import type { PushTokenStatus } from './push-token-status'

/**
 * 푸시 동의 계약 (ANI-1724).
 * - 권한 요청은 절대 앱 시작 시 자동으로 하지 않는다. 사용자가 명시적으로 누를 때만 요청한다.
 * - 구독 토큰은 서버가 발급/회전/해제한다. 이 모듈은 브라우저 권한 상태만 다루고
 *   구독 등록은 서버 API 계약(src/features/pwa/push-opt-in.ts 문서 주석)이 준비된 뒤 연결한다.
 * - 알림 문구는 서비스 워커가 종류별 고정 문구만 사용한다(고객명/본문/금액 미포함).
 */

export type PushCapability = 'unsupported' | 'needs-install' | 'prompt' | 'granted' | 'denied'

export type PushEnvironment = {
  secureContext: boolean
  hasNotificationApi: boolean
  permission: NotificationPermission | 'unsupported'
  isIos: boolean
  standalone: boolean
}

export function getPushCapability(env: PushEnvironment): PushCapability {
  if (!env.secureContext || !env.hasNotificationApi) return 'unsupported'
  if (env.isIos && !env.standalone) return 'needs-install'
  if (env.permission === 'granted') return 'granted'
  if (env.permission === 'denied') return 'denied'
  return 'prompt'
}

export type PushEnableResult = 'granted' | 'denied' | 'unsupported' | 'needs-install' | 'dismissed'

/**
 * 사용자가 '알림 받기'를 눌렀을 때만 호출한다.
 * 결과가 granted 여도 서버 구독 등록은 별도 단계이며, 서버 응답 없이 '받고 있다'고 표시하지 않는다.
 */
export async function requestPushPermission(input: {
  env: PushEnvironment
  requestPermission: () => Promise<NotificationPermission>
}): Promise<PushEnableResult> {
  const capability = getPushCapability(input.env)
  if (capability === 'unsupported') return 'unsupported'
  if (capability === 'needs-install') return 'needs-install'
  if (capability === 'granted') return 'granted'
  if (capability === 'denied') return 'denied'
  try {
    const result = await input.requestPermission()
    return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'dismissed'
  } catch {
    return 'dismissed'
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** '나중에'를 누른 사용자는 점점 더 길게 다시 묻지 않는다. 1회 7일 → 2회 30일 → 3회 이상 90일. */
export const PUSH_PROMPT_SNOOZE_DAYS = [7, 30, 90] as const

const DAY_MS = 24 * 60 * 60 * 1000

export interface PushConsentSignals {
  dismissedAt: number | null
  dismissCount: number
}

export const EMPTY_PUSH_CONSENT_SIGNALS: PushConsentSignals = Object.freeze({
  dismissedAt: null,
  dismissCount: 0,
})

export function pushSnoozeDays(dismissCount: number): number {
  const index = Math.min(Math.max(Math.trunc(dismissCount), 1), PUSH_PROMPT_SNOOZE_DAYS.length) - 1
  return PUSH_PROMPT_SNOOZE_DAYS[index]
}

/**
 * 브라우저 권한 창을 다시 띄워도 되는지. 거부(denied)는 여기서 되살리지 않는다 —
 * 브라우저가 이미 거절을 기억하므로 다시 물어도 소용없고, 사용자를 성가시게 한다.
 */
export function shouldOfferPush(input: {
  capability: PushCapability
  signals: PushConsentSignals
  now: number
}): boolean {
  if (input.capability !== 'prompt') return false
  const { dismissedAt, dismissCount } = input.signals
  if (dismissedAt === null) return true
  return input.now - dismissedAt >= pushSnoozeDays(dismissCount) * DAY_MS
}

export function recordPushPromptDismissed(
  storage: StorageLike | null | undefined,
  now: number,
): PushConsentSignals {
  const current = readPushConsentSignals(storage)
  const next: PushConsentSignals = { dismissedAt: now, dismissCount: current.dismissCount + 1 }
  if (!storage) return next
  try {
    storage.setItem(PWA_STORAGE_KEYS.pushPromptDismissedAt, String(next.dismissedAt))
    storage.setItem(PWA_STORAGE_KEYS.pushPromptDismissCount, String(next.dismissCount))
  } catch {
    // 저장 공간이 막혀 있으면 이번 세션에서만 억제한다.
  }
  return next
}

export function readPushConsentSignals(storage: StorageLike | null | undefined): PushConsentSignals {
  if (!storage) return EMPTY_PUSH_CONSENT_SIGNALS
  try {
    const rawAt = storage.getItem(PWA_STORAGE_KEYS.pushPromptDismissedAt)
    const rawCount = storage.getItem(PWA_STORAGE_KEYS.pushPromptDismissCount)
    const dismissedAt = rawAt === null || rawAt === '' ? null : Number(rawAt)
    const dismissCount = rawCount === null || rawCount === '' ? 0 : Number(rawCount)
    return {
      dismissedAt: dismissedAt !== null && Number.isFinite(dismissedAt) ? dismissedAt : null,
      dismissCount: Number.isFinite(dismissCount) && dismissCount > 0 ? Math.trunc(dismissCount) : 0,
    }
  } catch {
    return EMPTY_PUSH_CONSENT_SIGNALS
  }
}

export function readPushPromptDismissedAt(storage: StorageLike | null | undefined): number | null {
  return readPushConsentSignals(storage).dismissedAt
}

/**
 * 알림 설정 화면이 그릴 상태. `null` = 아무것도 그리지 않는다.
 *
 * 정직성 규칙:
 * - `granted` 는 '브라우저가 허용함'일 뿐이다. 서버가 구독을 확인하기 전에는
 *   '알림을 받고 있다'로 읽히는 문구를 쓰지 않는다(`serverConfirmed: false`).
 * - `denied` 는 브라우저 설정 안내만 준다. 여기서 권한을 다시 요청하지 않는다.
 */
export type PushConsentView =
  | { kind: 'offer' }
  | { kind: 'needs-install' }
  | { kind: 'denied' }
  | { kind: 'unsupported' }
  | { kind: 'granted'; serverConfirmed: boolean }
  /** 서버가 만료·폐기·곧 만료를 확인했다. "확인하지 못했어요"로 뭉개지 않는다. */
  | { kind: 'granted_token_stale'; tokenStatus: 'expiring' | 'expired' | 'revoked' }
  /** 서버가 '등록된 구독 없음'을 확인했다. */
  | { kind: 'granted_not_registered' }

export function resolvePushConsentView(input: {
  capability: PushCapability
  signals: PushConsentSignals
  now: number
  /** 서버가 구독 등록을 확인했는지. 확인 전에는 false. */
  serverConfirmed: boolean
  /** 서버가 확인한 구독 토큰 상태. 조회하지 않았거나 실패했으면 넘기지 않는다. */
  tokenStatus?: PushTokenStatus
}): PushConsentView | null {
  switch (input.capability) {
    case 'unsupported':
      return { kind: 'unsupported' }
    case 'needs-install':
      return { kind: 'needs-install' }
    case 'denied':
      return { kind: 'denied' }
    case 'granted': {
      // 서버가 상태를 확인해 줬으면 그 판정을 그대로 말한다. 확인한 사실을 '못했다'로 뭉개지 않는다.
      switch (input.tokenStatus) {
        case 'active':
          return null
        case 'expiring':
        case 'expired':
        case 'revoked':
          return { kind: 'granted_token_stale', tokenStatus: input.tokenStatus }
        case 'not_registered':
          return { kind: 'granted_not_registered' }
        default:
          // 조회 실패(unknown)·미조회(undefined): 서버 확인까지 끝났으면 더 안내할 것이 없다.
          return input.serverConfirmed ? null : { kind: 'granted', serverConfirmed: false }
      }
    }
    case 'prompt':
      return shouldOfferPush(input) ? { kind: 'offer' } : null
  }
}

/** 사용자에게 보여줄 동의 문구. 목적과 개인정보 처리 범위를 먼저 설명한다. */
export const PUSH_CONSENT_COPY = {
  title: '알림 받기',
  description: '승인이 필요하거나 확인할 일이 생겼을 때만 알려드려요. 고객 이름과 메시지 내용은 알림에 담지 않아요.',
  accept: '알림 받기',
  decline: '지금은 괜찮아요',
  needsInstall: '아이폰에서는 홈 화면에 추가한 뒤에 알림을 켤 수 있어요.',
  denied: '브라우저 설정에서 알림을 허용해야 켤 수 있어요. 이 화면에서는 다시 묻지 않아요.',
  unsupported: '이 브라우저에서는 알림을 지원하지 않아요. 앱 안 알림으로 안내해 드릴게요.',
  /** 브라우저 허용과 서버 확인은 다른 단계다. 확인 전에 '받고 있다'로 쓰지 않는다. */
  grantedUnconfirmed: '브라우저에서 알림을 허용했어요. 알림 발송 준비 상태는 아직 확인하지 못했어요.',
  /** 서버가 '등록된 구독 없음'을 확인한 경우. '확인하지 못했다'가 아니라 '없다'이다. */
  grantedNotRegistered: '브라우저에서는 알림을 허용했어요. 알림 연결은 아직 등록되어 있지 않아요.',
  /** 서버가 만료·폐기·곧 만료를 확인한 경우. 확인한 사실을 숨기지 않는다. */
  grantedTokenStale: '브라우저에서는 알림을 허용했어요. 알림 연결이 만료되었거나 해제되어 다시 연결해야 해요.',
} as const
