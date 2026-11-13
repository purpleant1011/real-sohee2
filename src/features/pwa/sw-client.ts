import { PWA_SW_SCOPE, PWA_SW_URL } from './constants'

/**
 * 서비스 워커 클라이언트 (ANI-1717/1719/1723).
 * - 등록은 배포 빌드에서만 한다. 개발 모드에서는 이전 SW 캐시가 HMR 을 가리지 않도록 건너뛴다.
 * - 런타임이 대기 워커를 조용히 활성화한다. controllerchange로 화면을 새로고침하지 않는다.
 *   현재 입력·화면을 보존하고, 다음 문서 진입은 캐시하지 않는 최신 서버 응답을 사용한다.
 */

export type SwUpdateHandlers = {
  onUpdateReady: (worker: ServiceWorker) => void
  onControllerChange?: () => void
}

export function canUseServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export async function registerPwaServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!canUseServiceWorker()) return null
  if (process.env.NODE_ENV !== 'production') return null
  try {
    return await navigator.serviceWorker.register(PWA_SW_URL, { scope: PWA_SW_SCOPE })
  } catch {
    // 등록 실패는 앱 사용을 막지 않는다. 오프라인 안내만 제공되지 않는다.
    return null
  }
}

/** 이미 대기 중인 새 워커가 있으면 즉시 알리고, 이후 설치되는 워커도 감시한다. */
export function watchServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
  handlers: SwUpdateHandlers,
): () => void {
  let disposed = false

  const notify = (worker: ServiceWorker | null) => {
    if (!disposed && worker) handlers.onUpdateReady(worker)
  }

  if (registration.waiting && registration.active) notify(registration.waiting)

  const onUpdateFound = () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) notify(installing)
    })
  }

  registration.addEventListener('updatefound', onUpdateFound)

  const onControllerChange = () => {
    if (!disposed) handlers.onControllerChange?.()
  }
  if (canUseServiceWorker()) navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

  return () => {
    disposed = true
    registration.removeEventListener('updatefound', onUpdateFound)
    if (canUseServiceWorker()) navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }
}

/** 대기 중인 워커를 활성화한다. 페이지 새로고침은 수행하지 않는다. */
export function applyServiceWorkerUpdate(worker: ServiceWorker): void {
  worker.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * 새 워커가 화면을 제어하기 시작했을 때 한 번만 호출한다.
 * 호출부(런타임)가 1회 게이트를 책임지고, 이 함수는 새로고침만 담당한다.
 */
export function reloadPage(): void {
  if (typeof window === 'undefined') return
  window.location.reload()
}

export async function checkForServiceWorkerUpdate(registration: ServiceWorkerRegistration | null): Promise<void> {
  if (!registration) return
  try {
    await registration.update()
  } catch {
    // 오프라인이거나 서버가 응답하지 않아도 무시한다.
  }
}

/**
 * 로그아웃·매장(워크스페이스) 전환 시 캐시된 정적 자산과 셸을 비운다. 개인 데이터는 애초에 저장하지 않는다.
 * 캐시 정리 실패가 로그아웃이나 전환 자체를 막지 않도록 예외를 밖으로 던지지 않는다(ANI-1722).
 */
export async function clearPwaCaches(): Promise<void> {
  try {
    // 제어 중인 워커가 있으면 워커가 정리한다(public/sw.js 의 CLEAR_CACHES 계약).
    const controlled = canUseServiceWorker() ? navigator.serviceWorker.controller : null
    if (controlled) {
      controlled.postMessage({ type: 'CLEAR_CACHES' })
      return
    }
    // 워커가 없거나 미지원이어도 이전 등록이 남긴 캐시는 직접 비운다.
    if (typeof caches === 'undefined') return
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('sohee-')).map((key) => caches.delete(key)))
  } catch {
    // 캐시 정리에 실패해도 로그아웃·전환 흐름은 계속 진행한다.
  }
}

export function getServiceWorkerVersion(): Promise<string | null> {
  if (!canUseServiceWorker() || !navigator.serviceWorker.controller) return Promise.resolve(null)
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker.controller
    if (!controller) {
      resolve(null)
      return
    }
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(null)
    }, 1500)
    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SW_VERSION') {
        clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve(typeof event.data.version === 'string' ? event.data.version : null)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    controller.postMessage({ type: 'GET_VERSION' })
  })
}
