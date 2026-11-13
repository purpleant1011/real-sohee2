'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createActionGuard } from './action-guard'
import { buildUpdateNavigation } from './build-update'
import {
  INSTALL_COPY,
  detectInstallPlatform,
  isStandaloneDisplay,
  readInstallSignals,
  recordInstallDismissed,
  recordInstalled,
  shouldOfferInstall,
  type InstallPlatform,
} from './install-prompt'
import { isSlowConnection, probeConnectivity, readOnline, useOnlineStatus } from './network'
import { shouldRevalidateOnResume, subscribeToAppResume } from './resume'
import {
  applyServiceWorkerUpdate,
  registerPwaServiceWorker,
  watchServiceWorkerUpdate,
} from './sw-client'

/** Chrome 의 설치 이벤트. lib.dom 에 없어 최소 형태만 선언한다. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const bannerShell =
  'pointer-events-auto mx-auto flex w-full max-w-md flex-col gap-2 rounded-b-2xl border border-t-0 border-border bg-foreground px-4 py-3 text-background shadow-lg'
const primaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const quietButton =
  'inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/**
 * 오프라인 배너. 온라인이 되면 언마운트되므로, 다시 끊겼을 때는 확인 결과가
 * 자동으로 초기화된다(이전 세션의 '연결 확인' 문구가 남지 않는다).
 */
