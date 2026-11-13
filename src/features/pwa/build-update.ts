import { normalizeBuildIdentity } from '@/lib/build-identity'
import { isStandaloneDisplay } from './install-prompt'
import { hasPendingUserInput } from './unsaved-input'

function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false
  return isStandaloneDisplay({
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
    displayModeFullscreen: window.matchMedia?.('(display-mode: fullscreen)')?.matches ?? false,
    displayModeMinimalUi: window.matchMedia?.('(display-mode: minimal-ui)')?.matches ?? false,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  })
}

/** 버전 차이는 UI 이동 힌트일 뿐, 인증·업무 상태의 정본이 아니다. 저장소에 남기지 않는다. */
export function createBuildUpdateNavigation(currentBuild: () => string | undefined, navigate: (href: string) => void) {
  let pending = false
  let checking = false
  return {
    async check(): Promise<void> {
      const local = normalizeBuildIdentity(currentBuild())
      if (checking || !isInstalledApp() || navigator.onLine === false || local === 'development') return
      checking = true
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch('/api/diagnostics/version', { method: 'GET', cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const data: unknown = await response.json()
        const value = data && typeof data === 'object' && 'buildSha' in data ? data.buildSha : undefined
        const remote = normalizeBuildIdentity(typeof value === 'string' ? value : undefined)
        pending = remote !== 'development' && remote !== local
      } catch {
        // 조회 실패는 업데이트 근거가 아니다. 기존 메뉴 이동은 계속 사용할 수 있다.
      } finally {
        clearTimeout(timeout)
        checking = false
      }
    },
    navigate(href: string): boolean {
      if (!pending || !isInstalledApp() || navigator.onLine === false || hasPendingUserInput()) return false
      const url = new URL(href, window.location.origin)
      if (!href.startsWith('/app') || href.startsWith('//') || href.includes('\\') || url.origin !== window.location.origin || !/^\/app(?:\/|$)/.test(url.pathname)) return false
      pending = false
      navigate(url.pathname + url.search + url.hash)
      return true
    },
  }
}

export const buildUpdateNavigation = createBuildUpdateNavigation(
  () => process.env.NEXT_PUBLIC_SOHEE_BUILD_SHA,
  href => window.location.assign(href),
)
