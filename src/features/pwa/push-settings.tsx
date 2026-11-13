'use client'

import { useState, useSyncExternalStore } from 'react'
import { Bell, BellOff, Info, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StateChip, type StateChipKind } from '@/components/mobile-ui'
import {
  PUSH_CONSENT_COPY,
  readPushConsentSignals,
  recordPushPromptDismissed,
  requestPushPermission,
  resolvePushConsentView,
  getPushCapability,
  type PushCapability,
  type PushConsentSignals,
  type PushConsentView,
  type PushEnvironment,
} from './push-opt-in'
import {
  pushTokenStatusCopy,
  resolvePushTokenStatus,
  type PushTokenLookup,
  type PushTokenStatus,
} from './push-token-status'

/**
 * 잠금 화면 알림 설정 (ANI-1724, partial).
 *
 * - 권한 창은 사용자가 '알림 받기'를 누를 때만 띄운다. 앱 시작 시 자동 요청하지 않는다.
 * - '지금은 괜찮아요'는 점점 더 길게 쉰다(7 → 30 → 90일). 거부(denied)는 다시 묻지 않는다.
 * - 브라우저 허용과 서버 구독 확인은 다른 단계다. 확인 전에는 '받고 있다'로 쓰지 않는다.
 * - 구독 토큰 등록·회전·폐기는 서버 소유다. 이 컴포넌트는 조회 결과를 표시만 한다.
 */

