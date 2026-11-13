import type { StateKind } from '@/components/mobile-ui'

/**
 * 서버가 인증(401)·권한(403)을 거부한 두 경우(ANI-1714).
 *
 * 둘 다 '다시 확인'으로 풀리지 않으므로 일반 조회 실패(error)로 뭉개지 않는다.
 * 401 은 세션이 없거나 만료된 것, 403 은 세션은 있으나 이 가게를 볼 권한이 없는 것이다.
 * 다음 행동도 다르다 — 401 은 다시 로그인, 403 은 가게 관리자에게 권한 요청.
 */
export type AuthFailure = 'expired' | 'forbidden'

/** HTTP 상태에서만 판정한다. 500·503 등은 null 이며 일반 조회 실패로 다룬다. */
export function authFailureFromStatus(status: number): AuthFailure | null {
  if (status === 401) return 'expired'
  if (status === 403) return 'forbidden'
  return null
}

/** 화면 상태 매핑. 인증 만료와 권한 없음은 서로 다른 안내를 보여 준다. */
export function authFailureStateKind(failure: AuthFailure): StateKind {
  return failure === 'expired' ? 'session_expired' : 'unauthorized'
}

/**
 * 여러 읽기를 합칠 때의 우선순위. 하나라도 401 이면 '인증 만료'다 —
 * 다시 로그인하면 모두 풀리므로 403 안내보다 먼저 알린다.
 */
export function mergeAuthFailure(failures: ReadonlyArray<AuthFailure | null | undefined>): AuthFailure | null {
  if (failures.some(failure => failure === 'expired')) return 'expired'
  if (failures.some(failure => failure === 'forbidden')) return 'forbidden'
  return null
}
