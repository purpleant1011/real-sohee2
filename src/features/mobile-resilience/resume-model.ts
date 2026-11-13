export type FailureKind = 'unauthorized' | 'forbidden' | 'conflict' | 'server' | 'offline' | 'rate_limited' | 'client'

export interface FailureView {
  kind: FailureKind
  title: string
  message: string
  /** 사용자가 할 다음 행동 1개. */
  next: 'sign_in' | 'ask_admin' | 'refresh_and_review' | 'retry' | 'wait_then_retry' | 'close'
  nextLabel: string
  /** 자동 재시도해도 되는지. 409·401·403 은 사람이 확인해야 하므로 false. */
  retryable: boolean
}

/** 401/403/409/5xx/오프라인을 서로 다른 다음 행동으로 나눈다. 모르는 상태는 성공으로 두지 않는다. */
export function classifyFailure(status: number | 'network'): FailureView {
  if (status === 'network' || status === 0) {
    return { kind: 'offline', title: '네트워크에 연결되지 않았어요', message: '연결되면 서버에서 다시 확인해요. 지금 보이는 내용은 최신이 아닐 수 있어요.', next: 'retry', nextLabel: '다시 확인', retryable: true }
  }
  if (status === 401) return { kind: 'unauthorized', title: '로그인이 필요해요', message: '로그인이 풀렸어요. 다시 로그인하면 보던 화면으로 돌아와요.', next: 'sign_in', nextLabel: '다시 로그인', retryable: false }
  if (status === 403) return { kind: 'forbidden', title: '이 내용을 볼 권한이 없어요', message: '가게 관리자에게 권한을 요청해 주세요.', next: 'ask_admin', nextLabel: '확인', retryable: false }
  if (status === 409) return { kind: 'conflict', title: '내용이 바뀌었어요', message: '다른 곳에서 먼저 바뀌어서 지금 내용으로 진행하지 않았어요. 바뀐 내용을 다시 확인해 주세요.', next: 'refresh_and_review', nextLabel: '바뀐 내용 확인', retryable: false }
  if (status === 429) return { kind: 'rate_limited', title: '잠시 뒤에 다시 해 주세요', message: '요청이 많아 잠깐 멈췄어요.', next: 'wait_then_retry', nextLabel: '잠시 뒤 다시', retryable: true }
  if (status >= 500) return { kind: 'server', title: '서버에서 확인하지 못했어요', message: '내용이 없는 것이 아니라 확인에 실패한 상태예요. 다시 확인해 주세요.', next: 'retry', nextLabel: '다시 확인', retryable: true }
  return { kind: 'client', title: '요청을 처리하지 못했어요', message: '잠시 뒤 다시 시도해 주세요.', next: 'close', nextLabel: '닫기', retryable: false }
}

export interface ResumeInput {
  /** 화면이 숨겨진 시각(없으면 숨겨진 적 없음). */
  hiddenAt: string | null
  now: string
  /** 마지막으로 서버에서 확인한 시각. */
  lastCheckedAt: string | null
  tenantAtHide: string | null
  tenantNow: string | null
  /** 사용자가 보던 승인/상세의 버전. 서버가 알려준 최신과 다르면 재검토. */
  versionAtOpen: number | null
  versionNow: number | null
  /** 이 시간(초)보다 오래 숨겨졌거나 확인한 지 오래되면 다시 확인한다. 기본 30초. */
  staleAfterSeconds?: number
}

export interface ResumeDecision {
  revalidate: boolean
  /** 이전 '성공/완료' 배지는 서버 재확인 전까지 숨긴다. */
  hideSuccessBadges: boolean
  /** 가게가 바뀌었거나 알 수 없으면 이전 데이터를 아예 숨긴다. */
  hideData: boolean
  /** 승인 대상 버전이 달라졌으면 재검토를 요구(409 상당). */
  requireReview: boolean
}

/**
 * 앱 복귀(뒤로가기·종료 후 복귀·두 기기) 시 로컬 캐시를 사실로 믿지 않는다.
 * 시각을 읽을 수 없으면 오래된 것으로 본다(fail-closed).
 */
export function decideResume(i: ResumeInput): ResumeDecision {
  const limit = (i.staleAfterSeconds ?? 30) * 1000
  const nowMs = Date.parse(i.now)
  const age = (iso: string | null) => (iso === null ? Infinity : Number.isNaN(Date.parse(iso)) || Number.isNaN(nowMs) ? Infinity : nowMs - Date.parse(iso))
  const away = i.hiddenAt === null ? 0 : age(i.hiddenAt)
  const tenantChanged = i.tenantAtHide === null || i.tenantNow === null || i.tenantAtHide !== i.tenantNow
  const versionChanged = i.versionAtOpen !== null && (i.versionNow === null || i.versionNow !== i.versionAtOpen)
  const revalidate = away > limit || age(i.lastCheckedAt) > limit || tenantChanged || versionChanged
  return { revalidate, hideSuccessBadges: revalidate, hideData: tenantChanged, requireReview: versionChanged }
}

/** 필터·탭 상태는 URL 에 남겨 뒤로가기·복귀 후에도 같은 화면으로 돌아오게 한다. 빈 값은 지운다. */
export function mergeRouteState(search: string, state: Record<string, string | null>): string {
  const p = new URLSearchParams(search)
  for (const [k, v] of Object.entries(state)) {
    if (v === null || v === '') p.delete(k)
    else p.set(k, v)
  }
  const out = p.toString()
  return out ? `?${out}` : ''
}
