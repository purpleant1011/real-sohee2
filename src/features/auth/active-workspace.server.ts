import { cookies, headers } from 'next/headers'
import {
  ACTIVE_WORKSPACE_COOKIE,
  buildActiveWorkspaceCookie,
  normalizeActiveWorkspacePreference,
} from './active-workspace'

/**
 * 서버 렌더(layout·페이지)에서 지금 열 가게의 쿠키 선호값을 읽는다.
 * 쿠키 저장소를 읽을 수 없는 환경(정적 렌더 등)에서는 "선택 없음"으로 처리하고 첫 활성 가게를 쓴다.
 */
export async function readPreferredWorkspaceIdFromCookies(): Promise<string | null> {
  try {
    const store = await cookies()
    return normalizeActiveWorkspacePreference(store.get(ACTIVE_WORKSPACE_COOKIE)?.value)
  } catch {
    return null
  }
}

/** 멤버십 재검증을 통과한 가게만 이 함수로 저장한다(호출부 책임). */
export async function persistActiveWorkspaceCookie(workspaceId: string): Promise<void> {
  const store = await cookies()
  let host: string | null = null
  try {
    const requestHeaders = await headers()
    host = requestHeaders.get('host')
  } catch {
    // ignore
  }
  store.set(buildActiveWorkspaceCookie(workspaceId, { host }))
}

