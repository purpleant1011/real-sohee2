const KEY = 'sohee:stale-deploy-reload-at'
const WINDOW_MS = 60_000

/** 배포 직후 낡은 화면의 서버 액션 호출이 예외로 끝났을 때 한 번만 새로고침한다. 새로고침했으면 true. */
export function reloadOnceForStaleDeploy(now = Date.now()): boolean {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(window.sessionStorage.getItem(KEY) ?? 0)
    if (last && now - last < WINDOW_MS) return false
    window.sessionStorage.setItem(KEY, String(now))
    window.location.reload()
    return true
  } catch {
    return false
  }
}