const TOKEN_CHIP: Readonly<Record<PushTokenStatus, StateChipKind | null>> = {
  unknown: 'partial',
  not_registered: null,
  active: null,
  expiring: 'stale',
  expired: 'error',
  revoked: 'offline',
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 브라우저가 알려 주는 푸시 환경. SSR 에서는 값이 없으므로 마운트 뒤에만 읽는다. */
export function readPushEnvironment(): PushEnvironment {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const win = typeof window === 'undefined' ? null : window
  const hasNotificationApi = typeof Notification !== 'undefined'
  return {
    secureContext: win?.isSecureContext ?? false,
    hasNotificationApi,
    permission: hasNotificationApi ? Notification.permission : 'unsupported',
    isIos: /iphone|ipad|ipod/i.test(nav?.userAgent ?? ''),
    standalone: win?.matchMedia?.('(display-mode: standalone)').matches ?? false,
  }
}

export interface PushSettingsViewProps {
  /** null 이면 동의 안내를 그리지 않는다. */
  consent: PushConsentView | null
  /** 없으면 토큰 상태 줄을 그리지 않는다(서버 조회 계약이 아직 없을 때). */
  tokenStatus?: PushTokenStatus
  busy?: boolean
  message?: string | null
  onAccept?: () => void
  onDecline?: () => void
  onRetryToken?: () => void
}

/** 표시 전용. 상태 판정은 `push-opt-in` / `push-token-status` 가 이미 끝낸 값을 받는다. */
export function PushSettingsView({
  consent,
  tokenStatus,
  busy = false,
  message = null,
  onAccept,
  onDecline,
  onRetryToken,
}: PushSettingsViewProps) {
  // 안내가 접힌 뒤에도 방금 누른 결과는 남긴다. 조용히 사라지면 사용자는 반영 여부를 알 수 없다.
  if (consent === null && tokenStatus === undefined && message === null) return null

  return (
    <section aria-labelledby="push-settings-title" className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <div className="space-y-1">
        <h2 id="push-settings-title" className="text-lg font-semibold tracking-tight">
          잠금 화면 알림
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          앱을 닫아 두어도 승인·일정 소식을 알려 드려요.
        </p>
      </div>

      {consent ? <ConsentBlock consent={consent} busy={busy} onAccept={onAccept} onDecline={onDecline} /> : null}

      {tokenStatus !== undefined ? <TokenBlock status={tokenStatus} onRetry={onRetryToken} /> : null}

      {message ? (
        <p role="status" className="rounded-xl border border-border p-4 text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  )
}

function ConsentBlock({
  consent,
  busy,
  onAccept,
  onDecline,
}: {
  consent: PushConsentView
  busy: boolean
  onAccept?: () => void
  onDecline?: () => void
}) {
  if (consent.kind === 'offer') {
    return (
      <div data-push-consent="offer" className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-base font-medium">
          <Bell className="size-4" aria-hidden="true" />
          {PUSH_CONSENT_COPY.title}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">{PUSH_CONSENT_COPY.description}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={onAccept} disabled={busy} className="min-h-11 flex-1">
            {busy ? '확인하고 있어요' : PUSH_CONSENT_COPY.accept}
          </Button>
          <Button type="button" variant="outline" onClick={onDecline} disabled={busy} className="min-h-11 flex-1">
            {PUSH_CONSENT_COPY.decline}
          </Button>
        </div>
      </div>
    )
  }

  const explanation =
    consent.kind === 'needs-install'
      ? PUSH_CONSENT_COPY.needsInstall
      : consent.kind === 'denied'
        ? PUSH_CONSENT_COPY.denied
        : consent.kind === 'unsupported'
          ? PUSH_CONSENT_COPY.unsupported
          : consent.kind === 'granted_token_stale'
            ? PUSH_CONSENT_COPY.grantedTokenStale
            : consent.kind === 'granted_not_registered'
              ? PUSH_CONSENT_COPY.grantedNotRegistered
              : PUSH_CONSENT_COPY.grantedUnconfirmed

  // 거부·미지원·설치 필요·서버 미확인·서버가 확인한 미등록/만료는 모두 '아직 켜지지 않음'이다.
  // 어떤 경우에도 수신을 단정하지 않는다.
  return (
    <div data-push-consent={consent.kind} className="flex gap-3 rounded-2xl border border-border bg-card p-4">
      {consent.kind === 'granted' ? (
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <p className="text-sm leading-relaxed text-muted-foreground">{explanation}</p>
    </div>
  )
}

function TokenBlock({ status, onRetry }: { status: PushTokenStatus; onRetry?: () => void }) {
  const copy = pushTokenStatusCopy(status)
  const chip = TOKEN_CHIP[status]

  return (
    <div data-push-token={status} className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-medium">{copy.label}</p>
        {chip ? <StateChip kind={chip} /> : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
      {copy.actionLabel && onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry} className="min-h-11">
          <Info className="size-4" aria-hidden="true" />
          {copy.actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export interface PushSettingsProps {
  /**
   * 서버 구독 조회 결과. 아직 서버 읽기 계약이 없으므로 기본값은 `undefined`(상태 줄 미표시)다.
   * 넘길 때는 조회 실패를 `{ ok: false }` 로 구분해 전달해야 한다 — 빈 결과와 섞으면 안 된다.
   */
  lookup?: PushTokenLookup
  /** 서버가 구독 등록을 확인했는지. 확인 전에는 false. */
  serverConfirmed?: boolean
  onRetryToken?: () => void
}

const subscribeNoop = () => () => {}
const clientHydrated = () => true
const serverHydrated = () => false

/** 서버 렌더에서는 브라우저 권한 상태를 알 수 없다. 하이드레이션 전에는 아무것도 그리지 않는다. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, clientHydrated, serverHydrated)
}

const DECLINED_MESSAGE = '알림을 켜지 않았어요. 이 화면에서 언제든 다시 켤 수 있어요.'

/** 브라우저 환경을 읽어 `PushSettingsView` 에 넘기는 얇은 껍데기. */
export function PushSettings({ lookup, serverConfirmed = false, onRetryToken }: PushSettingsProps) {
  const hydrated = useHydrated()
  // 초기값은 하이드레이션 시점의 브라우저 상태에서 한 번만 읽는다.
  const [env, setEnv] = useState<PushEnvironment>(readPushEnvironment)
  const [signals, setSignals] = useState<PushConsentSignals>(() => readPushConsentSignals(safeStorage()))
  const [now] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!hydrated) return null

  const capability: PushCapability = getPushCapability(env)
  const tokenStatus = lookup ? resolvePushTokenStatus({ lookup, now }) : undefined
  // 서버가 확인한 토큰 상태를 동의 안내에도 넘긴다 — 확인한 사실을 '확인하지 못했다'로 뭉개지 않는다.
  const consent = resolvePushConsentView({ capability, signals, now, serverConfirmed, tokenStatus })

  function decline() {
    setSignals(recordPushPromptDismissed(safeStorage(), Date.now()))
    setMessage(DECLINED_MESSAGE)
  }

  async function accept() {
    setBusy(true)
    setMessage(null)
    const result = await requestPushPermission({
      env,
      requestPermission: () => Notification.requestPermission(),
    })
    setBusy(false)

    if (result === 'granted') {
      setEnv((prev) => ({ ...prev, permission: 'granted' }))
      return
    }
    if (result === 'denied') {
      setEnv((prev) => ({ ...prev, permission: 'denied' }))
      return
    }
    // 브라우저 창을 그냥 닫은 경우도 다시 묻지 않도록 같은 억제 규칙을 적용한다.
    if (result === 'dismissed') {
      setSignals(recordPushPromptDismissed(safeStorage(), Date.now()))
      setMessage(DECLINED_MESSAGE)
    }
  }

  return (
    <PushSettingsView
      consent={consent}
      tokenStatus={tokenStatus}
      busy={busy}
      message={message}
      onAccept={consent?.kind === 'offer' ? () => void accept() : undefined}
      onDecline={consent?.kind === 'offer' ? decline : undefined}
      onRetryToken={onRetryToken}
    />
  )
}