function OfflineBanner() {
  const [checking, setChecking] = useState(true)
  const [recovered, setRecovered] = useState(false)

  // navigator.onLine은 OS/VPN의 힌트다. 실제 서버 연결을 한 번 확인하되 자동 이동하지 않는다.
  useEffect(() => {
    let cancelled = false
    void probeConnectivity().then(reachable => {
      if (!cancelled) {
        setRecovered(reachable)
        setChecking(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  const retryConnection = useCallback(async () => {
    setChecking(true)
    setRecovered(false)
    const reachable = await probeConnectivity()
    setChecking(false)
    setRecovered(reachable)
  }, [])

  // 연결이 확인되면 안내를 남기지 않는다. OS의 오프라인 힌트가 남아 있어도 화면을 가리지 않는다.
  if (recovered) return null

  return (
    <div className={bannerShell} role="status" aria-live="polite">
      <p className="text-sm font-semibold">네트워크에 연결할 수 없습니다</p>
      <p className="text-xs leading-relaxed">
        마지막으로 본 내용은 서버에서 다시 확인해야 해요. 연결된 뒤 다시 확인해 주세요.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={primaryButton} onClick={retryConnection} disabled={checking}>
          {checking ? '확인 중…' : '다시 확인'}
        </button>
      </div>
    </div>
  )
}

/**
 * PWA 런타임 (ANI-1716/1717/1719/1721/1723/1725).
 * 화면 콘텐츠는 건드리지 않고 상단에만 상태 배너를 띄운다.
 * 우선순위: 오프라인 > 설치 안내 > 느린 연결 — 새 버전 배너는 표시하지 않는다.
 */
export function PwaRuntime() {
  const pathname = usePathname()
  const router = useRouter()
  const online = useOnlineStatus()
  // 화면 단위 중복 실행 차단기. 메모리에만 있고 저장소에 남기지 않는다(ANI-1725).
  const [guard] = useState(createActionGuard)
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform | null>(null)
  const [iosHelpOpen, setIosHelpOpen] = useState(false)
  const [slow, setSlow] = useState(false)

  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null)

  // 1) 대기 워커는 조용히 적용한다. 현재 화면·입력을 지키기 위해 reload/refresh하지 않는다.
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    const applied = new WeakSet<ServiceWorker>()
    void registerPwaServiceWorker().then((registration) => {
      if (!registration || cancelled) return
      dispose = watchServiceWorkerUpdate(registration, {
        onUpdateReady: (worker) => {
          if (cancelled || applied.has(worker)) return
          applied.add(worker)
          applyServiceWorkerUpdate(worker)
        },
      })
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  // 2) 설치 안내. `/app` 안에서만, 거절 이력에 따라 재안내 간격을 늘린다.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const nav = navigator as Navigator & { standalone?: boolean }
    const standalone = isStandaloneDisplay({
      displayModeStandalone: window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
      displayModeFullscreen: window.matchMedia?.('(display-mode: fullscreen)')?.matches ?? false,
      displayModeMinimalUi: window.matchMedia?.('(display-mode: minimal-ui)')?.matches ?? false,
      navigatorStandalone: nav.standalone === true,
    })

    const evaluate = (canPrompt: boolean) => {
      const platform = detectInstallPlatform({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        hasBeforeInstallPrompt: canPrompt,
      })
      const offer = shouldOfferInstall({
        pathname: window.location.pathname,
        standalone,
        platform,
        canPrompt,
        signals: readInstallSignals(window.localStorage),
        now: Date.now(),
      })
      setInstallPlatform(offer ? platform : null)
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      deferredPromptRef.current = event as BeforeInstallPromptEvent
      evaluate(true)
    }
    const onInstalled = () => {
      recordInstalled(window.localStorage)
      deferredPromptRef.current = null
      setInstallPlatform(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    evaluate(Boolean(deferredPromptRef.current))

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [pathname])

  // 3) 느린 연결 안내(불량망). 온라인일 때만, 차단하지 않는 힌트로 보여 준다.
  useEffect(() => {
    const update = () => setSlow(isSlowConnection())
    update()
    const connection = (navigator as Navigator & { connection?: { addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void } }).connection
    connection?.addEventListener?.('change', update)
    return () => connection?.removeEventListener?.('change', update)
  }, [])

  // 4) 앱 복귀 재검증(ANI-1725/1862). 서버 데이터와 설치 앱의 새 빌드 유무만 조회한다.
  //    문서 교체는 입력 없는 다음 메뉴 이동에서만 한다. 외부 쓰기를 다시 보내지 않는다.
  useEffect(() => {
    const dispose = subscribeToAppResume((info) => {
      const revalidate = shouldRevalidateOnResume({
        hiddenMs: info.hiddenMs,
        online: readOnline(),
        pathname: window.location.pathname,
      })
      if (!revalidate) return
      void buildUpdateNavigation.check()
      router.refresh()
    })
    return dispose
  }, [router])

  const dismissInstall = useCallback(() => {
    recordInstallDismissed(window.localStorage, Date.now())
    setInstallPlatform(null)
    setIosHelpOpen(false)
  }, [])

  // 두 번 눌러도 한 번만 실행한다(ANI-1725). 설치 프롬프트는 되돌릴 수 없다.
  const acceptInstall = useCallback(async () => {
    await guard.run('install', async () => {
      if (installPlatform === 'ios-safari') {
        setIosHelpOpen(true)
        return
      }
      const promptEvent = deferredPromptRef.current
      if (!promptEvent) return
      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        deferredPromptRef.current = null
        if (choice.outcome === 'accepted') {
          recordInstalled(window.localStorage)
          setInstallPlatform(null)
        } else {
          dismissInstall()
        }
      } catch {
        deferredPromptRef.current = null
        setInstallPlatform(null)
      }
    })
  }, [dismissInstall, guard, installPlatform])

  const showOffline = !online
  const showInstall = !showOffline && installPlatform !== null
  const showSlow = !showOffline && !showInstall && slow

  if (!showOffline && !showInstall && !showSlow) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col pt-[var(--safe-area-top)]">
      {showOffline ? <OfflineBanner /> : null}

      {showInstall && installPlatform ? (
        <div className={bannerShell} role="region" aria-label="설치 안내">
          <p className="text-sm font-semibold">{INSTALL_COPY.android.title}</p>
          <p className="text-xs leading-relaxed">
            {installPlatform === 'ios-safari' ? INSTALL_COPY.ios.description : INSTALL_COPY.android.description}
          </p>
          {iosHelpOpen && installPlatform === 'ios-safari' ? (
            <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed">
              {INSTALL_COPY.iosSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          <div className="flex items-center gap-2">
            <button type="button" className={primaryButton} onClick={acceptInstall}>
              {installPlatform === 'ios-safari' ? INSTALL_COPY.ios.accept : INSTALL_COPY.android.accept}
            </button>
            <button type="button" className={quietButton} onClick={dismissInstall}>
              {INSTALL_COPY.android.later}
            </button>
          </div>
        </div>
      ) : null}

      {showSlow ? (
        <div className={bannerShell} role="status" aria-live="polite">
          <p className="text-sm font-semibold">인터넷 연결이 느려요</p>
          <p className="text-xs leading-relaxed">화면이 늦게 열릴 수 있어요. 보낸 작업은 서버에서 다시 확인해 주세요.</p>
        </div>
      ) : null}
    </div>
  )
}
