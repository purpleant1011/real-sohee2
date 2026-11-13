/**
 * 공통 상태 연결 — 실서버 응답의 상태를 화면 상태(6종)로 옮기는 경계.
 *
 * `classifyCommonError` 는 에러 전용이다. 2xx·204·빈 목록·부분·오래됨은 에러가 아니므로
 * 이 경계에서 먼저 갈라낸다. 모르는 상태는 성공도 0건도 아닌 '확인 실패'로 둔다(fail-closed).
 *
 * 수용 기준 6상태 = 권한 없음 · 부분데이터 · 만료 · 진행 · 실패 · 되돌아옴.
 */
import type { StateKind } from '@/components/mobile-ui'
import { classifyCommonError, readErrorEnvelope, type CommonError, type ServerErrorEnvelope } from './error-model'

/** 성공 계열. `ready` 는 내용이 온전히 확인된 상태다. */
export type LinkageSuccessKind = Extract<StateKind, 'ready' | 'confirmed_empty' | 'partial' | 'stale' | 'loading'>

export interface LinkageSuccess {
  kind: LinkageSuccessKind
  /** 화면에 그릴 한국어 문구. 서버 원문은 쓰지 않는다. */
  title: string
  description: string
  /** 확인 시각(ISO)이 있으면 화면이 '마지막 확인'으로 그린다. */
  checkedAt: string | null
  /** 진단용. 화면에 렌더하지 않는다. */
  status: number | null
  envelope: ServerErrorEnvelope
}

export type CommonState = LinkageSuccess | CommonError

export const isFailure = (state: CommonState): state is CommonError => 'action' in state

export interface ServerResponseInput {
  status: number
  body?: unknown
  /** 서버가 내려준 '이 응답이 완전한가'. false 면 부분이다. */
  complete?: boolean | null
  /** 서버가 내려준 신선도. 'stale' 이면 이전에 확인한 내용이다. */
  loadState?: string | null
  /** 목록을 실제로 조회했을 때 확인된 항목 수. 0 이면 빈 목록이다. */
  itemCount?: number | null
  checkedAt?: string | null
}

const success = (
  kind: LinkageSuccessKind,
  copy: { title: string; description: string },
  input: ServerResponseInput,
): LinkageSuccess => ({
  kind,
  title: copy.title,
  description: copy.description,
  checkedAt: input.checkedAt ?? null,
  status: input.status,
  envelope: readErrorEnvelope(input.body),
})

const COPY: Record<LinkageSuccessKind, { title: string; description: string }> = {
  ready: { title: '확인했어요', description: '서버에서 확인한 내용이에요.' },
  confirmed_empty: { title: '아직 아무것도 없어요', description: '확인해 보니 해당하는 내용이 없습니다.' },
  partial: { title: '일부만 불러왔어요', description: '나머지는 다시 확인하고 있어요. 보이는 내용은 확인된 것만입니다.' },
  stale: { title: '이전에 확인한 내용이에요', description: '최신 상태는 다시 확인해야 해요.' },
  loading: { title: '확인하는 중이에요', description: '서버에서 내용을 확인하고 있어요.' },
}

/**
 * HTTP 응답 하나를 화면 상태로 옮긴다.
 *
 * - 2xx 를 에러 문구로 떨어뜨리지 않는다(감사 #3). 단, 본문이 없어도 204 는 '빈 목록'이지 오류가 아니다(#4).
 * - `loadState:'error'` 는 2xx 처럼 보여도 확인 실패다(503 스냅샷, #12).
 * - `complete:false` → 부분, `loadState:'stale'` → 오래됨. 둘 다 목록을 오류로 만들지 않는다(#5).
 * - 4xx·5xx 는 기존 에러 모델로 넘긴다.
 */
export function classifyServerResponse(input: ServerResponseInput): CommonState {
  const { status, loadState, complete, itemCount } = input

  if (status >= 200 && status < 300) {
    if (loadState === 'error') {
      // 성공 코드지만 서버가 확인 실패를 뜻한다. 0건으로 위장하지 않는다.
      return classifyCommonError(503, input.body)
    }
    if (loadState === 'stale') return success('stale', COPY.stale, input)
    if (complete === false) return success('partial', COPY.partial, input)
    if (status === 204) return success('confirmed_empty', COPY.confirmed_empty, input)
    if (itemCount === 0) return success('confirmed_empty', COPY.confirmed_empty, input)
    return success('ready', COPY.ready, input)
  }

  return classifyCommonError(status, input.body)
}

/** 로딩은 응답 이전 상태다. 에러와 겹치지 않게 별도 생성자로 둔다(#14). */
export function loadingState(): LinkageSuccess {
  return {
    kind: 'loading',
    ...COPY.loading,
    checkedAt: null,
    status: null,
    envelope: { message: null, code: null },
  }
}

export type TransportFailure = 'aborted' | 'timeout' | 'network'

/** fetch 가 던진 예외를 사용자 사건으로 옮긴다. 화면을 떠난 abort 는 오류가 아니다(#7). */
export function classifyTransportFailure(error: unknown): TransportFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : ''
  if (name === 'AbortError') return 'aborted'
  if (name === 'TimeoutError') return 'timeout'
  return 'network'
}

/** 되돌아옴: 다른 화면에서 돌아왔을 때 그 내용이 아직 서버 기준인지 판정한다(#15). */
export type ReentryVerdict = 'fresh' | 'stale'

export function reentryVerdict(input: { returnedAt: string | null | undefined; checkedAt: string | null | undefined; maxAgeMs: number }): ReentryVerdict {
  const returned = input.returnedAt ? Date.parse(input.returnedAt) : NaN
  const checked = input.checkedAt ? Date.parse(input.checkedAt) : NaN
  if (Number.isNaN(returned) || Number.isNaN(checked)) return 'stale'
  return returned - checked > input.maxAgeMs ? 'stale' : 'fresh'
}
